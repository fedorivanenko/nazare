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

const THEME_CHECK_DIAGNOSTIC_MAP: ReadonlyMap<string, readonly string[]> =
	new Map();

export function filterThemeCheckIssues(
	issues: Diagnostic[],
	policy: ThemeCheckPolicy,
): Diagnostic[] {
	if (
		policy.ignoredChecks.length === 0 ||
		THEME_CHECK_DIAGNOSTIC_MAP.size === 0
	) {
		return issues;
	}
	const suppressedCodes = new Set(
		policy.ignoredChecks.flatMap(
			(check) => THEME_CHECK_DIAGNOSTIC_MAP.get(check) ?? [],
		),
	);
	return issues.filter((issue) => !suppressedCodes.has(issue.code));
}
