export type SemanticType =
	| { kind: "string" }
	| { kind: "string-literal"; value: string }
	| { kind: "url" }
	| { kind: "boolean" }
	| { kind: "number" }
	| { kind: "number-literal"; value: number }
	| { kind: "money" }
	| { kind: "object"; name?: string; fields?: Record<string, SemanticType> }
	| { kind: "array"; element: SemanticType }
	| { kind: "literal"; value: unknown }
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
