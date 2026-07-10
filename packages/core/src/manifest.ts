// nazare.json — the package manifest as authored, before any compilation.
// Identifies the package, its entry file, and its dependencies; compiling
// the entry produces the ArtifactContract.
export type NazareManifest = {
	id: string;
	version: string;
	kind?: "snippet" | "section" | "function";
	entry: string;
	dependencies?: Record<string, string>;
	files: string[];
};
