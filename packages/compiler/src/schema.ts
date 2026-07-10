// Emit pass: projects props .setting() metadata into Shopify {% schema %}
// JSON. Only props that opted into a setting appear; the semantic type picks
// the editor input (color picker, range, select, resource picker). Purely
// derived from the IR — never hand-maintained.
import type {
	ArtifactIR,
	PropDeclarationSyntaxNode,
	SemanticType,
	ThemeSchema,
	ThemeSchemaSetting,
} from "@nazare/core";

const shopifyObjectSettingTypes: Record<string, string> = {
	ShopifyArticle: "article",
	ShopifyBlog: "blog",
	ShopifyCollection: "collection",
	ShopifyFont: "font_picker",
	ShopifyImage: "image_picker",
	ShopifyLinklist: "link_list",
	ShopifyMetaobject: "metaobject",
	ShopifyPage: "page",
	ShopifyProduct: "product",
	ShopifyVideo: "video",
};

export type ThemeSchemaFromIROptions = {
	name: string;
};

export function themeSchemaFromIR(
	ir: ArtifactIR,
	options: ThemeSchemaFromIROptions,
): ThemeSchema {
	const settings: ThemeSchemaSetting[] = [];

	for (const node of ir.syntax) {
		if (node.kind !== "prop-declaration") continue;
		const setting = settingFromProp(node);
		if (setting) settings.push(setting);
	}

	return { name: options.name, settings };
}

function settingFromProp(
	prop: PropDeclarationSyntaxNode,
): ThemeSchemaSetting | undefined {
	const metadata = prop.typeInfo.setting;
	if (!metadata) return undefined;

	const input = settingInput(unwrapNil(prop.typeInfo.valueType));
	if (!input) return undefined;

	const setting: ThemeSchemaSetting = {
		type: input.type,
		id: prop.name,
		label: metadata.label ?? prop.name,
		...input.extra,
	};
	if (metadata.default !== undefined) setting.default = metadata.default;

	return setting;
}

/** Settings describe the value's shape; optionality (T | nil) is not part of it. */
function unwrapNil(type: SemanticType): SemanticType {
	if (type.kind !== "union") return type;
	const members = type.members.filter((member) => member.kind !== "nil");
	if (members.length === 1) return members[0];
	return { kind: "union", members };
}

function settingInput(
	type: SemanticType,
): { type: string; extra?: Partial<ThemeSchemaSetting> } | undefined {
	switch (type.kind) {
		case "string":
			return { type: "text" };
		case "richtext":
			return { type: "richtext" };
		case "url":
			return { type: "url" };
		case "color":
			return { type: "color" };
		case "handle":
			return { type: "text" };
		case "boolean":
			return { type: "checkbox" };
		case "money":
			return { type: "number" };
		case "number":
			return type.constraints
				? { type: "range", extra: { ...type.constraints } }
				: { type: "number" };
		case "union": {
			const literals = type.members.filter(
				(member) => member.kind === "string-literal",
			);
			if (literals.length !== type.members.length || literals.length === 0) {
				return undefined;
			}
			return {
				type: "select",
				extra: {
					options: literals.map((literal) => ({
						value: literal.value,
						label: literal.value,
					})),
				},
			};
		}
		case "object":
			return type.name && shopifyObjectSettingTypes[type.name]
				? { type: shopifyObjectSettingTypes[type.name] }
				: undefined;
		default:
			return undefined;
	}
}
