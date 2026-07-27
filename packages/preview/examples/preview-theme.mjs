// Previews a plain Shopify theme — no manifests, no Nazare syntax required.
//
//   node packages/preview/examples/preview-theme.mjs <themeDir> [outDir]
//
// A theme addresses its files by directory: snippets/ are what {% render %}
// reaches, sections/ and blocks/ are what the theme editor places. So the walk
// is the classification — the same rule the compiler uses — and each file's
// declared interface comes from its own {% doc %} params or {% schema %}
// settings.
//
// Stories live in a sidecar beside the template (card.stories.json for
// card.liquid), because a theme has no nazare.json to put them in — and the
// sidecar is what publishes a template to the workbench. A theme has a hundred
// helper snippets that render nothing standalone; the ones somebody wrote
// stories for are the ones worth a sidebar entry. `--all` shows the rest,
// which is how you survey a theme to decide what to write next.
//
// This is the shape a `nazare preview` command would take: walk, preview, write.
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	defaultStory,
	galleryPage,
	parseStoryFile,
	previewComponentFromSource,
	renderComponentStories,
	snippetLibrary,
	storiesFor,
	storyDocuments,
	workbenchPage,
} from "../dist/index.js";

const args = process.argv.slice(2);
// Show every template, story file or not, badged with an empty default case.
const showAll = args.includes("--all");
const positional = args.filter((arg) => !arg.startsWith("--"));

const themeDir = resolve(positional[0] ?? ".");
const outDir = resolve(
	positional[1] ?? join(themeDir, ".nazare-out/preview"),
);

// The directories a theme keeps renderable components in. templates/ and
// layout/ are pages, not components: they assume a request, a template object,
// and a full storefront, none of which a workbench has.
const COMPONENT_DIRS = ["snippets", "sections", "blocks"];

const readThemeFile = (path) => {
	try {
		return readFileSync(join(themeDir, path), "utf8");
	} catch {
		return undefined;
	}
};

// A story file that does not parse stops that component rather than previewing
// half of it — the author is mid-edit, and a silently-dropped story is the one
// thing worse than an error.
const readStoryFile = (path) => {
	const contents = readThemeFile(path);
	if (contents === undefined) return undefined;
	try {
		return parseStoryFile(JSON.parse(contents), path);
	} catch (error) {
		console.error(`${path}: ${error.message}`);
		process.exitCode = 1;
		return undefined;
	}
};

// Everything compiles, because a component that renders a helper snippet needs
// that helper in scope whether or not the helper is worth a sidebar entry of
// its own. Only what has a story file is previewed.
const compiled = [];
for (const dir of COMPONENT_DIRS) {
	const absolute = join(themeDir, dir);
	if (!existsSync(absolute)) continue;
	for (const entry of readdirSync(absolute).sort()) {
		if (!entry.endsWith(".liquid")) continue;
		const file = `${dir}/${entry}`;
		const source = readThemeFile(file);
		if (source === undefined) continue;
		compiled.push({
			component: previewComponentFromSource(source, file, {
				readFile: readThemeFile,
			}),
			// card.liquid → card.stories.json, beside the template.
			sidecar: readStoryFile(
				`${dir}/${basename(entry, ".liquid")}.stories.json`,
			),
			file,
		});
	}
}

// Templates with no story file: not previewed, but counted and named, because
// the failure mode of convention-based discovery is a file that vanishes
// without saying why.
const undeclared = compiled
	.filter((entry) => !entry.sidecar)
	.map((entry) => entry.file);
const previewed = showAll
	? compiled
	: compiled.filter((entry) => entry.sidecar);

if (previewed.length === 0) {
	console.error(
		undeclared.length > 0
			? `No story files in ${themeDir} — ${undeclared.length} templates have none. Write a <name>.stories.json beside one, or pass --all to see them anyway.`
			: `No ${COMPONENT_DIRS.join("/, ")}/ Liquid found in ${themeDir}`,
	);
	process.exit(1);
}

// Every snippet in scope, so a component that renders another resolves — drawn
// from everything compiled, not only from what is previewed.
const snippets = snippetLibrary(compiled.map((entry) => entry.component));

const rendered = [];
for (const { component, sidecar } of previewed) {
	// Under --all, a template with no story file still gets one case: the
	// defaults, so there is something to look at while deciding whether to
	// write it a story file of its own.
	const stories = sidecar
		? storiesFor({ sidecar })
		: [defaultStory(component)];
	rendered.push(await renderComponentStories(component, stories, { snippets }));
}

mkdirSync(outDir, { recursive: true });
// The theme's own assets, served where `asset_url` points them.
if (existsSync(join(themeDir, "assets"))) {
	cpSync(join(themeDir, "assets"), join(outDir, "assets"), { recursive: true });
}

const storyDir = join(outDir, "stories");
mkdirSync(storyDir, { recursive: true });
for (const file of storyDocuments(rendered, { base: "../" })) {
	writeFileSync(join(storyDir, file.path), file.contents);
}

writeFileSync(
	join(outDir, "index.html"),
	workbenchPage(rendered, {
		title: `${basename(themeDir)} — Nazare preview`,
		storyBase: "./stories/",
	}),
);
writeFileSync(
	join(outDir, "all.html"),
	galleryPage(rendered, {
		title: `${basename(themeDir)} — every story`,
		storyBase: "./stories/",
	}),
);

const failed = rendered.flatMap(({ component, stories }) =>
	stories
		.filter((story) => story.error)
		.map((story) => [component.name, story]),
);
console.log(
	`${rendered.length} components, ${rendered.reduce(
		(total, entry) => total + entry.stories.length,
		0,
	)} stories, ${failed.length} failed to render`,
);
if (undeclared.length > 0 && !showAll) {
	console.log(
		`skipped ${undeclared.length} template${
			undeclared.length === 1 ? "" : "s"
		} with no story file — run with --all to see them`,
	);
}
console.log(join(outDir, "index.html"));
