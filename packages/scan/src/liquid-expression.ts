// Liquid expression scanning.
//
// The tag layer answers "which tags are here". This answers "what does their
// markup touch": variable lookups and their property paths, the filters applied
// to them, string literals, and `name: value` arguments.
//
// It is a tokenizer, not an evaluator. Precedence and truthiness are the
// runtime's business; fact extraction needs to know which names were mentioned,
// in what shape, and where.
import type { Range } from "./source.js";

export type LiquidLookup = {
	/** The root identifier: `product` in `product.featured_image.src`. */
	root: string;
	/** Property path after the root. Bracket access with a literal is flattened. */
	path: string[];
	range: Range;
};

export type LiquidFilterUse = {
	name: string;
	/** Raw argument text after the colon, empty when the filter takes none. */
	args: string;
	range: Range;
};

export type LiquidStringLiteral = { value: string; range: Range };

export type LiquidNamedArgument = {
	name: string;
	/** Raw value text, so a caller can re-scan it for lookups if it needs to. */
	value: string;
	valueRange: Range;
	range: Range;
};

export type LiquidExpression = {
	lookups: LiquidLookup[];
	filters: LiquidFilterUse[];
	strings: LiquidStringLiteral[];
	namedArguments: LiquidNamedArgument[];
};

/**
 * Words that are syntax rather than variables. A lookup named `and` would be a
 * misread of a boolean operator, and `blank`/`empty` are literals.
 */
const KEYWORDS: ReadonlySet<string> = new Set([
	"and",
	"or",
	"not",
	"contains",
	"in",
	"with",
	"as",
	"by",
	"true",
	"false",
	"nil",
	"null",
	"empty",
	"blank",
]);

const IDENTIFIER_START = /[a-zA-Z_]/;
const IDENTIFIER_PART = /[\w-]/;

function isSpace(character: string): boolean {
	return (
		character === " " ||
		character === "\t" ||
		character === "\n" ||
		character === "\r"
	);
}

/**
 * Scans one tag or output's markup.
 *
 * `offset` is where `markup` sits in the file, so every range this returns is
 * a file offset and needs no further translation.
 */
export function scanLiquidExpression(
	markup: string,
	offset = 0,
): LiquidExpression {
	const lookups: LiquidLookup[] = [];
	const filters: LiquidFilterUse[] = [];
	const strings: LiquidStringLiteral[] = [];
	const namedArguments: LiquidNamedArgument[] = [];
	const length = markup.length;
	let index = 0;
	// After a `|`, `name: value` pairs belong to the filter, not to the tag.
	let inFilter = false;

	const readString = (): LiquidStringLiteral | undefined => {
		const quote = markup[index];
		if (quote !== "'" && quote !== '"') return undefined;
		const start = index;
		index += 1;
		while (index < length && markup[index] !== quote) index += 1;
		const value = markup.slice(start + 1, index);
		index += 1; // closing quote, or end of markup when unterminated
		return {
			value,
			range: { start: offset + start, end: offset + index },
		};
	};

	while (index < length) {
		const character = markup[index] as string;

		if (
			isSpace(character) ||
			character === "," ||
			character === "(" ||
			character === ")"
		) {
			index += 1;
			continue;
		}

		if (character === "'" || character === '"') {
			const literal = readString();
			if (literal) strings.push(literal);
			continue;
		}

		if (character === "|") {
			index += 1;
			inFilter = true;
			while (index < length && isSpace(markup[index] as string)) index += 1;
			const nameStart = index;
			while (index < length && IDENTIFIER_PART.test(markup[index] as string)) {
				index += 1;
			}
			const name = markup.slice(nameStart, index);
			if (!name) continue;
			// Arguments run to the next `|` that is not inside a string.
			let cursor = index;
			let quote: string | undefined;
			while (cursor < length) {
				const at = markup[cursor] as string;
				if (quote) {
					if (at === quote) quote = undefined;
				} else if (at === "'" || at === '"') {
					quote = at;
				} else if (at === "|") {
					break;
				}
				cursor += 1;
			}
			const args = markup
				.slice(index, cursor)
				.replace(/^\s*:\s*/, "")
				.trim();
			filters.push({
				name,
				args,
				range: { start: offset + nameStart, end: offset + cursor },
			});
			// Re-scan the argument text for lookups and strings by continuing the
			// main loop through it; only the `name:` handling differs.
			continue;
		}

		if (IDENTIFIER_START.test(character)) {
			const start = index;
			while (index < length && IDENTIFIER_PART.test(markup[index] as string)) {
				index += 1;
			}
			const word = markup.slice(start, index);

			// `name:` is an argument label, not a variable.
			let ahead = index;
			while (ahead < length && isSpace(markup[ahead] as string)) ahead += 1;
			if (markup[ahead] === ":" && markup[ahead + 1] !== ":") {
				const valueStart = ahead + 1;
				let cursor = valueStart;
				let quote: string | undefined;
				// A value ends at the next top-level comma or pipe.
				while (cursor < length) {
					const at = markup[cursor] as string;
					if (quote) {
						if (at === quote) quote = undefined;
					} else if (at === "'" || at === '"') {
						quote = at;
					} else if (at === "," || at === "|") {
						break;
					}
					cursor += 1;
				}
				const value = markup.slice(valueStart, cursor);
				if (!inFilter && !KEYWORDS.has(word)) {
					namedArguments.push({
						name: word,
						value: value.trim(),
						valueRange: {
							start:
								offset + valueStart + (value.length - value.trimStart().length),
							end: offset + cursor,
						},
						range: { start: offset + start, end: offset + cursor },
					});
				}
				// Continue scanning the value itself, so lookups inside it are found.
				index = valueStart;
				continue;
			}

			if (KEYWORDS.has(word)) continue;

			// Property path: `.name` and `["name"]` both extend the lookup.
			// A computed index (`images[i]`) ends the *static* path, but what
			// follows is still property access — `images[i].src` mentions no
			// variable named `src`, and reporting one would invent a free variable.
			const path: string[] = [];
			// Lookups found inside a computed index are buffered so the outer
			// lookup is still reported first: callers rely on source order.
			const nested: {
				lookups: LiquidLookup[];
				strings: LiquidStringLiteral[];
			} = {
				lookups: [],
				strings: [],
			};
			let truncated = false;
			while (index < length) {
				if (markup[index] === ".") {
					const partStart = index + 1;
					let cursor = partStart;
					while (
						cursor < length &&
						IDENTIFIER_PART.test(markup[cursor] as string)
					) {
						cursor += 1;
					}
					if (cursor === partStart) break;
					if (!truncated) path.push(markup.slice(partStart, cursor));
					index = cursor;
					continue;
				}
				if (markup[index] === "[") {
					index += 1;
					const literal = readString();
					while (index < length && isSpace(markup[index] as string)) index += 1;
					if (literal && markup[index] === "]") {
						if (!truncated) path.push(literal.value);
						index += 1;
						continue;
					}
					// Computed: the index is itself an expression worth reading, so
					// scan it, then keep consuming the chain without extending the path.
					const inner = markup.indexOf("]", index);
					const innerEnd = inner === -1 ? length : inner;
					const inside = scanLiquidExpression(
						markup.slice(index, innerEnd),
						offset + index,
					);
					nested.lookups.push(...inside.lookups);
					nested.strings.push(...inside.strings);
					index = innerEnd + 1;
					truncated = true;
					continue;
				}
				break;
			}
			lookups.push({
				root: word,
				path,
				range: { start: offset + start, end: offset + index },
			});
			lookups.push(...nested.lookups);
			strings.push(...nested.strings);
			continue;
		}

		index += 1;
	}

	return { lookups, filters, strings, namedArguments };
}

/** `a.b.c` for a lookup, the form fact records use as an expression key. */
export function lookupExpression(lookup: LiquidLookup): string {
	return lookup.path.length > 0
		? `${lookup.root}.${lookup.path.join(".")}`
		: lookup.root;
}
