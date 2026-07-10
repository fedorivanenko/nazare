export type NazareManifest = {
	id: string;
	version: string;
	kind?: "snippet" | "section" | "function";
	entry: string;
	dependencies?: Record<string, string>;
	files: string[];
};
