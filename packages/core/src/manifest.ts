// nazare.json — the package manifest as authored, before any compilation.
// Identifies the package, its entry file, and its dependencies; compiling
// the entry produces the ArtifactContract.
/**
 * A preview case the component author wrote, for cases a type cannot express:
 * storefront data, a deliberately empty value, a combination worth showing.
 * Optional — a component with no stories is still previewable, since the
 * baseline set is derived from its contract.
 */
export type NazareManifestStory = {
	name: string;
	/**
	 * Prop values. A value of `{ "$fixture": "product" }` names shared
	 * storefront stand-in data the preview owns, which JSON could not express.
	 */
	props: Record<string, unknown>;
	/** Why this case is worth looking at. */
	note?: string;
};

export type NazareManifestPreview = {
	stories?: NazareManifestStory[];
};

export type NazareManifest = {
	id: string;
	version: string;
	kind?: "snippet" | "section" | "block" | "function";
	entry: string;
	dependencies?: Record<string, string>;
	files: string[];
	/** Authored preview cases; travels with the component, versioned with it. */
	preview?: NazareManifestPreview;
};
