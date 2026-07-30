#!/usr/bin/env node
/**
 * Deterministically expand the semantic corpus into a large benchmark theme.
 * Generated files exercise parsers, shared dependency hubs, graph projection,
 * and reverse-impact indexing without committing hundreds of copies.
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { themeInputPaths } from "../fixtures/theme-fixture.mjs";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SEED = "fixtures/canonical-theme";
const DEFAULT_FILES = 400;
const EXCLUDED_NAMES = new Set([
	".git",
	".nazare-out",
	"node_modules",
	".DS_Store",
]);

export function parseArguments(
	argumentsList,
	repositoryRoot = REPOSITORY_ROOT,
) {
	const options = {
		repositoryRoot,
		seed: resolve(repositoryRoot, DEFAULT_SEED),
		files: DEFAULT_FILES,
		out: undefined,
		force: false,
	};
	for (let index = 0; index < argumentsList.length; index += 1) {
		const argument = argumentsList[index];
		if (argument === "--force") {
			options.force = true;
			continue;
		}
		const value = argumentsList[index + 1];
		if (argument === "--seed") {
			options.seed = resolve(requiredValue(argument, value));
		} else if (argument === "--files") {
			options.files = positiveInteger(argument, value);
		} else if (argument === "--out") {
			options.out = resolve(requiredValue(argument, value));
		} else {
			throw new Error(`Unknown argument ${argument}`);
		}
		index += 1;
	}
	if (!options.out) throw new Error("--out is required");
	if (!existsSync(options.seed)) {
		throw new Error(`Seed theme does not exist: ${options.seed}`);
	}
	return options;
}

export function scaffoldTheme(options) {
	const seed = resolve(options.seed);
	const out = resolve(options.out);
	if (out === seed || out.startsWith(`${seed}${sep}`)) {
		throw new Error("Output must not be the seed theme or live inside it");
	}
	if (existsSync(out)) {
		if (!options.force) {
			throw new Error(
				`Output already exists: ${out}; pass --force to replace it`,
			);
		}
		rmSync(out, { recursive: true, force: true });
	}
	cpSync(seed, out, {
		recursive: true,
		filter: (source) => !EXCLUDED_NAMES.has(source.split(sep).at(-1)),
	});
	const seedCount = themeInputPaths(out).length;
	if (options.files < seedCount) {
		rmSync(out, { recursive: true, force: true });
		throw new Error(
			`Requested ${options.files} files, but seed already contains ${seedCount} theme inputs`,
		);
	}
	let fileCount = seedCount;
	for (let sequence = 0; fileCount < options.files; sequence += 1) {
		const file = generatedFile(sequence);
		const path = join(out, ...file.path.split("/"));
		if (existsSync(path)) continue;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, file.contents);
		fileCount += 1;
	}
	const paths = themeInputPaths(out);
	writeFileSync(
		join(out, "nazare.benchmark.json"),
		`${JSON.stringify(
			{
				version: 1,
				seed: relative(options.repositoryRoot, seed).split(sep).join("/"),
				files: paths.length,
				generatedFiles: paths.length - seedCount,
			},
			null,
			2,
		)}\n`,
	);
	return { out, seedCount, fileCount: paths.length, paths };
}

function generatedFile(sequence) {
	const id = String(sequence).padStart(4, "0");
	switch (sequence % 7) {
		case 0:
			return {
				path: `snippets/perf-snippet-${id}.liquid`,
				contents: `{% doc %}\n  @param {product} product - Product fixture.\n{% enddoc %}\n<div class="perf-card perf-card-${id}" data-perf-card="${id}">\n  {{ product.title }}\n  {% render 'price', product: product %}\n</div>\n`,
			};
		case 1:
			return {
				path: `sections/perf-section-${id}.liquid`,
				contents: `<section class="perf-section-${id}">\n  {% render 'product-card', product: section.settings.product %}\n</section>\n{% schema %}\n{"name":"Performance section ${id}","settings":[{"id":"product","type":"product","label":"Product"}]}\n{% endschema %}\n`,
			};
		case 2:
			return {
				path: `blocks/perf-block-${id}.liquid`,
				contents: `<p class="perf-block-${id}">{{ block.settings.text }}</p>\n{% schema %}\n{"name":"Performance block ${id}","settings":[{"id":"text","type":"text","label":"Text"}]}\n{% endschema %}\n`,
			};
		case 3:
			return {
				path: `assets/perf-style-${id}.css`,
				contents: `.perf-card-${id}[data-perf-card] { --perf-gap-${id}: 1rem; gap: var(--perf-gap-${id}); }\n`,
			};
		case 4:
			return {
				path: `assets/perf-script-${id}.js`,
				contents: `document.querySelector(".perf-card-${id}[data-perf-card]");\nwindow.addEventListener("perf:update:${id}", () => {});\n`,
			};
		case 5:
			return {
				path: `templates/page.perf-${id}.json`,
				contents: `${JSON.stringify({ sections: { main: { type: "main-product" } }, order: ["main"] }, null, 2)}\n`,
			};
		default:
			return {
				path: `components/perf-component-${id}.nz.liquid`,
				contents: `{% component snippet %}\n{% props { title: string.required() } %}\n<span class="perf-component-${id}">{{ props.title }}</span>\n`,
			};
	}
}

function requiredValue(argument, value) {
	if (!value || value.startsWith("--")) {
		throw new Error(`${argument} expects a value`);
	}
	return value;
}

function positiveInteger(argument, value) {
	const parsed = Number(requiredValue(argument, value));
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${argument} expects a positive integer`);
	}
	return parsed;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (executedPath === fileURLToPath(import.meta.url)) {
	try {
		const result = scaffoldTheme(parseArguments(process.argv.slice(2)));
		console.log(
			`Scaffolded ${result.fileCount}-file theme at ${result.out} (${result.seedCount} seed, ${result.fileCount - result.seedCount} generated)`,
		);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
