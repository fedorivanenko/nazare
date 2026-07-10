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
	"ShopifyCart",
	"ShopifyCollection",
	"ShopifyCustomer",
	"ShopifyImage",
	"ShopifyMedia",
	"ShopifyPage",
	"ShopifyProduct",
	"ShopifyVariant",
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
