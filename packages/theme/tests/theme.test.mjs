import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
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

test("buildTheme seeds merchant data on a first build", async () => {
	await withProject(
		{
			"nazare/config/settings_data.json":
				'{"current":{"colors_accent":"#000"}}',
			"nazare/templates/index.json": '{"sections":{}}',
		},
		async (projectRoot) => {
			const result = await buildTheme({ projectRoot });
			assert.deepEqual(result.preserved, []);
			assert.ok(result.seeded.includes("config/settings_data.json"));
			assert.equal(
				readOutput(projectRoot, "config/settings_data.json"),
				'{"current":{"colors_accent":"#000"}}',
			);
		},
	);
});

test("buildTheme preserves target settings_data over the source seed on rebuild", async () => {
	await withProject(
		{
			"nazare/config/settings_data.json":
				'{"current":{"colors_accent":"#000"}}',
			"nazare/sections/hero.nz.liquid":
				"{% component section %}<section>Hero</section>\n",
		},
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			// Simulate a merchant editing the setting in the Shopify admin, which
			// writes back into the built theme's settings_data.json.
			writeFileSync(
				join(projectRoot, ".nazare-out/theme/config/settings_data.json"),
				'{"current":{"colors_accent":"#ff0000"}}',
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(result.preserved.includes("config/settings_data.json"));
			assert.ok(
				result.notes.some((note) => note.code === "THEME_DATA_PRESERVED"),
			);
			assert.equal(
				readOutput(projectRoot, "config/settings_data.json"),
				'{"current":{"colors_accent":"#ff0000"}}',
			);
			// Code is still regenerated fresh.
			assert.ok(
				readOutput(projectRoot, "sections/hero.liquid").includes("Hero"),
			);
		},
	);
});

test("buildTheme keeps a merchant-added template that the source never had", async () => {
	await withProject(
		{ "nazare/templates/index.json": '{"sections":{}}' },
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			// A merchant creates a new template variant in the admin.
			writeFileSync(
				join(projectRoot, ".nazare-out/theme/templates/page.contact.json"),
				'{"sections":{"main":{"type":"contact"}}}',
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(result.preserved.includes("templates/page.contact.json"));
			assert.equal(
				readOutput(projectRoot, "templates/page.contact.json"),
				'{"sections":{"main":{"type":"contact"}}}',
			);
		},
	);
});

test("buildTheme preserves section-group JSON but regenerates section code", async () => {
	await withProject(
		{ "nazare/sections/header-group.json": '{"type":"header","sections":{}}' },
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			writeFileSync(
				join(projectRoot, ".nazare-out/theme/sections/header-group.json"),
				'{"type":"header","sections":{"logo":{"type":"logo"}}}',
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(result.preserved.includes("sections/header-group.json"));
			assert.equal(
				readOutput(projectRoot, "sections/header-group.json"),
				'{"type":"header","sections":{"logo":{"type":"logo"}}}',
			);
		},
	);
});

const section = (props) =>
	`{% component section %}\n{% props {\n${props}\n} %}\n<section>{{ props.heading }}</section>\n`;

test("buildTheme writes a schema lock with no drift on first build", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),',
			),
		},
		async (projectRoot) => {
			const result = await buildTheme({ projectRoot });
			assert.deepEqual(result.drift, []);
			const lock = JSON.parse(
				readFileSync(join(projectRoot, result.manifestPath), "utf8"),
			);
			assert.ok(lock.sections["sections/hero.liquid"]);
			assert.deepEqual(
				lock.sections["sections/hero.liquid"].settings.map((s) => s.id),
				["heading"],
			);
		},
	);
});

test("buildTheme warns when a setting is removed or a section is deleted", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),\n  sub: string.setting({ label: "Sub" }),',
			),
			"nazare/sections/promo.nz.liquid":
				'{% component section %}\n{% props {\n  title: string.setting({ label: "Title" }),\n} %}\n<section>{{ props.title }}</section>\n',
		},
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			// Drop the `sub` setting from hero, and delete promo entirely.
			writeFileSync(
				join(projectRoot, "nazare/sections/hero.nz.liquid"),
				section('  heading: string.setting({ label: "Heading" }),'),
			);
			rmSync(join(projectRoot, "nazare/sections/promo.nz.liquid"));
			const result = await buildTheme({ projectRoot });
			const codes = result.drift.map((d) => d.code);
			assert.ok(codes.includes("THEME_SETTING_REMOVED"));
			assert.ok(codes.includes("THEME_SECTION_REMOVED"));
			// Drift surfaces as non-fatal warnings, not errors.
			assert.ok(
				result.issues.some(
					(i) => i.code === "THEME_SETTING_REMOVED" && i.severity === "warning",
				),
			);
			assert.ok(!result.issues.some((i) => i.severity === "error"));
		},
	);
});

test("buildTheme warns when a setting changes type", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),',
			),
		},
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			writeFileSync(
				join(projectRoot, "nazare/sections/hero.nz.liquid"),
				section('  heading: boolean.setting({ label: "Heading" }),'),
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(result.drift.some((d) => d.code === "THEME_SETTING_RETYPED"));
		},
	);
});

test("buildTheme stays silent when a setting is added", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),',
			),
		},
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			writeFileSync(
				join(projectRoot, "nazare/sections/hero.nz.liquid"),
				section(
					'  heading: string.setting({ label: "Heading" }),\n  sub: string.setting({ label: "Sub" }),',
				),
			);
			const result = await buildTheme({ projectRoot });
			assert.deepEqual(result.drift, []);
		},
	);
});
