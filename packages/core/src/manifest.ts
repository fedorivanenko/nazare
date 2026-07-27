// nazare.json — the package manifest as authored, before any compilation.
// Identifies the package, its entry file, and its dependencies; compiling
// the entry produces the ArtifactContract.
/**
 * A preview case the component author wrote: a name, and the values that make
 * the case. The interface it draws on — prop names, types, defaults — is
 * declared in the component's own source, never here, so a story states only
 * what it changes and the declaration supplies the rest.
 */
export type NazareManifestStory = {
	name: string;
	/**
	 * The values this case changes, not the whole prop set. Omitted props fall
	 * through to the defaults the component declares; `null` is an explicit
	 * unset. A value of `{ "$fixture": "product" }` names shared storefront
	 * stand-in data the preview owns, which JSON could not express.
	 */
	props?: Record<string, unknown>;
	/** Why this case is worth looking at. */
	note?: string;
};

/**
 * Authored preview cases. A component with none does not appear in the
 * workbench: writing a story is what publishes it there, rather than every
 * compilable file showing up whether or not anyone meant it to.
 */
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
