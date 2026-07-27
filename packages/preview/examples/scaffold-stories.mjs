// Drafts a story file from what a component declares.
//
//   node packages/preview/examples/scaffold-stories.mjs <file.liquid> [--force]
//   node packages/preview/examples/scaffold-stories.mjs snippets/card.liquid
//
// This is where the derivation the preview used to do at render time lives now:
// the defaults, then one case per enum member, written to a file the author
// reads, edits, and commits. The difference is not cosmetic — a guess in a file
// is something you can correct, and a guess made fresh on every render is
// something the tool asserts on your behalf forever.
//
// Prints the draft to stdout unless it can place it beside the template. Never
// overwrites an existing story file without --force: the cases already there
// were chosen by a person, and this was not.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { previewComponentFromSource, scaffoldStories } from "../dist/index.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const target = args.find((arg) => !arg.startsWith("--"));

if (!target) {
	console.error(
		"Usage: scaffold-stories.mjs <file.liquid|file.nz.liquid> [--force]",
	);
	process.exit(1);
}

const absolute = resolve(target);
// The component's own directory is its filesystem: a snippet that imports a
// sibling resolves relative to where it sits.
const root = dirname(absolute);
const readFile = (path) => {
	try {
		return readFileSync(join(root, path), "utf8");
	} catch {
		return undefined;
	}
};

const component = previewComponentFromSource(
	readFileSync(absolute, "utf8"),
	relative(root, absolute),
	{ readFile },
);

if (component.controls.length === 0) {
	console.error(
		`${target} declares no props — nothing to draft from. Write the cases by hand, or declare the interface in {% doc %} / {% schema %} first.`,
	);
	process.exit(1);
}

// A required prop is exactly the one the declaration gives no default for, so
// every story has to state it or render on a placeholder — a button whose label
// reads "label". The draft states them, with values the author is meant to
// replace with something a merchant would actually type.
const required = component.controls.filter((control) => control.required);
const requiredProps = Object.fromEntries(
	required.map((control) => [control.name, control.value]),
);

// Otherwise the draft carries only each case's delta, the same as a story an
// author writes: the declaration already supplies everything else.
const stories = scaffoldStories(component).map((story, index) => ({
	name: story.name,
	// The first case is the defaults, which are the declaration's job to state.
	...(index === 0
		? required.length > 0
			? { props: requiredProps }
			: {}
		: { props: { ...requiredProps, ...story.props } }),
}));

const draft = `${JSON.stringify({ stories }, null, 2)}\n`;

const sidecar = join(
	root,
	`${basename(absolute).replace(/\.(nz\.)?liquid$/, "")}.stories.json`,
);
if (existsSync(sidecar) && !force) {
	console.error(`${sidecar} exists — pass --force to overwrite it`);
	process.stdout.write(draft);
	process.exit(1);
}

writeFileSync(sidecar, draft);
console.log(`wrote ${sidecar} — ${stories.length} stories, edit before commit`);
