// Emit pass: projects props .setting() metadata into Shopify {% schema %}
// JSON. Only props that opted into a setting appear; the semantic type picks
// the editor input (color picker, range, select, resource picker). Purely
// derived from the IR — never hand-maintained.
import type {
	ArtifactContract,
	ArtifactIR,
	PropDeclarationSyntaxNode,
	PropTypeInfo,
	SemanticType,
	ThemeSchema,
	ThemeSchemaSetting,
} from "@nazare/core";
import { humanizeAlias, resolveHoistedSettings } from "./hoist.js";

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
	/** Dependency contracts; enables hoisted settings in the schema. */
	contracts?: ArtifactContract[];
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

	// Hoisted settings group under one header per component alias, with the
	// leaf's own labels unmodified beneath it.
	const { hoisted } = resolveHoistedSettings(ir, options.contracts);
	let currentGroup: string | undefined;
	for (const entry of hoisted) {
		if (entry.alias !== currentGroup) {
			currentGroup = entry.alias;
			settings.push({ type: "header", content: humanizeAlias(entry.alias) });
		}
		const setting = settingFor(
			entry.settingId,
			entry.typeInfo,
			entry.sourcePropName,
		);
		if (setting) {
			setting.info = `From ${entry.sourcePackageId}`;
			settings.push(setting);
		}
	}

	return { name: options.name, settings };
}

function settingFromProp(
	prop: PropDeclarationSyntaxNode,
): ThemeSchemaSetting | undefined {
	return settingFor(prop.name, prop.typeInfo, prop.name);
}

function settingFor(
	id: string,
	typeInfo: PropTypeInfo,
	fallbackLabel: string,
): ThemeSchemaSetting | undefined {
	const metadata = typeInfo.setting;
	if (!metadata) return undefined;

	const input = settingInput(unwrapNil(typeInfo.valueType));
	if (!input) return undefined;

	const setting: ThemeSchemaSetting = {
		type: input.type,
		id,
		label: metadata.label ?? fallbackLabel,
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
