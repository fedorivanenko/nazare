// nazare.json — the package manifest as authored, before any compilation.
// Identifies the package, its entry file, and its dependencies; compiling
// the entry produces the ArtifactContract.
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
};
