// The call that produces a story: what you paste into a theme to get this.
//
// Storybook's "Show code" serialises the args it rendered with, which is a
// faithful description of a JavaScript call. Shopify has no such call — a
// snippet is reached by `{% render %}`, a section by a template's JSON, a block
// by the section it sits in. So the useful snippet is different per kind, and
// it is the one thing a component registry can give that a generic workbench
// cannot: not "here is what the story passed" but "here is the line that
// reproduces it in your theme".
//
// The story's own props are what appear. A case states its delta and the
// declaration supplies the rest, so the delta is exactly what a caller has to
// write — anything omitted is already the component's default, and repeating it
// in the call would be noise a merchant then has to maintain.
import type { PreviewComponent } from "./component.js";
import type { PreviewStory } from "./stories.js";

/**
 * A Liquid literal. Deliberately narrow: storefront objects cannot be written
 * as literals at all, so a product is named rather than inlined — `product:
 * product` is what the call really looks like, with the object coming from the
 * page's own scope.
 */
function liquidValue(name: string, value: unknown): string | undefined {
	// An explicit unset is the story saying "without this one", and the way to
	// write that in a call is to leave the argument out.
	if (value === null || value === undefined) return undefined;
	if (typeof value === "boolean" || typeof value === "number") {
		return String(value);
	}
	if (typeof value === "string") return `'${value.replace(/'/g, "\\'")}'`;
	// An object or an array: a fixture, or storefront data. Name it.
	return name;
}

/** `{% render 'price', price: 2400 %}` — how a snippet is reached. */
function snippetCall(component: PreviewComponent, story: PreviewStory): string {
	const args = Object.entries(story.props)
		.map(([name, value]) => {
			const printed = liquidValue(name, value);
			return printed === undefined ? undefined : `${name}: ${printed}`;
		})
		.filter((arg): arg is string => arg !== undefined);
	const call = `{% render '${component.name}'`;
	if (args.length === 0) return `${call} %}`;
	// One line while it fits, then one argument per line — a render tag with six
	// arguments on one line is a horizontal scrollbar in every panel it appears.
	const inline = `${call}, ${args.join(", ")} %}`;
	if (inline.length <= 72) return inline;
	return `${call},\n  ${args.join(",\n  ")}\n%}`;
}

/**
 * A section or a block is placed, not called: it appears in a template's JSON
 * with its settings, which is the file a merchant or a theme actually edits.
 */
function settingsJson(
	component: PreviewComponent,
	story: PreviewStory,
): string {
	const settings: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(story.props)) {
		if (value === null || value === undefined) continue;
		// A storefront object is not something a settings file can hold; a merchant
		// picks one in the editor, so the placeholder says which setting it is.
		settings[name] = typeof value === "object" ? `<${name}>` : value;
	}
	return JSON.stringify({ type: component.name, settings }, null, 2);
}

export type RenderCall = {
	/** What to show above the snippet: how this kind of component is reached. */
	label: string;
	language: "liquid" | "json";
	code: string;
};

/**
 * How to reproduce this story in a theme.
 *
 * Returns undefined when the component's kind is unknown — a file the preview
 * could not classify is one whose call it would be guessing at, and a wrong
 * snippet in a copy button is worse than no snippet.
 */
export function renderCall(
	component: PreviewComponent,
	story: PreviewStory,
): RenderCall | undefined {
	switch (component.componentKind) {
		case "snippet":
			return {
				label: "Render this story",
				language: "liquid",
				code: snippetCall(component, story),
			};
		case "section":
			return {
				label: "In a template's JSON",
				language: "json",
				code: settingsJson(component, story),
			};
		case "block":
			return {
				label: "As a block in a section",
				language: "json",
				code: settingsJson(component, story),
			};
		default:
			return undefined;
	}
}
