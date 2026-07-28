// Identity for a component and a story.
//
// A story needs a name that survives leaving the page: it addresses an iframe
// document, a deep link, and (later) a snapshot file. Deriving it from the
// component and story names keeps the id stable across builds — reordering the
// registry or adding a story must not renumber the others.
//
// A component's name is already unique per source folder, and a story's name is
// unique within its component, so the pair needs no counter.

/** Lowercase, hyphenated, safe in a DOM id, a URL, and a filename. */
export const slug = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

export const componentId = (componentName: string): string =>
	slug(componentName);

/**
 * `button--scheme-outline`. The double hyphen separates the two halves, so an
 * id splits back apart even when either name contained hyphens of its own.
 */
export const storyId = (componentName: string, storyName: string): string =>
	`${componentId(componentName)}--${slug(storyName)}`;

/** Where a story's isolated document lives, relative to the story base. */
export const storyFileName = (id: string): string => `${id}.html`;
