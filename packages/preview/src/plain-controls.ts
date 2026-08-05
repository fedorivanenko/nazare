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
import type { PreviewControl } from "./controls.js";

type PlainControlFact = {
	kind: string;
	name?: string;
	paramType?: string;
	required?: boolean;
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

/** `{% doc %}` `@param` lines — the author's statement of a snippet's props. */
export function controlsFromDocParams(
	facts: readonly PlainControlFact[],
): PreviewControl[] {
	const controls: PreviewControl[] = [];
	const seen = new Set<string>();
	for (const fact of facts) {
		if (fact.kind !== "declaresDocParam" || !fact.name || seen.has(fact.name)) {
			continue;
		}
		seen.add(fact.name);
		controls.push({
			name: fact.name,
			label: fact.name,
			kind: kindFromDocType(fact.paramType),
			required: fact.required ?? false,
			// `{% doc %}` has no syntax for a default. `[name]` says optional and
			// nothing more, so there is no default to state — and a prop the
			// declaration says nothing about renders nil, as it would on a
			// storefront. The preview used to answer a `{product}` param with its
			// own built-in product here, which was the package quietly owning
			// storefront data again.
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
						...(asNumber(entry.min) !== undefined
							? { min: asNumber(entry.min) }
							: {}),
						...(asNumber(entry.max) !== undefined
							? { max: asNumber(entry.max) }
							: {}),
						...(asNumber(entry.step) !== undefined
							? { step: asNumber(entry.step) }
							: {}),
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
			// A schema states its defaults outright, and a setting without one is
			// a setting the merchant has not filled in yet.
			...(entry.default !== undefined ? { defaultValue: entry.default } : {}),
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
	facts: readonly PlainControlFact[],
	schemaSource?: string,
): PreviewControl[] {
	return schemaSource !== undefined
		? controlsFromSchemaSource(schemaSource)
		: controlsFromDocParams(facts);
}
