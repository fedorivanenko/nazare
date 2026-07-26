// Readings of the Liquid token stream.
//
// Each reader is a plain function over tokens, so a caller that needs only
// dependencies does not pay for settings reads, and adding a new fact family
// costs a function rather than a pass.

import type { LiquidDocument } from "./liquid.js";
import { scanLiquidExpression } from "./liquid-expression.js";
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

export function liquidDependencies(
	document: LiquidDocument,
): LiquidDependency[] {
	const dependencies: LiquidDependency[] = [];
	for (const token of document.tokens) {
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

export function liquidSettingsReads(
	document: LiquidDocument,
): LiquidSettingsRead[] {
	const reads: LiquidSettingsRead[] = [];
	for (const token of document.tokens) {
		if (token.kind === "raw") continue;
		const expression = scanLiquidExpression(token.markup, token.markupStart);
		for (const lookup of expression.lookups) {
			let object: LiquidSettingsRead["object"] | undefined;
			let name: string | undefined;
			if (lookup.root === "settings") {
				object = "settings";
				name = lookup.path[0];
			} else if (
				(lookup.root === "section" || lookup.root === "block") &&
				lookup.path[0] === "settings"
			) {
				object = lookup.root;
				name = lookup.path[1];
			}
			if (!object || !name) continue;
			reads.push({ object, name, range: lookup.range });
		}
	}
	return reads;
}

/** The authored `{% schema %}` body, when the file has one. */
export function liquidSchema(
	document: LiquidDocument,
): { body: string; bodyStart: number; range: Range } | undefined {
	for (const token of document.tokens) {
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
