/** Shopify objects whose availability varies by page/render context. Reads infer
 * a possible input, never a required argument without stronger evidence. */
export const CONTEXT_INPUT_OBJECTS = new Set([
	"product",
	"variant",
	"collection",
	"search",
	"recommendations",
]);
