// `nazare preview` — the workbench, as three verbs.
//
//   nazare preview build [dir]      write a static workbench
//   nazare preview check [dir]      render every story, fail on anything wrong
//   nazare preview scaffold <file>  draft a story file from a declaration
//
// All the I/O lives here. @nazare/preview is pure over its inputs — every pass
// takes a value and returns one — so this module is the filesystem half: read
// the templates, resolve the story files, write the pages.
//
// A story file is what publishes a component to the workbench, so nothing here
// invents a case for a template that has none. Those are counted and named,
// because the failure mode of convention-based discovery is a file that
// vanishes without saying why.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { NazareManifest } from "@nazare/core";
import {
	galleryPage,
	type PreviewComponent,
	type PreviewStory,
	parseStoryFile,
	previewComponentFromSource,
	type RenderedComponent,
	renderComponentStories,
	scaffoldStories,
	shopifyFixtures,
	snippetLibrary,
	storiesFor,
	storyDocuments,
	type WorkbenchSource,
	workbenchPage,
} from "@nazare/preview";
import { isMissingFileError } from "./inspect-input.js";
import type { CliOptions } from "./options.js";
import type { Output } from "./output.js";

/**
 * The directories a theme keeps renderable components in. `templates/` and
 * `layout/` are pages, not components: they assume a request, a template
 * object, and a full storefront, none of which a workbench has.
 */
const THEME_DIRS = ["snippets", "sections", "blocks"];

export type PreviewLayout = "theme" | "package";

export type PreviewSource = {
	component: PreviewComponent;
	stories: PreviewStory[];
	/** Root-relative path, for naming a file in a message. */
	file: string;
	/**
	 * Where this component's stories are written, root-relative. A theme keeps
	 * them beside the template; a package keeps them in its manifest. An editor
	 * that saves needs to know which, and it is this walk that already knows.
	 */
	storyFile: string;
};

export type PreviewCollection = {
	layout: PreviewLayout;
	/** Everything that compiled — the snippet library is drawn from all of it. */
	compiled: PreviewSource[];
	/** What has stories, and so appears. */
	previewed: PreviewSource[];
	/** Templates nobody wrote stories for, named so they do not just vanish. */
	undeclared: string[];
	/** Story files that did not parse; each one stops its own component. */
	malformed: string[];
	/**
	 * The components those files belonged to. A story file is edited by hand, so
	 * it is broken more often than not — mid-keystroke — and a server that drops
	 * the component takes the page you are looking at with it.
	 */
	malformedComponents: string[];
};

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/**
 * What the page was built from: the directory, and the commit it was at.
 *
 * A built workbench outlives its checkout — deployed, linked, opened days later
 * — and "is this current?" otherwise has no answer on the page. Every call is
 * allowed to fail: a theme is often not in a repository at all, and a preview
 * is not the place to insist on one.
 */
export function previewSource(
	dir: string,
	label: string,
	outDir?: string,
): WorkbenchSource {
	const git = (...args: string[]): string | undefined => {
		try {
			return execFileSync("git", args, {
				cwd: dir,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			return undefined;
		}
	};
	// A detached HEAD reports the string "HEAD", which names nothing.
	const branch = git("rev-parse", "--abbrev-ref", "HEAD");
	const commit = git("rev-parse", "--short", "HEAD");
	// Scoped to what was previewed: edits elsewhere in the repository say
	// nothing about whether these components match their commit. The output
	// directory is excluded when it sits inside the previewed one, or every
	// build would report the previous build as a change.
	const nested = outDir ? relative(dir, outDir) : "";
	const changes = git(
		"status",
		"--porcelain",
		"--",
		".",
		...(nested && !nested.startsWith("..") ? [`:(exclude)${nested}`] : []),
	);
	return {
		path: label,
		...(branch && branch !== "HEAD" ? { branch } : {}),
		...(commit ? { commit } : {}),
		...(changes ? { dirty: true } : {}),
	};
}

/**
 * The project's own stand-in data: every `fixtures/*.json`, by basename.
 *
 * A fixture exists because JSON cannot reasonably hold a product with its
 * images and variants, and because the components that take one should agree
 * about the shop they belong to. That is a reason to share a file — not a
 * reason for the file to live inside this package, where nobody can read it or
 * change it. A project's own fixtures win over the built-in set, so the
 * shipped product is a starting point rather than a fact.
 */
export async function projectFixtures(
	dir: string,
): Promise<Record<string, unknown>> {
	const fixtures: Record<string, unknown> = { ...shopifyFixtures };
	let entries: string[];
	try {
		entries = await readdir(join(dir, "fixtures"));
	} catch {
		return fixtures;
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".json")) continue;
		const raw = await readIfPresent(join(dir, "fixtures", entry));
		if (raw === undefined) continue;
		try {
			fixtures[basename(entry, ".json")] = JSON.parse(raw);
		} catch (error) {
			throw new Error(`fixtures/${entry}: invalid JSON: ${errorText(error)}`);
		}
	}
	return fixtures;
}

/** The compiler reads synchronously, and a missing import is not an error. */
const readSync = (path: string): string | undefined => {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
};

const readIfPresent = async (path: string): Promise<string | undefined> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMissingFileError(error)) return undefined;
		throw error;
	}
};

/**
 * Which shape this directory is.
 *
 * A user's project is a theme and our registry is a folder of packages, and the
 * two are told apart by what is in them rather than by a flag — a question
 * nobody wants to answer twice about a directory that cannot change its mind.
 */
export async function detectLayout(
	dir: string,
): Promise<PreviewLayout | undefined> {
	if (THEME_DIRS.some((name) => existsSync(join(dir, name)))) return "theme";
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return undefined;
	}
	for (const entry of entries) {
		if (existsSync(join(dir, entry, "nazare.json"))) return "package";
	}
	return undefined;
}

/** A theme: the directory a file sits in is what the file is. */
async function collectTheme(
	dir: string,
	fixtures: Record<string, unknown>,
): Promise<PreviewCollection> {
	const collection: PreviewCollection = {
		layout: "theme",
		compiled: [],
		previewed: [],
		undeclared: [],
		malformed: [],
		malformedComponents: [],
	};
	// The compiler's filesystem is theme-relative and synchronous.
	const readThemeFile = (path: string) => readSync(join(dir, path));

	for (const name of THEME_DIRS) {
		if (!existsSync(join(dir, name))) continue;
		for (const entry of (await readdir(join(dir, name))).sort()) {
			if (!entry.endsWith(".liquid")) continue;
			const file = `${name}/${entry}`;
			const source = await readIfPresent(join(dir, file));
			if (source === undefined) continue;
			const component = previewComponentFromSource(source, file, {
				readFile: readThemeFile,
			});

			// card.liquid → card.stories.json, beside the template.
			const storyPath = `${name}/${basename(entry, ".liquid")}.stories.json`;
			const raw = await readIfPresent(join(dir, storyPath));
			let stories: PreviewStory[] = [];
			if (raw !== undefined) {
				try {
					// parseStoryFile names the path itself; JSON.parse does not.
					let parsed: unknown;
					try {
						parsed = JSON.parse(raw);
					} catch (error) {
						throw new Error(`${storyPath}: invalid JSON: ${errorText(error)}`);
					}
					stories = storiesFor({
						sidecar: parseStoryFile(parsed, storyPath),
						fixtures,
					});
				} catch (error) {
					collection.malformed.push(errorText(error));
					collection.malformedComponents.push(component.name);
				}
			}
			const entryRecord = { component, stories, file, storyFile: storyPath };
			collection.compiled.push(entryRecord);
			if (stories.length > 0) collection.previewed.push(entryRecord);
			else if (raw === undefined) collection.undeclared.push(file);
		}
	}
	return collection;
}

/** A folder of packages: each one's nazare.json says what it is. */
async function collectPackages(
	dir: string,
	fixtures: Record<string, unknown>,
): Promise<PreviewCollection> {
	const collection: PreviewCollection = {
		layout: "package",
		compiled: [],
		previewed: [],
		undeclared: [],
		malformed: [],
		malformedComponents: [],
	};
	// Rooted at the collection, not at one package: a component that imports a
	// sibling (`../notice/notice.nz.liquid`) addresses it across the folder
	// boundary, so the entry path has to be collection-relative too.
	const readCollectionFile = (path: string) => readSync(join(dir, path));

	for (const folder of (await readdir(dir)).sort()) {
		const manifestPath = join(dir, folder, "nazare.json");
		const raw = await readIfPresent(manifestPath);
		if (raw === undefined) continue;
		let manifest: NazareManifest;
		try {
			manifest = JSON.parse(raw) as NazareManifest;
		} catch (error) {
			collection.malformed.push(
				`${folder}/nazare.json: invalid JSON: ${errorText(error)}`,
			);
			collection.malformedComponents.push(folder);
			continue;
		}
		// A function package (`cn`) has no template to preview.
		if (!manifest.entry?.endsWith(".liquid")) continue;

		const file = `${folder}/${manifest.entry}`;
		const source = await readIfPresent(join(dir, file));
		if (source === undefined) continue;
		const component = previewComponentFromSource(source, file, {
			readFile: readCollectionFile,
			packageId: manifest.id,
			// A function package was already skipped, so the kind is a template one.
			kind: manifest.kind as Exclude<NazareManifest["kind"], "function">,
		});
		const stories = storiesFor({ manifest, fixtures });
		const entryRecord = {
			component,
			stories,
			file,
			storyFile: `${folder}/nazare.json`,
		};
		collection.compiled.push(entryRecord);
		if (stories.length > 0) collection.previewed.push(entryRecord);
		else collection.undeclared.push(entryRecord.file);
	}
	return collection;
}

/** Everything in `dir`, compiled, with its stories resolved. */
export async function collectPreview(
	dir: string,
): Promise<PreviewCollection | undefined> {
	const layout = await detectLayout(dir);
	if (layout === undefined) return undefined;
	const fixtures = await projectFixtures(dir);
	return layout === "theme"
		? collectTheme(dir, fixtures)
		: collectPackages(dir, fixtures);
}

/**
 * Renders every previewed component. The snippet library is drawn from
 * everything compiled, not only from what is previewed: a component that
 * renders a helper needs that helper in scope whether or not the helper is
 * worth a sidebar entry of its own.
 */
export async function renderCollection(
	collection: PreviewCollection,
): Promise<RenderedComponent[]> {
	const snippets = snippetLibrary(
		collection.compiled.map((entry) => entry.component),
	);
	const rendered: RenderedComponent[] = [];
	for (const { component, stories } of collection.previewed) {
		rendered.push(
			await renderComponentStories(component, stories, { snippets }),
		);
	}
	return rendered;
}

function reportSkipped(collection: PreviewCollection, output: Output): void {
	for (const message of collection.malformed) output.error(message);
	if (collection.undeclared.length === 0) return;
	const count = collection.undeclared.length;
	output.log(
		`skipped ${count} template${count === 1 ? "" : "s"} with no story file`,
	);
}

/** Writes the workbench, the catalogue, and one document per story. */
export async function runPreviewBuild(
	dir: string,
	outDir: string,
	output: Output,
	label = dir,
): Promise<number> {
	const collection = await collectPreview(dir);
	if (!collection) return missingLayout(dir, output);
	const rendered = await renderCollection(collection);
	if (rendered.length === 0) return nothingToPreview(collection, dir, output);

	await mkdir(outDir, { recursive: true });

	// A package's emitted stylesheets and behaviors are assets it produced; a
	// theme's live in the theme, where asset_url already points.
	if (collection.layout === "package") {
		for (const { component } of collection.previewed) {
			for (const asset of component.assets) {
				const name = asset.path.split("/").pop() as string;
				await mkdir(join(outDir, "assets"), { recursive: true });
				await writeFile(join(outDir, "assets", name), asset.contents);
			}
		}
	} else if (existsSync(join(dir, "assets"))) {
		await cp(join(dir, "assets"), join(outDir, "assets"), { recursive: true });
	}

	// Each story as its own document, so a component's global CSS cannot reach
	// the story next to it and every story has a URL that opens on its own. The
	// shells then embed them. `base` is `../` because the documents sit one level
	// down and the emitted templates ask for `./assets/*`.
	const storyDir = join(outDir, "stories");
	await mkdir(storyDir, { recursive: true });
	for (const file of storyDocuments(rendered, { base: "../" })) {
		await writeFile(join(storyDir, file.path), file.contents);
	}

	const title = basename(resolve(dir));
	await writeFile(
		join(outDir, "index.html"),
		workbenchPage(rendered, {
			title: `${title} — Nazare preview`,
			storyBase: "./stories/",
			source: previewSource(dir, label, outDir),
		}),
	);
	await writeFile(
		join(outDir, "all.html"),
		galleryPage(rendered, {
			title: `${title} — every story`,
			storyBase: "./stories/",
		}),
	);

	const stories = rendered.reduce(
		(total, entry) => total + entry.stories.length,
		0,
	);
	output.log(`${rendered.length} components, ${stories} stories`);
	reportSkipped(collection, output);
	output.log(join(outDir, "index.html"));
	return collection.malformed.length > 0 ? 1 : 0;
}

type CheckFailure = {
	component: string;
	story: string;
	message: string;
};

/**
 * Every story rendered and checked, with no page written and no browser.
 *
 * This is the gate: rename a prop in a template and the stories that still name
 * the old one fail here, rather than rendering nil on a storefront. A story that
 * throws and a story that contradicts its declaration are both failures — the
 * first is Liquid saying so, the second is the only way anyone finds out.
 */
export async function runPreviewCheck(
	dir: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const collection = await collectPreview(dir);
	if (!collection) return missingLayout(dir, output);
	const rendered = await renderCollection(collection);
	if (rendered.length === 0) return nothingToPreview(collection, dir, output);

	const failures: CheckFailure[] = [];
	let stories = 0;
	for (const { component, stories: rendering } of rendered) {
		for (const story of rendering) {
			stories += 1;
			if (story.error) {
				failures.push({
					component: component.name,
					story: story.story.name,
					message: `render failed: ${story.error}`,
				});
			}
			for (const issue of story.issues) {
				failures.push({
					component: component.name,
					story: story.story.name,
					message: issue.message,
				});
			}
		}
	}

	if (cliOptions.json) {
		output.log(
			JSON.stringify(
				{
					components: rendered.length,
					stories,
					undeclared: collection.undeclared,
					malformed: collection.malformed,
					failures,
				},
				null,
				2,
			),
		);
		return failures.length > 0 || collection.malformed.length > 0 ? 1 : 0;
	}

	for (const failure of failures) {
		output.error(`${failure.component} / ${failure.story}: ${failure.message}`);
	}
	output.log(
		`${rendered.length} components, ${stories} stories, ${failures.length} problem${
			failures.length === 1 ? "" : "s"
		}`,
	);
	reportSkipped(collection, output);
	return failures.length > 0 || collection.malformed.length > 0 ? 1 : 0;
}

/**
 * Drafts a story file from what a component declares: the defaults, then one
 * case per enum member, written where an author reads and edits it.
 *
 * This is where the derivation the preview used to do at render time lives now.
 * The difference is not cosmetic — a guess in a file is something you can
 * correct, and a guess made fresh on every render is one the tool asserts on
 * your behalf forever.
 */
export async function runPreviewScaffold(
	projectRoot: string,
	target: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	const absolute = resolve(projectRoot, target);
	const source = await readIfPresent(absolute);
	if (source === undefined) {
		output.error(`Unable to read ${target}`);
		return 1;
	}

	// The component's own directory is its filesystem: a template that imports a
	// sibling resolves relative to where it sits.
	const root = dirname(absolute);
	const component = previewComponentFromSource(
		source,
		relative(root, absolute),
		{ readFile: (path) => readSync(join(root, path)) },
	);

	if (component.controls.length === 0) {
		output.error(
			`${target} declares no props, so there is nothing to draft from. Write the cases by hand, or declare the interface in {% doc %} / {% schema %} first.`,
		);
		return 1;
	}

	// A required prop is exactly the one the declaration gives no default for, so
	// every story has to state it or render on a placeholder — a button whose
	// label reads "label". The draft states them, with values meant to be
	// replaced by something a merchant would actually type.
	const required = component.controls.filter((control) => control.required);
	const requiredProps = Object.fromEntries(
		required.map((control) => [control.name, control.value]),
	);
	const stories = scaffoldStories(component).map((story, index) => ({
		name: story.name,
		...(index === 0
			? required.length > 0
				? { props: requiredProps }
				: {}
			: { props: { ...requiredProps, ...story.props } }),
	}));

	const storyFile = join(
		root,
		`${basename(absolute).replace(/\.(nz\.)?liquid$/, "")}.stories.json`,
	);
	// Named the way the caller named the target: project-relative inside the
	// project, absolute outside it, rather than a path of `../`s.
	const shown = relative(projectRoot, storyFile);
	const named = shown.startsWith("..") ? storyFile : shown;

	if (existsSync(storyFile) && !cliOptions.force) {
		output.error(`${named} exists. Re-run with --force to overwrite it.`);
		return 1;
	}

	await writeFile(storyFile, `${JSON.stringify({ stories }, null, 2)}\n`);
	output.log(`${named} — ${stories.length} stories, edit before commit`);
	return 0;
}

function missingLayout(dir: string, output: Output): number {
	output.error(
		`Nothing to preview in ${dir}. Expected a theme (${THEME_DIRS.map(
			(name) => `${name}/`,
		).join(", ")}) or a directory of packages (folders with nazare.json).`,
	);
	return 1;
}

function nothingToPreview(
	collection: PreviewCollection,
	dir: string,
	output: Output,
): number {
	for (const message of collection.malformed) output.error(message);
	output.error(
		`No story files in ${dir}. A component appears once it has stories: write a <name>.stories.json beside a template, or run \`nazare preview scaffold <file>\` to draft one.`,
	);
	return 1;
}
