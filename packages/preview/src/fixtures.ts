// Shopify-shaped stand-in data.
//
// These live in the preview, not in the components. A component that shipped
// its own mock product would disagree with its neighbour's in the same gallery
// — different currencies, different image sizes, forty different shops. One
// canonical set keeps every story comparable.
//
// None of this is storefront data. A fixture is tidy in ways a real catalogue is
// not: no 60-character titles, no missing compare-at price, no sold-out variant.
// A component that looks right here can still break on a real product.

/** Money is minor units on a storefront (2400 = $24.00), so fixtures match. */
export const money = {
	price: 2400,
	compareAtPrice: 4000,
	free: 0,
} as const;

/**
 * A 4:3 placeholder that needs no network — the CSP on a static page is ours.
 * Terse on purpose: a template that prints an image URL as text (a srcset, a
 * data attribute, a story caption) prints this whole string, so every character
 * of it is a character of noise in the workbench.
 */
const placeholderImage = (label: string): string =>
	`data:image/svg+xml,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><title>${label}</title><rect width="4" height="3" fill="#e4e4e7"/></svg>`,
	)}`;

export const image = {
	src: placeholderImage("product"),
	alt: "A placeholder product image",
	width: 400,
	height: 300,
	aspect_ratio: 4 / 3,
};

export const product = {
	id: 1,
	title: "Merino Crew Sweater",
	handle: "merino-crew-sweater",
	url: "/products/merino-crew-sweater",
	price: money.price,
	compare_at_price: money.compareAtPrice,
	available: true,
	featured_image: image,
	images: [image],
	vendor: "Nazare Supply",
	type: "Knitwear",
	tags: ["wool", "winter"],
	variants: [
		{
			id: 11,
			title: "Small",
			price: money.price,
			compare_at_price: money.compareAtPrice,
			available: true,
		},
		{
			id: 12,
			title: "Medium",
			price: money.price,
			compare_at_price: money.compareAtPrice,
			available: false,
		},
	],
};

export const collection = {
	id: 2,
	title: "Winter Essentials",
	handle: "winter-essentials",
	url: "/collections/winter-essentials",
	products_count: 1,
	products: [product],
	featured_image: image,
};

export const shop = {
	name: "Nazare Supply",
	currency: "USD",
	// Shopify's own money_format syntax, not a JS template placeholder.
	// biome-ignore lint/suspicious/noTemplateCurlyInString: storefront format string
	money_format: "${{amount}}",
	url: "https://example.myshopify.com",
};

/**
 * The stand-in data a project starts from, copied in by `preview fixtures init`
 * and thereafter the project's own files.
 *
 * Named for what it is: a seed, not a set of fixtures. Nothing resolves against
 * this map — a story names a file, `{ "$file": "fixtures/product.json" }`, so
 * there is no registry of names to know and the answer to "what is this?" is a
 * path you can open. Once `init` has run, these values are not consulted again.
 *
 * Objects only, and that is the whole rule: a fixture exists because JSON
 * cannot hold the thing — a product with its images, variants and compare-at
 * price — and because the components that take one should agree about the shop
 * they belong to. A number is not that. Scalars are literals; you type them.
 */
export const starterFixtures: Record<string, unknown> = {
	product,
	collection,
	image,
	shop,
};

/** A story pointing at a file: `{ "$file": "fixtures/product.json" }`. */
export type FixtureReference = { $file: string };

export const isFixtureReference = (value: unknown): value is FixtureReference =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as FixtureReference).$file === "string";

/**
 * Replaces `{ "$file": "fixtures/product.json" }` with what that file holds, so
 * a story can use storefront data it could never sensibly express inline.
 *
 * The reference is a path rather than a name: there is no registry to know, no
 * built-in set to shadow, and the answer to "what is this?" is a file you can
 * open. A path that does not resolve is left as the reference object rather
 * than silently becoming nil — the story then renders visibly wrong instead of
 * quietly empty, and the validator says which path.
 *
 * `read` is supplied by the caller, because this package reads nothing.
 */
export function resolveFixtures(
	props: Record<string, unknown>,
	read?: (path: string) => unknown,
): Record<string, unknown> {
	const resolved: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(props)) {
		if (!isFixtureReference(value)) {
			resolved[name] = value;
			continue;
		}
		const loaded = read?.(value.$file);
		resolved[name] = loaded === undefined ? value : loaded;
	}
	return resolved;
}

/** True when any prop pointed at a file, so the gallery can say so. */
export function usesFixtures(props: Record<string, unknown>): boolean {
	return Object.values(props).some(isFixtureReference);
}

/**
 * The `money` filter: minor units to the shop's format. Storefront money
 * formatting is per-shop and locale-aware; this is USD-shaped and fixed, which
 * is enough to tell "$24.00" from "$40.00" but is not a formatting reference.
 */
export function formatMoney(value: unknown, withCurrency = false): string {
	const cents = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(cents)) return String(value ?? "");
	const amount = (cents / 100).toFixed(2);
	return withCurrency ? `$${amount} USD` : `$${amount}`;
}
