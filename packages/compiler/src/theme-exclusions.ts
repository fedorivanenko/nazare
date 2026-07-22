// User-declared inspect exclusions. Page builders and AI block generators
// publish generated `.liquid` files that are expensive to analyze and carry no
// authored meaning. Excluding them is a policy choice, so it is never inferred:
// the user declares patterns, and every excluded file is reported, because a
// graph that silently omits a render target would be lying about the theme.
import type { Diagnostic } from "@nazare/core";
import type { ThemeInputFile } from "./theme-facts.js";
import { normalizeThemePath } from "./theme-file-classifier.js";

export type ThemeExclusion = { path: string; pattern: string };

/**
 * Matches a theme-relative path against a glob supporting `*` (any run of
 * characters within one segment), `**` (any run of segments), and `?` (one
 * character within a segment). Everything else is literal.
 */
export function matchesThemeGlob(path: string, pattern: string): boolean {
	return globRegExp(pattern).test(normalizeThemePath(path));
}

const globRegExpCache = new Map<string, RegExp>();

function globRegExp(pattern: string): RegExp {
	const cached = globRegExpCache.get(pattern);
	if (cached) return cached;
	let source = "";
	const normalized = normalizeThemePath(pattern);
	for (let index = 0; index < normalized.length; index += 1) {
		const character = normalized[index];
		if (character === "*") {
			if (normalized[index + 1] === "*") {
				// `**/` may match zero segments, so the following slash is optional.
				index += 1;
				if (normalized[index + 1] === "/") {
					index += 1;
					source += "(?:.*/)?";
					continue;
				}
				source += ".*";
				continue;
			}
			source += "[^/]*";
			continue;
		}
		if (character === "?") {
			source += "[^/]";
			continue;
		}
		source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	const compiled = new RegExp(`^${source}$`);
	globRegExpCache.set(pattern, compiled);
	return compiled;
}

/**
 * Splits inputs into analyzed and excluded files. The first matching pattern
 * wins so the report can name the pattern that caused each exclusion.
 */
export function partitionExcludedThemeFiles(
	files: ThemeInputFile[],
	patterns: string[] | undefined,
): { analyzed: ThemeInputFile[]; excluded: ThemeExclusion[] } {
	if (!patterns || patterns.length === 0) {
		return { analyzed: files, excluded: [] };
	}
	const analyzed: ThemeInputFile[] = [];
	const excluded: ThemeExclusion[] = [];
	for (const file of files) {
		const pattern = patterns.find((candidate) =>
			matchesThemeGlob(file.path, candidate),
		);
		if (pattern) excluded.push({ path: file.path, pattern });
		else analyzed.push(file);
	}
	return { analyzed, excluded };
}

/**
 * One diagnostic per excluded file. Excluded files stay absent from the graph,
 * so dependents can reference them without a resolvable target; the report is
 * what keeps that state explicit rather than silent.
 */
export function themeExclusionIssues(
	exclusions: ThemeExclusion[],
): Diagnostic[] {
	const position = { line: 1, column: 1 };
	return exclusions.map((exclusion) => ({
		severity: "info" as const,
		code: "THEME_FILE_EXCLUDED",
		message: `Excluded from inspection by pattern "${exclusion.pattern}"; facts, dependencies, and render targets from this file are absent from the graph`,
		span: { file: exclusion.path, start: position, end: position },
	}));
}
