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
	/**
	 * Show only these stories, dropping the ones derived from the contract. Off
	 * by default: an authored case is one a type could not express, so it adds to
	 * the derived set rather than standing in for it. A component whose derived
	 * stories are genuinely not worth showing sets this.
	 */
	replace?: boolean;
};

export type NazareManifest = {
	id: string;
	version: string;
	kind?: "snippet" | "section" | "block" | "function";
	entry: string;
	dependencies?: Record<string, string>;
	files: string[];
	/**
	 * SPDX identifier for the component's own terms. Required to publish: a
	 * component is source the installer owns and redistributes, so shipping one
	 * without stated terms leaves them holding code they cannot legally use.
	 */
	license: string;
	/**
	 * Where the component came from, when it is derived from or modelled on
	 * someone else's work — "Settings vocabulary follows Shopify Dawn (Shopify
	 * Inc.)". Free text, carried so attribution travels with the component
	 * instead of living only in a commit message.
	 */
	source?: string;
	/** Authored preview cases; travels with the component, versioned with it. */
	preview?: NazareManifestPreview;
};
