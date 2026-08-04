export {
	type ShopifyBehavior,
	type ShopifyDeclaration,
	type ShopifyFileClassification,
	type ShopifyReference,
	type ShopifyTargetFact,
	type ShopifyTargetFacts,
	shopifyProducts,
	shopifySemanticTarget,
} from "./products.js";
export {
	registerShopifyResolutionComputations,
	type ShopifyReferenceQuery,
	type ShopifyReferenceResolution,
	type ShopifyResolutionPlan,
	type ShopifySymbolQuery,
	shopifyResolutionProducts,
} from "./resolution.js";
export {
	classifyShopifyFile,
	type ShopifyFileRole,
	shopifyResourceName,
} from "./role.js";
