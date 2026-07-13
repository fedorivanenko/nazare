import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { buildTheme } from "../dist/index.js";

async function withProject(files, fn) {
	const projectRoot = mkdtempSync(join(tmpdir(), "nazare-theme-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const full = join(projectRoot, path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, contents);
		}
		await fn(projectRoot);
	} finally {
		await rm(projectRoot, { recursive: true, force: true });
	}
}

const readOutput = (projectRoot, path) =>
	readFileSync(join(projectRoot, ".nazare-out/theme", path), "utf8");

test("buildTheme copies Shopify theme folders", async () => {
	await withProject(
		{
			"nazare/layout/theme.liquid": "{{ content_for_layout }}\n",
			"nazare/templates/product.json": '{"sections":{}}',
			"nazare/sections/hero.liquid": "<section>Hero</section>\n",
			"nazare/snippets/price.liquid": "<span>{{ price }}</span>\n",
			"nazare/assets/theme.css": "body{}\n",
			"nazare/config/settings_schema.json": "[]",
			"nazare/locales/en.default.json": "{}",
		},
		async (projectRoot) => {
			const result = await buildTheme({ projectRoot });
			assert.deepEqual(result.issues, []);
			assert.equal(
				readOutput(projectRoot, "layout/theme.liquid"),
				"{{ content_for_layout }}\n",
			);
			assert.equal(
				readOutput(projectRoot, "templates/product.json"),
				'{"sections":{}}',
			);
		},
	);
});

test("buildTheme compiles .nz.liquid and does not copy the source file", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid":
				"{% component section %}<section>Hero</section>\n",
		},
		async (projectRoot) => {
			const result = await buildTheme({ projectRoot });
			assert.deepEqual(result.compiled, ["nazare/sections/hero.nz.liquid"]);
			assert.equal(
				readOutput(projectRoot, "sections/hero.liquid").includes("Hero"),
				true,
			);
			assert.equal(
				existsSync(
					join(projectRoot, ".nazare-out/theme/sections/hero.nz.liquid"),
				),
				false,
			);
		},
	);
});

test("buildTheme reports invalid JSON", async () => {
	await withProject(
		{ "nazare/templates/product.json": "{ nope" },
		async (projectRoot) => {
			const result = await buildTheme({ projectRoot });
			assert.equal(result.issues[0].code, "THEME_INVALID_JSON");
		},
	);
});
