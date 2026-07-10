// The semantic type system: what a prop value can be. Types describe both
// Liquid runtime values and theme-editor setting inputs (color, richtext,
// range-constrained numbers). Assignability between these types is defined
// by the compiler's check pass, not here.

/**
 * Value-level constraints on a number type, mirroring Shopify range
 * settings. Constraints do not change assignability between types; they are
 * checked against literal values where those are known.
 */
export type NumberConstraints = {
	min?: number;
	max?: number;
	step?: number;
	unit?: string;
};

export type SemanticType =
	| { kind: "string" }
	| { kind: "string-literal"; value: string }
	| { kind: "url" }
	| { kind: "color" }
	| { kind: "richtext" }
	| { kind: "handle" }
	| { kind: "boolean" }
	| { kind: "number"; constraints?: NumberConstraints }
	| { kind: "number-literal"; value: number }
	| { kind: "money" }
	| { kind: "function"; returns?: SemanticType }
	| { kind: "object"; name?: string; fields?: Record<string, SemanticType> }
	| { kind: "array"; element: SemanticType }
	| { kind: "literal"; value: unknown }
	| { kind: "union"; members: SemanticType[] }
	| { kind: "nil" }
	| { kind: "unknown" };

export const shopifyObjectTypeNames = [
	"ShopifyArticle",
	"ShopifyBlock",
	"ShopifyBlog",
	"ShopifyCart",
	"ShopifyCollection",
	"ShopifyCustomer",
	"ShopifyFilter",
	"ShopifyFont",
	"ShopifyImage",
	"ShopifyLineItem",
	"ShopifyLink",
	"ShopifyLinklist",
	"ShopifyLocalization",
	"ShopifyMedia",
	"ShopifyMetafield",
	"ShopifyMetaobject",
	"ShopifyOrder",
	"ShopifyPage",
	"ShopifyPaginate",
	"ShopifyProduct",
	"ShopifyRoutes",
	"ShopifySection",
	"ShopifySellingPlan",
	"ShopifyShop",
	"ShopifyVariant",
	"ShopifyVideo",
] as const;

export type ShopifyObjectTypeName = (typeof shopifyObjectTypeNames)[number];

export type SettingMetadata = {
	label?: string;
	default?: unknown;
};

export type PropTypeInfo = {
	valueType: SemanticType;
	setting?: SettingMetadata;
};
