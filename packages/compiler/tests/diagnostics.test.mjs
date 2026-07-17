// Every "bad input -> diagnostic code" and "good input -> clean" guarantee
// the compiler makes, as one table. A row is: a source (plus optional
// imported files and whether to run emit), and either an expected code, a
// `clean` flag (no error-severity issues), or a custom check. Adding a
// diagnostic should be one row here.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

const LINK = `{% props { href: url.required(), text: string.required() } %}`;
const SPECIAL_LITERALS = `{% props { href: url.required(), color: color.required(), handle: handle.required(), text: string.required() } %}`;
const SETTING_LINK = `{% props {
  href: url.setting({ label: "Link" }),
  label: string.setting({ label: "Label", default: "Shop now" }),
  text: string.required(),
} %}`;
const FLEXIBLE = `{% props { href: url.or(string).required(), align: string.enum("left", "right") } %}`;
const GAUGE = `{% props { size: number.min(0).max(100).step(5).required() } %}`;
const SECTION = `{% component section %}
{% props { h: string.setting({ label: "H" }) } %}
<section>{{ props.h }}</section>`;
const BLOCK = `{% component block %}
{% props { m: string.setting({ label: "M" }) } %}
<div>{{ props.m }}</div>`;

const cases = [
	// --- render sites against a contract -----------------------------------
	{
		name: "valid snippet render is clean",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% props { u: url.setting({ label: "U" }) } %}\n{% render Link { href: props.u, text: "Go" } %}`,
		clean: true,
	},
	{
		name: "malformed Nazare render is an error",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% render Link href: "https://x.dev" %}`,
		expect: "NAZARE_PARSE_RENDER",
	},
	{
		name: "missing required prop",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% render Link { href: "https://x.dev" } %}`,
		expect: "CONSTRAINT_REQUIRED_PROP_MISSING",
	},
	{
		name: "unknown prop argument",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% render Link { href: "https://x.dev", text: "Go", bogus: "1" } %}`,
		expect: "CONSTRAINT_UNKNOWN_PROP_ARGUMENT",
	},
	{
		name: "duplicate render argument",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% render Link { href: "https://x.dev", href: "https://y.dev", text: "Go" } %}`,
		expect: "NAZARE_PARSE_DUPLICATE_RENDER_ARGUMENT",
	},
	{
		name: "malformed render argument is an error",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% render Link { href: "https://x.dev", text } %}`,
		expect: "NAZARE_PARSE_RENDER_ARGUMENT",
	},
	{
		name: "type mismatch: number into text prop",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% render Link { href: "https://x.dev", text: 42 } %}`,
		expect: "CONSTRAINT_PROP_TYPE_MISMATCH",
	},
	{
		name: "special props accept valid string literals",
		files: { "special.nz.liquid": SPECIAL_LITERALS },
		src: `{% import Special from "./special.nz.liquid" %}\n{% render Special { href: "https://x.dev", color: "oklch(60% 0.2 30)", handle: "product-handle", text: "Go" } %}`,
		clean: true,
	},
	{
		name: "special props validate string literal values",
		files: { "special.nz.liquid": SPECIAL_LITERALS },
		src: `{% import Special from "./special.nz.liquid" %}\n{% render Special { href: "", color: "notacolor", handle: "Bad Handle", text: "Go" } %}`,
		check: (r) => {
			assert.equal(
				codes(r).filter((code) => code === "CONSTRAINT_PROP_VALUE_INVALID")
					.length,
				3,
			);
		},
	},
	{
		name: "type mismatch: string prop is not a url",
		files: { "link.nz.liquid": LINK },
		src: `{% import Link from "./link.nz.liquid" %}\n{% props { s: string.required() } %}\n{% render Link { href: props.s, text: "Go" } %}`,
		check: (r) => assert.ok(codes(r).includes("CONSTRAINT_PROP_TYPE_MISMATCH")),
	},
	{
		name: "money props reject string literals",
		files: { "price.nz.liquid": `{% props { amount: Money.required() } %}` },
		src: `{% import Price from "./price.nz.liquid" %}\n{% render Price { amount: "$12.00" } %}`,
		expect: "CONSTRAINT_PROP_TYPE_MISMATCH",
	},
	{
		name: "union prop accepts a member",
		files: { "f.nz.liquid": FLEXIBLE },
		src: `{% import F from "./f.nz.liquid" %}\n{% render F { href: "https://x.dev", align: "left" } %}`,
		clean: true,
	},
	{
		name: "union enum rejects a non-member",
		files: { "f.nz.liquid": FLEXIBLE },
		src: `{% import F from "./f.nz.liquid" %}\n{% render F { href: "https://x.dev", align: "middle" } %}`,
		expect: "CONSTRAINT_PROP_TYPE_MISMATCH",
	},
	{
		name: "number in range is clean",
		files: { "g.nz.liquid": GAUGE },
		src: `{% import G from "./g.nz.liquid" %}\n{% render G { size: 25 } %}`,
		clean: true,
	},
	{
		name: "number above max is out of range",
		files: { "g.nz.liquid": GAUGE },
		src: `{% import G from "./g.nz.liquid" %}\n{% render G { size: 150 } %}`,
		expect: "CONSTRAINT_PROP_VALUE_OUT_OF_RANGE",
	},
	{
		name: "number off-step is out of range",
		files: { "g.nz.liquid": GAUGE },
		src: `{% import G from "./g.nz.liquid" %}\n{% render G { size: 27 } %}`,
		expect: "CONSTRAINT_PROP_VALUE_OUT_OF_RANGE",
	},
	{
		name: "unknown type-expression call is an error",
		src: `{% props { title: string.requried() } %}`,
		expect: "NAZARE_PARSE_TYPE_EXPRESSION",
	},
	{
		name: "unreadable import: not found + unresolved contract",
		src: `{% import Card from "./card.nz.liquid" %}\n{% render Card { title: "Hi" } %}`,
		check: (r) => {
			assert.ok(codes(r).includes("IMPORT_NOT_FOUND"));
			assert.ok(codes(r).includes("CONSTRAINT_UNRESOLVED_EXTERNAL_CONTRACT"));
		},
	},
	{
		name: "rendering a section is an error",
		files: { "s.nz.liquid": SECTION },
		src: `{% import S from "./s.nz.liquid" %}\n{% render S {} %}`,
		expect: "CONSTRAINT_RENDER_TARGET_NOT_SNIPPET",
	},

	// --- props ------------------------------------------------------------
	{
		name: "reading an undeclared prop",
		src: `{% props { text: string.required() } %}\n<span>{{ props.ghost }}</span>`,
		expect: "CONSTRAINT_UNKNOWN_PROPS_REFERENCE",
	},
	{
		name: "duplicate prop declaration",
		src: `{% props { text: string.required(), text: string.default("x") } %}`,
		expect: "NAZARE_PARSE_DUPLICATE_PROP_DECLARATION",
	},

	// --- kind -------------------------------------------------------------
	{
		name: "section with a render-arg prop",
		src: `{% component section %}\n{% props { start: number.default(0) } %}\n<div>{{ props.start }}</div>`,
		expect: "CONSTRAINT_SECTION_PROP_NOT_SETTING",
	},
	{
		name: "section with only settings is clean",
		src: `{% component section %}\n{% props { start: number.setting({ label: "S" }) } %}\n<div>{{ props.start }}</div>`,
		clean: true,
	},
	{
		name: "unknown component kind",
		src: `{% component widget %}\n<div>x</div>`,
		expect: "NAZARE_PARSE_COMPONENT_KIND",
	},
	{
		name: "component kind declared twice",
		src: `{% component section %}\n{% component block %}\n<div>x</div>`,
		expect: "NAZARE_PARSE_DUPLICATE_COMPONENT",
	},

	// --- refs -------------------------------------------------------------
	{
		name: "ref access with no matching element",
		src: `<div ref="root"></div>\n{% script %}\nisland(({ refs }) => { refs.root.remove(); refs.panel.hidden = false; });\n{% endscript %}`,
		expect: "CONSTRAINT_UNKNOWN_REF",
	},
	{
		name: "duplicate ref names",
		src: `<div ref="item"></div>\n<span ref="item"></span>\n{% script %}\nisland(({ refs }) => refs.item.remove());\n{% endscript %}`,
		expect: "CONSTRAINT_DUPLICATE_REF",
	},
	{
		name: "declared-but-unaccessed ref warns",
		src: `<div ref="root"></div>\n<div ref="ghost"></div>\n{% script %}\nisland(({ refs }) => refs.root.remove());\n{% endscript %}`,
		expect: "CONSTRAINT_UNUSED_REF",
	},
	{
		name: "no unused-ref warning without a script",
		src: `<div ref="root"></div>\n<div ref="ghost"></div>`,
		check: (r) => assert.ok(!codes(r).includes("CONSTRAINT_UNUSED_REF")),
	},
	{
		name: "dynamic ref value warns and is dropped",
		src: `<div ref="{{ dynamic }}"></div>`,
		check: (r) => {
			assert.ok(codes(r).includes("NAZARE_PARSE_REF_ATTRIBUTE"));
			assert.equal(
				r.ir.syntax.filter((n) => n.kind === "element-ref").length,
				0,
			);
		},
	},
	{
		name: "ref mentions in comments/strings are not accesses",
		src: `<div ref="root"></div>\n<div ref="ghost"></div>\n{% script %}\n// refs.ghost in a comment\nconst note = "refs.ghost";\nisland(({ refs }) => refs.root.setAttribute("n", note));\n{% endscript %}`,
		check: (r) => {
			const unused = r.issues.filter((i) => i.code === "CONSTRAINT_UNUSED_REF");
			assert.equal(unused.length, 1);
			assert.ok(unused[0].message.includes("ghost"));
		},
	},
	{
		name: "script cannot shadow reserved refs/data context names",
		src: `<div></div>\n{% script %}\nconst refs = {};\nexport default island(({ data }) => data);\n{% endscript %}`,
		expect: "SCRIPT_RESERVED_CONTEXT_SHADOWED",
	},

	// --- data channel -----------------------------------------------------
	{
		name: "reading an unbound data property",
		src: `<div ref="root"></div>\n{% script %}\nexport default island(({ data }) => console.log(data.root.ghost));\n{% endscript %}`,
		expect: "CONSTRAINT_UNKNOWN_DATA_ACCESS",
	},
	{
		name: "unread data binding warns",
		src: `{% props { step: number.default(1) } %}\n<div ref="root" data-step="{{ props.step }}"></div>\n{% script %}\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`,
		expect: "CONSTRAINT_UNUSED_DATA_BINDING",
	},
	{
		name: "data binding an undeclared prop",
		src: `<div ref="root" data-step="{{ props.ghost }}"></div>\n{% script %}\nexport default island(({ data }) => console.log(data.root.step));\n{% endscript %}`,
		expect: "CONSTRAINT_UNKNOWN_PROPS_REFERENCE",
	},
	{
		name: "kebab-case data attributes are clean",
		src: `{% props { max_count: number.default(9) } %}\n<div ref="root" data-max-count="{{ props.max_count }}"></div>\n{% script %}\nexport default island(({ data }) => console.log(data.root.maxCount));\n{% endscript %}`,
		check: (r) => assert.ok(!codes(r).some((c) => c.includes("DATA"))),
	},

	// --- blocks -----------------------------------------------------------
	{
		name: "blocks slot outside a section",
		src: `{% component block %}\n<div>{% blocks %}</div>`,
		expect: "CONSTRAINT_BLOCKS_SLOT_OUTSIDE_SECTION",
	},
	{
		name: "more than one blocks slot",
		src: `{% component section %}\n<section>{% blocks %}{% blocks %}</section>`,
		expect: "CONSTRAINT_MULTIPLE_BLOCKS_SLOTS",
	},
	{
		name: "quoted blocks markup is invalid (names are imports now)",
		src: `{% component section %}\n<section>{% blocks "notice" %}</section>`,
		expect: "NAZARE_PARSE_BLOCKS_SLOT",
	},
	{
		name: "valid block slot is clean",
		files: { "notice.nz.liquid": BLOCK },
		src: `{% component section %}\n{% import Notice from "./notice.nz.liquid" %}\n<section>{% blocks Notice %}</section>`,
		clean: true,
	},
	{
		name: "bare blocks slot (any theme block) is clean",
		src: `{% component section %}\n<section>{% blocks %}</section>`,
		clean: true,
	},
	{
		name: "blocks names an unimported component",
		src: `{% component section %}\n<section>{% blocks Ghost %}</section>`,
		expect: "CONSTRAINT_BLOCKS_SLOT_UNKNOWN_REFERENCE",
	},
	{
		name: "offering a section as a block",
		files: { "s.nz.liquid": SECTION },
		src: `{% component section %}\n{% import S from "./s.nz.liquid" %}\n<section>{% blocks S %}</section>`,
		expect: "CONSTRAINT_BLOCKS_SLOT_NOT_A_BLOCK",
	},

	// --- css modules ------------------------------------------------------
	{
		name: "unknown styles.x reference",
		src: `<div class="{{ styles.ghost }}"></div>\n{% stylesheet styles %}\n.wrapper { display: flex; }\n{% endstylesheet %}`,
		expect: "CONSTRAINT_UNKNOWN_STYLE_CLASS",
	},
	{
		name: "style references are checked against their own binding",
		src: `{% stylesheet cardStyles %}\n.card { color: red; }\n{% endstylesheet %}\n{% stylesheet linkStyles %}\n.link { color: blue; }\n{% endstylesheet %}\n<div class="{{ cardStyles.link }}"></div>`,
		expect: "CONSTRAINT_UNKNOWN_STYLE_CLASS",
	},
	{
		name: "unused class in a bound sheet warns",
		src: `<div class="{{ styles.wrapper }}"></div>\n{% stylesheet styles %}\n.wrapper { display: flex; }\n.orphan { color: red; }\n{% endstylesheet %}`,
		expect: "CONSTRAINT_UNUSED_STYLE_CLASS",
	},
	{
		name: "capitalized stylesheet binding",
		src: `<div></div>\n{% stylesheet Styles %}\n.w { color: red; }\n{% endstylesheet %}`,
		expect: "NAZARE_IMPORT_BINDING_CASE",
	},
	{
		name: "malformed stylesheet binding",
		src: `<div></div>\n{% stylesheet "styles" %}\n.w { color: red; }\n{% endstylesheet %}`,
		expect: "NAZARE_PARSE_STYLESHEET_BINDING",
	},
	{
		name: "declarations and urls are not classes (no false unused)",
		src: `<div class="{{ styles.w }}"></div>\n{% stylesheet styles %}\n.w { background: url(img.png); margin: 0.5rem; }\n{% endstylesheet %}`,
		check: (r) =>
			assert.deepEqual(
				r.issues.filter((i) => i.code === "CONSTRAINT_UNUSED_STYLE_CLASS"),
				[],
			),
	},
	{
		name: "unbound stylesheet is not inspected",
		src: `<div class="w"></div>\n{% stylesheet %}\n.w { color: blue; }\n{% endstylesheet %}`,
		check: (r) => assert.ok(!codes(r).some((c) => c.includes("STYLE_CLASS"))),
	},

	// --- islands ----------------------------------------------------------
	{
		name: "island names no imported behavior",
		files: { "counter.ts": `export default island(() => {});\n` },
		src: `{% import counter from "./counter.ts" %}\n<div><section island="toggle"></section></div>`,
		expect: "CONSTRAINT_UNKNOWN_ISLAND",
	},
	{
		name: "behavior placed twice",
		files: { "counter.ts": `export default island(() => {});\n` },
		src: `{% import counter from "./counter.ts" %}\n<div><section island="counter"></section><aside island="counter"></aside></div>`,
		expect: "CONSTRAINT_DUPLICATE_ISLAND",
	},
	{
		name: "dynamic island value warns, not unknown-island",
		files: { "counter.ts": `export default island(() => {});\n` },
		src: `{% import counter from "./counter.ts" %}\n<div><section island="{{ x }}"></section></div>`,
		check: (r) => {
			assert.ok(codes(r).includes("NAZARE_PARSE_REF_ATTRIBUTE"));
			assert.ok(!codes(r).includes("CONSTRAINT_UNKNOWN_ISLAND"));
		},
	},

	// --- imports ----------------------------------------------------------
	{
		name: "side-effect import form",
		src: `{% import "./x.ts" %}\n<div></div>`,
		expect: "NAZARE_PARSE_IMPORT",
	},
	{
		name: "bare specifier",
		src: `{% import widget from "widget" %}\n<div></div>`,
		expect: "NAZARE_IMPORT_BARE_SPECIFIER",
	},
	{
		name: "import escaping the project root",
		file: "a/b/c.nz.liquid",
		src: `{% import x from "../../../outside/util.ts" %}\n<div></div>`,
		expect: "NAZARE_IMPORT_OUTSIDE_PROJECT",
	},
	{
		name: "unsupported import extension",
		src: `{% import data from "./data.json" %}\n<div></div>`,
		expect: "NAZARE_IMPORT_UNSUPPORTED_EXTENSION",
	},
	{
		name: "duplicate import binding",
		files: {
			"a.ts": `export default island(() => {});`,
			"b.ts": `export default island(() => {});`,
		},
		src: `{% import behavior from "./a.ts" %}\n{% import behavior from "./b.ts" %}\n<div></div>`,
		expect: "NAZARE_PARSE_DUPLICATE_IMPORT",
	},
	{
		name: "lowercase component import name",
		src: `{% import card from "./card.nz.liquid" %}\n<div></div>`,
		expect: "NAZARE_IMPORT_COMPONENT_CASE",
	},
	{
		name: "capitalized behavior import name",
		src: `{% import Widget from "./widget.ts" %}\n<div></div>`,
		expect: "NAZARE_IMPORT_BINDING_CASE",
	},
	{
		name: "unreadable behavior import",
		src: `{% import missing from "./missing.ts" %}\n<div></div>`,
		expect: "IMPORT_NOT_FOUND",
	},

	// --- behavior module syntax ------------------------------------------
	{
		name: "import-equals in a script",
		src: `<div ref="root"></div>\n{% script lang="ts" %}\nimport lodash = require("lodash");\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`,
		expect: "SCRIPT_MODULE_SYNTAX_UNSUPPORTED",
	},
	{
		name: "relative and type-only imports are allowed",
		src: `<div ref="root"></div>\n{% script lang="ts" %}\nimport type { T } from "./t.ts";\nimport { d } from "./u.ts";\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`,
		check: (r) =>
			assert.ok(!codes(r).includes("SCRIPT_MODULE_SYNTAX_UNSUPPORTED")),
	},

	// --- setting hoisting errors -----------------------------------------
	{
		name: "same alias twice with unfilled settings",
		files: { "link.nz.liquid": SETTING_LINK },
		src: `{% component section %}\n{% import PromoLink from "./link.nz.liquid" %}\n{% render PromoLink { text: "A" } %}\n{% render PromoLink { text: "B" } %}`,
		expect: "CONSTRAINT_HOISTED_ALIAS_REUSED",
	},
	{
		name: "hoisted setting id collides with an own setting",
		files: { "link.nz.liquid": SETTING_LINK },
		src: `{% component section %}\n{% import PromoLink from "./link.nz.liquid" %}\n{% props { promo_link_href: url.setting({ label: "Mine" }) } %}\n{% render PromoLink { text: "Go" } %}`,
		expect: "CONSTRAINT_HOISTED_SETTING_COLLISION",
	},

	// --- vanilla liquid sections -----------------------------------------
	{
		name: "typo'd section setting read",
		src: `<div>{% if section.settings.lnik != blank %}x{% endif %}</div>\n{% schema %}\n{ "name": "S", "settings": [{ "type": "url", "id": "link" }] }\n{% endschema %}`,
		expect: "CONSTRAINT_UNKNOWN_SETTING_READ",
	},
	{
		name: "valid vanilla section is clean",
		src: `<div>{{ section.settings.title }}</div>\n{% schema %}\n{ "name": "S", "settings": [{ "type": "text", "id": "title" }] }\n{% endschema %}`,
		check: (r) =>
			assert.ok(!codes(r).includes("CONSTRAINT_UNKNOWN_SETTING_READ")),
	},
	{
		name: "invalid schema json",
		src: `<div></div>\n{% schema %}\n{ "name": "S", trailing garbage }\n{% endschema %}`,
		expect: "NAZARE_SCHEMA_INVALID_JSON",
	},
	{
		name: "broken liquid is a diagnostic not a crash",
		src: `<div>{% if %}{% endunless %}</div>`,
		expect: "NAZARE_PARSE_LIQUID",
	},

	// --- script bundling (emit phase) ------------------------------------
	{
		name: "missing bundled module",
		emit: true,
		files: {
			"components/w/w.ts": `import { gone } from "./missing.ts";\nexport default island(() => {});\n`,
		},
		file: "components/w/w.nz.liquid",
		src: `{% import w from "./w.ts" %}\n<div ref="root"></div>`,
		expect: "SCRIPT_IMPORT_NOT_FOUND",
	},
	{
		name: "bundled import cycle",
		emit: true,
		files: {
			"components/w/w.ts": `import "./a.ts";\nexport default island(() => {});\n`,
			"components/w/a.ts": `import "./b.ts";\nexport const a = 1;\n`,
			"components/w/b.ts": `import "./a.ts";\nexport const b = 2;\n`,
		},
		file: "components/w/w.nz.liquid",
		src: `{% import w from "./w.ts" %}\n<div ref="root"></div>`,
		expect: "SCRIPT_IMPORT_CYCLE",
	},
	{
		name: "bare package import in a script",
		emit: true,
		src: `<div ref="root"></div>\n{% script %}\nimport { gone } from "@x/missing";\nexport default island(() => {});\n{% endscript %}`,
		expect: "SCRIPT_IMPORT_BARE",
	},
];

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

for (const c of cases) {
	test(`diag: ${c.name}`, () => {
		const readFile = c.files ? (path) => c.files[path] : undefined;
		const result = compileNazareArtifact(
			c.src,
			c.file ?? "component.nz.liquid",
			{ readFile },
		);
		const issues = [...result.issues];
		if (c.emit) {
			issues.push(...emitTheme(c.src, result, { name: "w", readFile }).issues);
		}
		const merged = { ...result, issues };

		if (c.check) {
			c.check(merged);
			return;
		}
		if (c.clean) {
			assert.deepEqual(
				issues.filter((i) => i.severity === "error"),
				[],
				`expected no errors for "${c.name}"`,
			);
			return;
		}
		assert.ok(
			issues.some((i) => i.code === c.expect),
			`expected ${c.expect} for "${c.name}", got: ${issues.map((i) => i.code).join(", ")}`,
		);
	});
}
