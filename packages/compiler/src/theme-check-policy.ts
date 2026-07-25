// Reads the theme's .theme-check.yml so the graph can report which Shopify
// Theme Check checks the theme suppresses. This is reported, never applied:
// Nazare's diagnostics carry their own codes and are not Theme Check findings,
// so there is nothing here for an `ignore:` entry to suppress. Running Theme
// Check remains Theme Check's job.
import type { Diagnostic } from "@nazare/core";

export type ThemeCheckPolicyInput = {
	path?: string;
	contents: string;
};

export type ThemeCheckPolicy = {
	path: string;
	ignoredChecks: string[];
	issues: Diagnostic[];
};

export function parseThemeCheckPolicy(
	input: ThemeCheckPolicyInput | undefined,
): ThemeCheckPolicy {
	const path = input?.path ?? ".theme-check.yml";
	if (!input) return { path, ignoredChecks: [], issues: [] };
	const ignoredChecks: string[] = [];
	let inIgnoreList = false;
	for (const [index, rawLine] of input.contents.split(/\r?\n/).entries()) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) continue;
		if (/^ignore\s*:\s*$/.test(line)) {
			inIgnoreList = true;
			continue;
		}
		if (inIgnoreList) {
			const item = line.match(/^[-]\s*(?:['"]([^'"]+)['"]|([^\s]+))\s*$/);
			if (item) {
				ignoredChecks.push(item[1] ?? item[2] ?? "");
				continue;
			}
			if (!line.startsWith("-")) inIgnoreList = false;
		}
		if (/^ignore\s*:\s*\[.*\]\s*$/.test(line)) {
			const value = line.slice(line.indexOf("[") + 1, line.lastIndexOf("]"));
			ignoredChecks.push(
				...value
					.split(",")
					.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
					.filter(Boolean),
			);
			continue;
		}
		if (/^ignore\s*:/.test(line)) {
			return {
				path,
				ignoredChecks: [],
				issues: [
					{
						severity: "warning",
						code: "THEME_CHECK_CONFIG_INVALID",
						message: `Invalid ${path} ignore value near line ${index + 1}`,
						phase: "parse",
					},
				],
			};
		}
		if (/^[A-Za-z][\w-]*\s*:/.test(line)) {
			return {
				path,
				ignoredChecks: [],
				issues: [
					{
						severity: "warning",
						code: "THEME_CHECK_CONFIG_UNSUPPORTED",
						message: `Unsupported ${path} key near line ${index + 1}; only "ignore" is consumed`,
						phase: "parse",
					},
				],
			};
		}
		return {
			path,
			ignoredChecks: [],
			issues: [
				{
					severity: "warning",
					code: "THEME_CHECK_CONFIG_INVALID",
					message: `Unsupported ${path} syntax near line ${index + 1}`,
					phase: "parse",
				},
			],
		};
	}
	return {
		path,
		ignoredChecks: [...new Set(ignoredChecks)].sort(),
		issues: [],
	};
}
