// Locates Nazare reference tokens — props.x and <styleBinding>.class — inside
// Liquid expression regions. The scanner only ever sees the inner text of a
// {{ output }} or {% tag %} (the parser hands it those, extracted from the
// LiquidHTML AST), so literal HTML text can never match: a reference is a
// located fact with a source span, not a regex over emitted output. Emit then
// projects each located reference back by span — that is what keeps lowering
// free of textual magic.
import type { SourceSpan } from "@nazare/core";

/**
 * How the reference is written at its span when lowered.
 * - identifier: a prop read, replaced in place (`props.x` → `section.settings.x`).
 * - bare-class: a style read that is the whole `{{ }}` output; the tag is
 *   replaced by the literal class name (drops the braces).
 * - quoted-class: a style read in expression position (a render argument),
 *   replaced by a quoted class-name string.
 */
export type ReferenceForm = "identifier" | "bare-class" | "quoted-class";

export type RawReference = {
	target: "prop" | "style";
	/** The head token: "props" or the style binding name. */
	binding: string;
	/** The member: prop name or css class name. */
	name: string;
	form: ReferenceForm;
	/** Absolute source offsets of the span to replace. */
	start: number;
	end: number;
};

export type LiquidRegion =
	| {
			kind: "output";
			/** Inner expression text (between {{ and }}). */
			inner: string;
			/** Absolute offset of `inner` in the source. */
			innerOffset: number;
			/** Absolute offsets of the whole {{ }} tag. */
			outputStart: number;
			outputEnd: number;
	  }
	| {
			kind: "markup";
			/** Tag markup text (between {% name and %}). */
			inner: string;
			innerOffset: number;
	  };

const propToken = /\bprops\.([A-Za-z_$][\w$]*)/g;

/** Every reference token inside a single Liquid region. */
export function scanRegionReferences(
	region: LiquidRegion,
	styleBindings: ReadonlySet<string>,
): RawReference[] {
	const patternsByBinding = new Map(
		[...styleBindings].map((binding) => [
			binding,
			styleBindingPatterns(binding),
		]),
	);
	// A {{ }} whose entire expression is one style read prints the class name,
	// so the whole tag becomes the bare literal.
	if (region.kind === "output") {
		const whole = wholeStyleOutput(region.inner.trim(), patternsByBinding);
		if (whole) {
			return [
				{
					target: "style",
					binding: whole.binding,
					name: whole.name,
					form: "bare-class",
					start: region.outputStart,
					end: region.outputEnd,
				},
			];
		}
	}

	const references: RawReference[] = [];
	for (const match of region.inner.matchAll(propToken)) {
		references.push({
			target: "prop",
			binding: "props",
			name: match[1],
			form: "identifier",
			start: region.innerOffset + match.index,
			end: region.innerOffset + match.index + match[0].length,
		});
	}
	for (const [binding, patterns] of patternsByBinding) {
		for (const match of matchStyleTokens(region.inner, patterns)) {
			references.push({
				target: "style",
				binding,
				name: match.name,
				form: "quoted-class",
				start: region.innerOffset + match.start,
				end: region.innerOffset + match.end,
			});
		}
	}
	return references.sort((a, b) => a.start - b.start);
}

/** Returns the class read when `expression` is exactly `binding.x`/`binding["x"]`. */
function wholeStyleOutput(
	expression: string,
	patternsByBinding: Map<string, StyleBindingPatterns>,
): { binding: string; name: string } | undefined {
	for (const [binding, patterns] of patternsByBinding) {
		const dot = expression.match(patterns.wholeDot);
		if (dot) return { binding, name: dot[1] };
		const bracket = expression.match(patterns.wholeBracket);
		if (bracket) return { binding, name: bracket[1] };
	}
	return undefined;
}

type StyleTokenMatch = { name: string; start: number; end: number };

type StyleBindingPatterns = {
	wholeDot: RegExp;
	wholeBracket: RegExp;
	tokenDot: RegExp;
	tokenBracket: RegExp;
};

function styleBindingPatterns(binding: string): StyleBindingPatterns {
	const escaped = escapeRegExp(binding);
	return {
		wholeDot: new RegExp(`^${escaped}\\.([A-Za-z_$][\\w$]*)$`),
		wholeBracket: new RegExp(`^${escaped}\\[\\s*["']([^"']+)["']\\s*\\]$`),
		tokenDot: new RegExp(`\\b${escaped}\\.([A-Za-z_$][\\w$]*)`, "g"),
		tokenBracket: new RegExp(
			`\\b${escaped}\\[\\s*["']([^"']+)["']\\s*\\]`,
			"g",
		),
	};
}

/** Style reads in expression position: `binding.x` and `binding["kebab-x"]`. */
function matchStyleTokens(
	text: string,
	patterns: StyleBindingPatterns,
): StyleTokenMatch[] {
	const matches: StyleTokenMatch[] = [];
	for (const match of text.matchAll(patterns.tokenDot)) {
		matches.push({
			name: match[1],
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	for (const match of text.matchAll(patterns.tokenBracket)) {
		matches.push({
			name: match[1],
			start: match.index,
			end: match.index + match[0].length,
		});
	}
	return matches;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The span to replace, in file coordinates, for a located reference. */
export function referenceSpan(
	reference: RawReference,
	toSpan: (offsets: { start: number; end: number }) => SourceSpan,
): SourceSpan {
	return toSpan({ start: reference.start, end: reference.end });
}
