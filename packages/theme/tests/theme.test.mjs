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

const writeOut = (projectRoot, path, contents) => {
	const full = join(projectRoot, ".nazare-out/theme", path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, contents);
};

test("a migration rewrites saved data on a rename and silences drift", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),',
			),
		},
		async (projectRoot) => {
			// First build establishes the schema lock for section "hero".
			await buildTheme({ projectRoot });
			// A merchant has placed the section on a page with a saved value.
			writeOut(
				projectRoot,
				"templates/index.json",
				JSON.stringify({
					sections: { main: { type: "hero", settings: { heading: "Hi" } } },
					order: ["main"],
				}),
			);
			// Developer renames the section to "banner" and its setting to "title".
			rmSync(join(projectRoot, "nazare/sections/hero.nz.liquid"));
			writeFileSync(
				join(projectRoot, "nazare/sections/banner.nz.liquid"),
				section('  title: string.setting({ label: "Title" }),'),
			);
			writeFileSync(
				join(projectRoot, "nazare.migrations.json"),
				JSON.stringify({
					migrations: [
						{ id: "m1", op: "renameSection", from: "hero", to: "banner" },
						{
							id: "m2",
							op: "renameSetting",
							section: "banner",
							from: "heading",
							to: "title",
						},
					],
				}),
			);
			const result = await buildTheme({ projectRoot });

			// Drift is silenced because the migration accounts for the rename.
			assert.deepEqual(result.drift, []);
			assert.ok(result.migrated.includes("templates/index.json"));
			const template = JSON.parse(
				readOutput(projectRoot, "templates/index.json"),
			);
			assert.equal(template.sections.main.type, "banner");
			assert.deepEqual(template.sections.main.settings, { title: "Hi" });
		},
	);
});

test("without a migration, a rename still drifts and strands data", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),',
			),
		},
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			writeOut(
				projectRoot,
				"templates/index.json",
				JSON.stringify({
					sections: { main: { type: "hero", settings: { heading: "Hi" } } },
				}),
			);
			rmSync(join(projectRoot, "nazare/sections/hero.nz.liquid"));
			writeFileSync(
				join(projectRoot, "nazare/sections/banner.nz.liquid"),
				section('  title: string.setting({ label: "Title" }),'),
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(result.drift.some((d) => d.code === "THEME_SECTION_REMOVED"));
			assert.deepEqual(result.migrated, []);
			// Data is untouched — the instance still points at the gone "hero".
			const template = JSON.parse(
				readOutput(projectRoot, "templates/index.json"),
			);
			assert.equal(template.sections.main.type, "hero");
		},
	);
});

test("an invalid migrations file errors and is not partially applied", async () => {
	await withProject(
		{
			"nazare/sections/hero.nz.liquid": section(
				'  heading: string.setting({ label: "Heading" }),',
			),
			"nazare.migrations.json": JSON.stringify({
				migrations: [
					{ id: "m1", op: "renameSection", from: "hero", to: "banner" },
					{ id: "m2", op: "renameSetting", from: "heading" },
				],
			}),
		},
		async (projectRoot) => {
			writeOut(
				projectRoot,
				"templates/index.json",
				JSON.stringify({ sections: { main: { type: "hero" } } }),
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(
				result.issues.some((i) => i.code === "THEME_MIGRATION_INVALID"),
			);
			assert.deepEqual(result.migrated, []);
			// The valid op did not run either — all or nothing.
			const template = JSON.parse(
				readOutput(projectRoot, "templates/index.json"),
			);
			assert.equal(template.sections.main.type, "hero");
		},
	);
});

test("a global setting rename rewrites settings_data.current", async () => {
	await withProject(
		{ "nazare/config/settings_schema.json": "[]" },
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			writeOut(
				projectRoot,
				"config/settings_data.json",
				JSON.stringify({ current: { old_accent: "#000" } }),
			);
			writeFileSync(
				join(projectRoot, "nazare.migrations.json"),
				JSON.stringify({
					migrations: [
						{ id: "m1", op: "renameSetting", from: "old_accent", to: "accent" },
					],
				}),
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(result.migrated.includes("config/settings_data.json"));
			const data = JSON.parse(
				readOutput(projectRoot, "config/settings_data.json"),
			);
			assert.deepEqual(data.current, { accent: "#000" });
		},
	);
});

const globalRename = JSON.stringify({
	migrations: [{ id: "m1", op: "renameSetting", from: "old", to: "neu" }],
});

test("the ledger runs a migration once even if the old name reappears", async () => {
	await withProject(
		{ "nazare/config/settings_schema.json": "[]" },
		async (projectRoot) => {
			writeFileSync(join(projectRoot, "nazare.migrations.json"), globalRename);
			writeOut(
				projectRoot,
				"config/settings_data.json",
				JSON.stringify({ current: { old: "first" } }),
			);
			const first = await buildTheme({ projectRoot });
			assert.deepEqual(first.applied, ["m1"]);
			assert.deepEqual(
				JSON.parse(readOutput(projectRoot, "config/settings_data.json"))
					.current,
				{ neu: "first" },
			);

			// A later, unrelated setting reuses the retired name "old". Without a
			// run-once ledger the stale migration would rename it to "neu" and
			// clobber the real value.
			writeOut(
				projectRoot,
				"config/settings_data.json",
				JSON.stringify({ current: { neu: "first", old: "unrelated" } }),
			);
			const second = await buildTheme({ projectRoot });
			assert.deepEqual(second.applied, []);
			assert.deepEqual(
				JSON.parse(readOutput(projectRoot, "config/settings_data.json"))
					.current,
				{ neu: "first", old: "unrelated" },
			);
		},
	);
});

test("the ledger is per target, so a new target re-applies", async () => {
	await withProject(
		{ "nazare/config/settings_schema.json": "[]" },
		async (projectRoot) => {
			writeFileSync(join(projectRoot, "nazare.migrations.json"), globalRename);
			const firstOut = ".nazare-out/a";
			const secondOut = ".nazare-out/b";
			mkdirSync(join(projectRoot, firstOut, "config"), { recursive: true });
			writeFileSync(
				join(projectRoot, firstOut, "config/settings_data.json"),
				JSON.stringify({ current: { old: "x" } }),
			);
			const first = await buildTheme({ projectRoot, outDir: firstOut });
			assert.deepEqual(first.applied, ["m1"]);

			// A different output target has its own history — the migration runs
			// again there.
			mkdirSync(join(projectRoot, secondOut, "config"), { recursive: true });
			writeFileSync(
				join(projectRoot, secondOut, "config/settings_data.json"),
				JSON.stringify({ current: { old: "y" } }),
			);
			const second = await buildTheme({ projectRoot, outDir: secondOut });
			assert.deepEqual(second.applied, ["m1"]);
			const ledger = JSON.parse(
				readFileSync(
					join(projectRoot, "nazare.migrations-applied.json"),
					"utf8",
				),
			);
			assert.deepEqual(Object.keys(ledger.applied).sort(), [
				firstOut,
				secondOut,
			]);
		},
	);
});

test("a duplicate migration id is rejected", async () => {
	await withProject(
		{ "nazare/config/settings_schema.json": "[]" },
		async (projectRoot) => {
			writeFileSync(
				join(projectRoot, "nazare.migrations.json"),
				JSON.stringify({
					migrations: [
						{ id: "dup", op: "renameSetting", from: "a", to: "b" },
						{ id: "dup", op: "renameSetting", from: "c", to: "d" },
					],
				}),
			);
			const result = await buildTheme({ projectRoot });
			assert.ok(
				result.issues.some(
					(i) =>
						i.code === "THEME_MIGRATION_INVALID" &&
						/duplicate id/.test(i.message),
				),
			);
		},
	);
});

const localeSource = (tree) => ({
	"nazare/locales/en.default.json": JSON.stringify(tree),
});
const readLocale = (projectRoot) =>
	JSON.parse(readOutput(projectRoot, "locales/en.default.json"));
const editLocale = (projectRoot, tree) =>
	writeOut(projectRoot, "locales/en.default.json", JSON.stringify(tree));

test("a locale preserves a merchant edit the developer did not touch", async () => {
	await withProject(
		localeSource({ general: { greeting: "Hi" }, cta: "Shop" }),
		async (projectRoot) => {
			const first = await buildTheme({ projectRoot });
			assert.deepEqual(first.mergedLocales, []); // nothing live yet
			// Merchant edits one nested string in the admin.
			editLocale(projectRoot, { general: { greeting: "Hey" }, cta: "Shop" });
			const result = await buildTheme({ projectRoot });
			assert.ok(result.mergedLocales.includes("locales/en.default.json"));
			assert.deepEqual(readLocale(projectRoot), {
				general: { greeting: "Hey" },
				cta: "Shop",
			});
		},
	);
});

test("a locale propagates a developer update the merchant did not touch", async () => {
	await withProject(localeSource({ greeting: "Hi" }), async (projectRoot) => {
		await buildTheme({ projectRoot });
		editLocale(projectRoot, { greeting: "Hi" }); // merchant left it alone
		writeFileSync(
			join(projectRoot, "nazare/locales/en.default.json"),
			JSON.stringify({ greeting: "Hello" }), // developer updates the string
		);
		await buildTheme({ projectRoot });
		assert.deepEqual(readLocale(projectRoot), { greeting: "Hello" });
	});
});

test("a locale adds new developer keys while keeping merchant edits", async () => {
	await withProject(localeSource({ greeting: "Hi" }), async (projectRoot) => {
		await buildTheme({ projectRoot });
		editLocale(projectRoot, { greeting: "Hey" }); // merchant edit
		writeFileSync(
			join(projectRoot, "nazare/locales/en.default.json"),
			JSON.stringify({ greeting: "Hi", farewell: "Bye" }), // dev adds a key
		);
		await buildTheme({ projectRoot });
		assert.deepEqual(readLocale(projectRoot), {
			greeting: "Hey",
			farewell: "Bye",
		});
	});
});

test("a locale key changed on both sides keeps the merchant value and warns", async () => {
	await withProject(localeSource({ greeting: "Hi" }), async (projectRoot) => {
		await buildTheme({ projectRoot });
		editLocale(projectRoot, { greeting: "Hey" }); // merchant
		writeFileSync(
			join(projectRoot, "nazare/locales/en.default.json"),
			JSON.stringify({ greeting: "Hello" }), // developer
		);
		const result = await buildTheme({ projectRoot });
		assert.ok(result.issues.some((i) => i.code === "THEME_LOCALE_CONFLICT"));
		assert.deepEqual(readLocale(projectRoot), { greeting: "Hey" });
	});
});

test("schema locales are developer-owned and copied, not merged", async () => {
	await withProject(
		{ "nazare/locales/en.default.schema.json": '{"label":"Heading"}' },
		async (projectRoot) => {
			await buildTheme({ projectRoot });
			// Overwrite as if a merchant touched it — the developer's source wins.
			writeOut(
				projectRoot,
				"locales/en.default.schema.json",
				'{"label":"Tampered"}',
			);
			const result = await buildTheme({ projectRoot });
			assert.deepEqual(result.mergedLocales, []);
			assert.equal(
				readOutput(projectRoot, "locales/en.default.schema.json"),
				'{"label":"Heading"}',
			);
		},
	);
});

test("a locale the merchant added with no source is preserved", async () => {
	await withProject(localeSource({ greeting: "Hi" }), async (projectRoot) => {
		await buildTheme({ projectRoot });
		writeOut(projectRoot, "locales/fr.json", '{"greeting":"Bonjour"}');
		const result = await buildTheme({ projectRoot });
		// fr has no source, so it is preserved rather than merged.
		assert.ok(!result.mergedLocales.includes("locales/fr.json"));
		assert.equal(
			readOutput(projectRoot, "locales/fr.json"),
			'{"greeting":"Bonjour"}',
		);
	});
});
