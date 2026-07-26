// Controls for plain Liquid.
//
// A Nazare component states its interface in `{% props %}` and the compiler
// hands the preview a contract. Plain Liquid states it too — just in Shopify's
// own vocabulary: `{% doc %}` `@param` lines for a snippet, `{% schema %}`
// settings for a section. Both are declarations, both are already parsed by the
// compiler, and neither was reaching the controls: a plain component previewed
// with no props at all, which for most real snippets renders blank.
//
// So this is the same pass as controls.ts against a different declaration
// source. Nothing here infers an interface from a template's body — an
// undeclared prop stays undeclared, and the story that needs it says so.
import type { ThemeFact } from "@nazare/compiler";
import type { PreviewControl } from "./controls.js";
import { shopifyFixtures } from "./fixtures.js";

type DocParam = Extract<ThemeFact, { kind: "declaresDocParam" }>;

/**
 * A `@param {product} product` names a storefront object, and the preview
 * already owns one. Without this a story would open on the string "product".
 */
const FIXTURE_TYPES: Record<string, string> = {
	product: "product",
	collection: "collection",
	image: "image",
	shop: "shop",
};

/** `{string}`, `{number}`, `{boolean}` — Shopify's doc types, loosely written. */
function kindFromDocType(type: string | undefined): PreviewControl["kind"] {
	switch (type?.toLowerCase().replace(/\[\]$/, "")) {
		case "boolean":
			return "boolean";
		case "number":
			return "number";
		case "color":
			return "color";
		case "url":
			return "url";
		default:
			return "text";
	}
}

function docParamValue(param: DocParam): unknown {
	const type = param.paramType?.toLowerCase();
	if (type && type in FIXTURE_TYPES)
		return shopifyFixtures[FIXTURE_TYPES[type]];
	switch (kindFromDocType(param.paramType)) {
		case "boolean":
			return false;
		case "number":
			return 0;
		case "color":
			return "#111111";
		case "url":
			return "#";
		default:
			// The prop's own name, as a contract-derived string control does: a
			// story that renders nothing by default teaches nothing.
			return param.name;
	}
}

/** `{% doc %}` `@param` lines — the author's statement of a snippet's props. */
export function controlsFromDocParams(facts: ThemeFact[]): PreviewControl[] {
	const controls: PreviewControl[] = [];
	const seen = new Set<string>();
	for (const fact of facts) {
		if (fact.kind !== "declaresDocParam" || seen.has(fact.name)) continue;
		seen.add(fact.name);
		controls.push({
			name: fact.name,
			label: fact.name,
			kind: kindFromDocType(fact.paramType),
			required: fact.required,
			value: docParamValue(fact),
			typeExpression: fact.paramType ?? "unknown",
		});
	}
	return controls;
}

type SchemaSetting = {
	type?: unknown;
	id?: unknown;
	label?: unknown;
	default?: unknown;
	min?: unknown;
	max?: unknown;
	step?: unknown;
	options?: unknown;
};

const asNumber = (value: unknown): number | undefined =>
	typeof value === "number" ? value : undefined;

/** A `select` or `radio` setting's option values, in declaration order. */
function settingOptions(setting: SchemaSetting): string[] | undefined {
	if (!Array.isArray(setting.options)) return undefined;
	const values = setting.options
		.map((option) => (option as { value?: unknown } | undefined)?.value)
		.filter((value): value is string => typeof value === "string");
	return values.length > 0 ? values : undefined;
}

function kindFromSettingType(type: string): PreviewControl["kind"] {
	switch (type) {
		case "checkbox":
			return "boolean";
		case "range":
		case "number":
			return "number";
		case "color":
		case "color_background":
			return "color";
		case "url":
			return "url";
		case "richtext":
		case "inline_richtext":
		case "html":
			return "richtext";
		default:
			return "text";
	}
}

function settingValue(
	setting: SchemaSetting,
	kind: PreviewControl["kind"],
	options: string[] | undefined,
): unknown {
	if (setting.default !== undefined) return setting.default;
	if (options) return options[0];
	switch (kind) {
		case "boolean":
			return false;
		case "number":
			return asNumber(setting.min) ?? 0;
		case "color":
			return "#111111";
		case "url":
			return "#";
		default:
			return typeof setting.label === "string"
				? setting.label
				: String(setting.id);
	}
}

/**
 * A section's `{% schema %}` settings. This is what the theme editor would
 * show a merchant, so it is exactly the right control set — Shopify's own
 * declaration, read rather than re-stated.
 *
 * The body arrives as unparsed JSON (`AuthoredSchema.source`): the compiler
 * validates its shape and keeps ids and types as facts, dropping the labels,
 * defaults, and options a control needs. A schema that does not parse yields no
 * controls; the compiler has already reported why.
 */
export function controlsFromSchemaSource(source: string): PreviewControl[] {
	let parsed: { settings?: unknown };
	try {
		parsed = JSON.parse(source) as { settings?: unknown };
	} catch {
		return [];
	}
	if (!Array.isArray(parsed.settings)) return [];
	const controls: PreviewControl[] = [];
	for (const entry of parsed.settings as SchemaSetting[]) {
		const type = typeof entry.type === "string" ? entry.type : undefined;
		const id = typeof entry.id === "string" ? entry.id : undefined;
		// header and paragraph are chrome for the editor, not inputs.
		if (!type || !id || type === "header" || type === "paragraph") continue;
		const options = settingOptions(entry);
		const kind = options ? "select" : kindFromSettingType(type);
		const range =
			type === "range"
				? {
						min: asNumber(entry.min) ?? 0,
						max: asNumber(entry.max) ?? 100,
						step: asNumber(entry.step) ?? 1,
					}
				: undefined;
		controls.push({
			name: id,
			label: typeof entry.label === "string" ? entry.label : id,
			kind,
			// A schema setting always has a value in the editor; none are required.
			required: false,
			...(options ? { options } : {}),
			...(range ? { range } : {}),
			value: settingValue(entry, kind, options),
			typeExpression: type,
		});
	}
	return controls;
}

/**
 * The declared interface of a plain-Liquid component: its schema settings when
 * it has a schema, its doc params otherwise. Not merged — a section's props
 * arrive as `section.settings`, a snippet's as bare variables, so mixing the
 * two would produce a story that cannot render in either scope.
 */
export function plainLiquidControls(
	facts: ThemeFact[],
	schemaSource?: string,
): PreviewControl[] {
	const fromSchema = schemaSource ? controlsFromSchemaSource(schemaSource) : [];
	return fromSchema.length > 0 ? fromSchema : controlsFromDocParams(facts);
}
