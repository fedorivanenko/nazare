// Builds a gallery for every component in registry/components/.
//
//   node packages/preview/examples/build-gallery.mjs [outDir]
//
// A worked example of the package, and the shape a `nazare preview` command or
// an Astro route would take: read sources, preview each one, write the page.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	galleryPage,
	previewComponentFromSource,
	renderComponentStories,
	snippetLibrary,
	storiesFor,
} from "../dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const componentsRoot = join(repoRoot, "registry/components");
const outDir = resolve(
	process.argv[2] ?? join(repoRoot, ".nazare-out/preview"),
);

const readProjectFile = (path) => {
	try {
		return readFileSync(join(repoRoot, path), "utf8");
	} catch {
		return undefined;
	}
};

// Two passes: compile everything first, because a component that composes
// others (announcement-bar renders link) can only be rendered once the whole
// snippet library exists.
const previewed = [];
const stylesheets = new Set();

for (const folder of readdirSync(componentsRoot).sort()) {
	const manifestPath = join(componentsRoot, folder, "nazare.json");
	let manifest;
	try {
		manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	} catch {
		continue;
	}
	// A function package (`cn`) has no template to preview.
	if (!manifest.entry?.endsWith(".liquid")) continue;

	const file = `registry/components/${folder}/${manifest.entry}`;
	const component = previewComponentFromSource(
		readFileSync(join(repoRoot, file), "utf8"),
		file,
		{ readFile: readProjectFile, packageId: manifest.id },
	);
	previewed.push({ component, manifest });

	for (const asset of component.assets) {
		const name = asset.path.split("/").pop();
		mkdirSync(join(outDir, "assets"), { recursive: true });
		writeFileSync(join(outDir, "assets", name), asset.contents);
		if (name.endsWith(".css")) stylesheets.add(`./assets/${name}`);
	}
}

const snippets = snippetLibrary(previewed.map((entry) => entry.component));

const rendered = [];
for (const { component, manifest } of previewed) {
	// Authored stories from nazare.json when the component ships them; the
	// contract-derived baseline otherwise.
	rendered.push(
		await renderComponentStories(component, storiesFor(component, manifest), {
			snippets,
		}),
	);
}

// Behaviors are deliberately NOT wired here: the emitted template already ends
// in `{{ 'nazare-runtime.js' | asset_url | script_tag }}` followed by its own
// behavior, and the preview engine renders those tags for real. Loading them
// again from the page would only risk getting the order wrong — the behavior
// scripts read `window.Nazare`, so the runtime must execute first.

mkdirSync(outDir, { recursive: true });
writeFileSync(
	join(outDir, "index.html"),
	galleryPage(rendered, {
		title: "Nazare registry — preview",
		stylesheets: [...stylesheets],
	}),
);
console.log(join(outDir, "index.html"));
