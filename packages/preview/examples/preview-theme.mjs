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
// Authored stories live in a sidecar beside the template (card.stories.json for
// card.liquid), because a theme has no nazare.json to put them in. They add to
// the derived set rather than replacing it.
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
	galleryPage,
	previewComponentFromSource,
	renderComponentStories,
	snippetLibrary,
	storiesFor,
	storyDocuments,
	workbenchPage,
} from "../dist/index.js";

const themeDir = resolve(process.argv[2] ?? ".");
const outDir = resolve(
	process.argv[3] ?? join(themeDir, ".nazare-out/preview"),
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

const readJson = (path) => {
	const contents = readThemeFile(path);
	if (contents === undefined) return undefined;
	try {
		return JSON.parse(contents);
	} catch (error) {
		console.warn(`skipping ${path}: ${error.message}`);
		return undefined;
	}
};

const previewed = [];
for (const dir of COMPONENT_DIRS) {
	const absolute = join(themeDir, dir);
	if (!existsSync(absolute)) continue;
	for (const entry of readdirSync(absolute).sort()) {
		if (!entry.endsWith(".liquid")) continue;
		const file = `${dir}/${entry}`;
		const source = readThemeFile(file);
		if (source === undefined) continue;
		// card.liquid → card.stories.json, beside the template.
		const sidecar = readJson(
			`${dir}/${basename(entry, ".liquid")}.stories.json`,
		);
		previewed.push({
			component: previewComponentFromSource(source, file, {
				readFile: readThemeFile,
			}),
			sidecar,
		});
	}
}

if (previewed.length === 0) {
	console.error(
		`No ${COMPONENT_DIRS.join("/, ")}/ Liquid found in ${themeDir}`,
	);
	process.exit(1);
}

// Every snippet in scope, so a component that renders another resolves.
const snippets = snippetLibrary(previewed.map((entry) => entry.component));

const rendered = [];
for (const { component, sidecar } of previewed) {
	rendered.push(
		await renderComponentStories(
			component,
			storiesFor(component, undefined, sidecar),
			{ snippets },
		),
	);
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
console.log(join(outDir, "index.html"));
