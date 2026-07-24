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

const rendered = [];
const stylesheets = new Set();
const scripts = new Set();

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
	rendered.push(await renderComponentStories(component));

	for (const asset of component.assets) {
		const name = asset.path.split("/").pop();
		mkdirSync(join(outDir, "assets"), { recursive: true });
		writeFileSync(join(outDir, "assets", name), asset.contents);
		if (name.endsWith(".css")) stylesheets.add(`./assets/${name}`);
		// Behaviors are ES modules that mount on the emitted markup, so the
		// island components are actually interactive in the gallery.
		if (name.endsWith(".js")) scripts.add(`./assets/${name}`);
	}
}

mkdirSync(outDir, { recursive: true });
writeFileSync(
	join(outDir, "index.html"),
	galleryPage(rendered, {
		title: "Nazare registry — preview",
		stylesheets: [...stylesheets],
		scripts: [...scripts],
	}),
);
console.log(join(outDir, "index.html"));
