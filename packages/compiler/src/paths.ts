// Import-path resolution. Every file the compiler sees is identified by its
// project-relative POSIX path; import specifiers are relative to the
// importing file and must stay inside the project root. Pure path math —
// no filesystem here; whether a resolved path exists is readFile's answer.

/** Directory of a project-relative path ("" for a root-level file). */
export function directoryOf(path: string): string {
	return path.split("/").slice(0, -1).join("/");
}

/**
 * Resolves a "./" or "../" specifier against the importing file's directory.
 * Returns the normalized project-relative path, or undefined when the
 * specifier escapes the project root.
 */
export function resolveImportPath(
	fromFile: string,
	specifier: string,
): string | undefined {
	const segments = directoryOf(fromFile).split("/").filter(Boolean);
	for (const segment of specifier.split("/")) {
		if (segment === "." || segment === "") continue;
		if (segment === "..") {
			if (segments.length === 0) return undefined;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join("/");
}

/** True for the only legal specifier shape: an explicitly relative path. */
export function isRelativeSpecifier(specifier: string): boolean {
	return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * "components/link/link.nz.liquid" -> "link": the emitted theme-file name of a
 * component. Only the known compiler extensions are stripped, so a dot in the
 * name itself ("promo.v2.nz.liquid" -> "promo.v2") survives.
 */
export function baseNameOf(path: string): string {
	const name = path.split("/").at(-1) ?? path;
	return name.replace(/(\.nz)?\.liquid$|\.(ts|js|css|json)$/, "");
}
