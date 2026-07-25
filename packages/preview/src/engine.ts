// The Liquid engine the preview renders with.
//
// This is a *preview* engine, not Shopify's. liquidjs implements the Liquid
// language; Shopify's runtime adds tags, filters, and global objects on top of
// it, and the two differ in places that fail silently (a bare `size` lookup
// resolves to the scope's size in liquidjs, to nil in Shopify). Everything the
// storefront provides and this engine does not is stubbed below, deliberately
// and visibly. Treat the output as a design-system workbench, never as proof a
// template will behave on a store.
import { Liquid, type TopLevelToken } from "liquidjs";
import { formatMoney } from "./fixtures.js";

export type PreviewEngineOptions = {
	/** Emitted snippets by name (no extension), so `{% render 'x' %}` resolves. */
	snippets?: Record<string, string>;
	/** Prefix for `asset_url`. Points at wherever the gallery writes assets. */
	assetBase?: string;
};

/**
 * An in-memory filesystem for the render tag: preview sources never touch disk,
 * and a snippet the caller did not provide must fail loudly rather than reach
 * into the real filesystem.
 */
function memoryFileSystem(snippets: Record<string, string>) {
	const lookup = (path: string): string | undefined =>
		snippets[path.replace(/\.liquid$/, "")];
	return {
		sep: "/",
		resolve: (_dir: string, file: string) => file,
		dirname: () => "",
		exists: async (path: string) => lookup(path) !== undefined,
		existsSync: (path: string) => lookup(path) !== undefined,
		readFile: async (path: string) => {
			const source = lookup(path);
			if (source === undefined) throw new Error(`No preview snippet ${path}`);
			return source;
		},
		readFileSync: (path: string) => {
			const source = lookup(path);
			if (source === undefined) throw new Error(`No preview snippet ${path}`);
			return source;
		},
	};
}

export function createPreviewEngine(
	options: PreviewEngineOptions = {},
): Liquid {
	const snippets = options.snippets ?? {};
	const assetBase = options.assetBase ?? "./assets";
	const engine = new Liquid({
		fs: memoryFileSystem(snippets) as never,
		extname: ".liquid",
	});

	// Shopify-only tags. `doc` and `schema` carry metadata the compiler already
	// consumed, so the preview drops their bodies rather than parsing them.
	for (const tag of ["doc", "schema", "javascript", "stylesheet"]) {
		engine.registerTag(tag, {
			parse(_token: unknown, remaining: TopLevelToken[]) {
				while (remaining.length) {
					const next = remaining.shift() as { name?: string } | undefined;
					if (next?.name === `end${tag}`) break;
				}
			},
			render: () => "",
		});
	}

	// `{% content_for 'blocks' %}` is where the theme editor injects blocks. The
	// preview has no merchant block instances, so it renders a labelled slot
	// rather than nothing — an empty section otherwise looks like a bug.
	engine.registerTag("content_for", {
		parse(token: { args?: string; markup?: string }) {
			(this as { markup?: string }).markup = (
				token.args ??
				token.markup ??
				""
			).trim();
		},
		render() {
			const target = (this as { markup?: string }).markup ?? "";
			const label = target.replace(/^['"]|['"]$/g, "") || "content";
			return `<div class="preview-slot" data-content-for="${label}">theme ${label} render here</div>`;
		},
	});

	// `{% style %}` is Shopify's inline-CSS tag; liquidjs has no equivalent.
	engine.registerTag("style", {
		parse(_token: unknown, remaining: TopLevelToken[]) {
			const body: string[] = [];
			while (remaining.length) {
				const next = remaining.shift() as
					| { name?: string; getText?: () => string }
					| undefined;
				if (!next || next.name === "endstyle") break;
				body.push(next.getText?.() ?? "");
			}
			(this as { body?: string }).body = body.join("");
		},
		render() {
			return `<style>${(this as { body?: string }).body ?? ""}</style>`;
		},
	});

	// Shopify filters the emitted output actually uses. Anything not listed here
	// is missing on purpose — add it when a component needs it, so the gap stays
	// visible instead of silently rendering an empty string.
	engine.registerFilter(
		"asset_url",
		(value: string) => `${assetBase}/${value}`,
	);
	engine.registerFilter(
		"asset_img_url",
		(value: string) => `${assetBase}/${value}`,
	);
	engine.registerFilter("stylesheet_tag", (value: string) =>
		value ? `<link rel="stylesheet" href="${value}">` : "",
	);
	engine.registerFilter("script_tag", (value: string) =>
		value ? `<script src="${value}"></script>` : "",
	);
	// `t` without a locale bundle: echo the key so a missing translation is
	// obvious in the preview rather than blank.
	engine.registerFilter("t", (value: string) => value);

	// Money filters. Storefront formatting is per-shop and locale-aware; these
	// are USD-shaped and fixed — enough to read a price and a strikethrough, not
	// a formatting reference. See fixtures.ts.
	engine.registerFilter("money", (value: unknown) => formatMoney(value));
	engine.registerFilter("money_with_currency", (value: unknown) =>
		formatMoney(value, true),
	);
	engine.registerFilter("money_without_currency", (value: unknown) =>
		formatMoney(value).replace("$", ""),
	);

	// Image URL filters take a size argument on a storefront; the fixture images
	// are a single placeholder, so the size is accepted and ignored.
	const imageSource = (value: unknown): string => {
		if (typeof value === "string") return value;
		const source = (value as { src?: unknown } | undefined)?.src;
		return typeof source === "string" ? source : "";
	};
	engine.registerFilter("img_url", imageSource);
	engine.registerFilter("image_url", imageSource);

	return engine;
}

/**
 * The scope a story's props are rendered in. Emit lowers a snippet's props to
 * bare variables, but a section's to `section.settings.*` and a block's to
 * `block.settings.*` — so props handed to a section have to arrive shaped like
 * the settings object Shopify would pass, or every setting reads blank.
 */
export function renderContext(
	props: Record<string, unknown>,
	kind: string | undefined,
	name = "preview",
): Record<string, unknown> {
	if (kind === "section") {
		return { section: { id: `preview-${name}`, settings: props, blocks: [] } };
	}
	if (kind === "block") {
		return { block: { id: `preview-${name}`, type: name, settings: props } };
	}
	return props;
}

export async function renderPreview(
	engine: Liquid,
	source: string,
	context: Record<string, unknown>,
): Promise<string> {
	return (await engine.parseAndRender(source, context)).trim();
}
