// Readings of the Liquid token stream.
//
// Each reader is a plain function over tokens, so a caller that needs only
// dependencies does not pay for settings reads, and adding a new fact family
// costs a function rather than a pass.
import type { LiquidToken } from "./liquid.js";
import type { Range } from "./source.js";

export type LiquidDependencyKind =
	| "snippet"
	| "section"
	| "section-group"
	| "layout";

export type LiquidDependency = {
	kind: LiquidDependencyKind;
	/** `render` and `include` differ in scope isolation; the caller needs to know which. */
	invocationKind?: "render" | "include";
	/** Present when the target is a literal. Absent means a dynamic expression. */
	name?: string;
	range: Range;
};

export type LiquidSettingsRead = {
	object: "settings" | "section" | "block";
	name: string;
	range: Range;
};

const QUOTED = /^\s*(?:'([^']*)'|"([^"]*)")/;
const NONE = /^\s*none\s*$/;

const DEPENDENCY_TAGS = new Map<string, LiquidDependencyKind>([
	["render", "snippet"],
	["include", "snippet"],
	["section", "section"],
	["sections", "section-group"],
	["layout", "layout"],
]);

export function liquidDependencies(tokens: LiquidToken[]): LiquidDependency[] {
	const dependencies: LiquidDependency[] = [];
	for (const token of tokens) {
		if (token.kind !== "tag" || !token.name) continue;
		const kind = DEPENDENCY_TAGS.get(token.name);
		if (!kind) continue;
		const quoted = QUOTED.exec(token.markup);
		const name = quoted?.[1] ?? quoted?.[2];
		if (kind === "layout") {
			// `{% layout none %}` states that no layout applies. It is a static
			// answer, not a missing one, so it is reported rather than dropped.
			const isNone = NONE.test(token.markup);
			dependencies.push({
				kind,
				name: name ?? (isNone ? "none" : undefined),
				range: token.range,
			});
			continue;
		}
		dependencies.push({
			kind,
			invocationKind:
				token.name === "render" || token.name === "include"
					? token.name
					: undefined,
			name,
			range: token.range,
		});
	}
	return dependencies;
}

// A settings read is `settings.x`, `section.settings.x` or `block.settings.x`.
// The leading boundary keeps `foo.settings.x` from matching: only the three
// documented roots carry theme settings.
const SETTINGS =
	/(?:^|[^\w.])(section\.settings|block\.settings|settings)\.([a-zA-Z_][\w-]*)/g;

export function liquidSettingsReads(
	tokens: LiquidToken[],
): LiquidSettingsRead[] {
	const reads: LiquidSettingsRead[] = [];
	for (const token of tokens) {
		if (token.kind === "raw") continue;
		SETTINGS.lastIndex = 0;
		let match = SETTINGS.exec(token.markup);
		while (match) {
			const root = match[1] as string;
			const at = token.markupStart + match.index + match[0].indexOf(root);
			reads.push({
				object:
					root === "settings"
						? "settings"
						: root === "section.settings"
							? "section"
							: "block",
				name: match[2] as string,
				range: {
					start: at,
					end: at + root.length + 1 + (match[2] as string).length,
				},
			});
			match = SETTINGS.exec(token.markup);
		}
	}
	return reads;
}

/** The authored `{% schema %}` body, when the file has one. */
export function liquidSchema(
	tokens: LiquidToken[],
): { body: string; bodyStart: number; range: Range } | undefined {
	for (const token of tokens) {
		if (token.kind === "raw" && token.name === "schema") {
			return {
				body: token.body,
				bodyStart: token.bodyStart,
				range: token.range,
			};
		}
	}
	return undefined;
}
