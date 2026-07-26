// Single-pass Liquid scanner.
//
// Emits a token stream rather than facts: dependencies, settings reads, locale
// references and the Nazare tag layer are all different readings of the same
// tags, and they should not each pay for their own pass. Consumers walk the
// tokens and build whatever they need.
//
// This is not an HTML parser. Everything outside `{{ }}` and `{% %}` is text
// the scanner steps over, which is exactly what theme analysis needs — the
// build path keeps a real HTML parser for the checks that require one.
import {
	BLOCK_TAGS,
	DOC_TAG,
	LIQUID_TAG,
	RAW_TAGS,
	TAGS_WITHOUT_MARKUP,
} from "./liquid-spec.js";
import type { Range } from "./source.js";

export type LiquidToken =
	| {
			kind: "tag";
			/** Tag name, lowercased. `undefined` when the tag opens with no name. */
			name?: string;
			/** Everything after the name, whitespace control stripped. */
			markup: string;
			/** Offset of `markup` within the source, for locating what it contains. */
			markupStart: number;
			/** The whole `{% … %}`, or the statement's own extent inside `{% liquid %}`. */
			range: Range;
			/** True when the tag came from a `{% liquid %}` statement line. */
			inline: boolean;
	  }
	| {
			kind: "output";
			markup: string;
			markupStart: number;
			range: Range;
			inline: false;
	  }
	| {
			kind: "raw";
			/** The tag that opened this body: `schema`, `comment`, `doc`, … */
			name: string;
			/** Body text between the open and close tags, unparsed. */
			body: string;
			/** Offset of `body` within the source. */
			bodyStart: number;
			/** The whole `{% raw %}…{% endraw %}`. */
			range: Range;
	  };

export type LiquidScanIssue = {
	code: "UNTERMINATED_TAG" | "UNCLOSED_RAW_TAG" | "UNCLOSED_BLOCK";
	name?: string;
	range: Range;
};

export type LiquidScan = {
	tokens: LiquidToken[];
	issues: LiquidScanIssue[];
};

const TAG_NAME = /^\s*([a-zA-Z_][\w-]*)/;

/** Strips whitespace control and returns the markup with its true offset. */
function markupOf(
	source: string,
	open: number,
	close: number,
): { markup: string; markupStart: number } {
	let start = open + 2;
	let end = close;
	if (source.charCodeAt(start) === 45 /* - */) start += 1;
	if (source.charCodeAt(end - 1) === 45 /* - */) end -= 1;
	return { markup: source.slice(start, end), markupStart: start };
}

/**
 * Finds the closing delimiter. Deliberately naive: the first `%}` wins.
 *
 * Quote-aware scanning was tried and is wrong for this input. `{% liquid %}`
 * bodies carry `comment` statements holding prose, and a single apostrophe put
 * the scan into a string it never left — swallowing the rest of the file. A
 * `%}` inside a string literal is vanishingly rare; prose apostrophes are not.
 */
function closerAt(source: string, from: number, closer: string): number {
	return source.indexOf(closer, from);
}

export function scanLiquid(source: string): LiquidScan {
	const tokens: LiquidToken[] = [];
	const issues: LiquidScanIssue[] = [];
	const length = source.length;
	let index = 0;

	while (index < length) {
		const brace = source.indexOf("{", index);
		if (brace === -1 || brace + 1 >= length) break;
		const next = source.charCodeAt(brace + 1);
		const isTag = next === 37; /* % */
		const isOutput = next === 123; /* { */
		if (!isTag && !isOutput) {
			index = brace + 1;
			continue;
		}

		const closer = isTag ? "%}" : "}}";
		const close = closerAt(source, brace + 2, closer);
		if (close === -1) {
			// Unterminated at EOF. Step over the brace rather than abandoning the
			// file: dropping every later fact silently is worse than misreading one
			// tag, and the issue says which it was.
			issues.push({
				code: "UNTERMINATED_TAG",
				range: { start: brace, end: length },
			});
			index = brace + 1;
			continue;
		}
		const end = close + closer.length;
		const { markup, markupStart } = markupOf(source, brace, close);

		if (isOutput) {
			tokens.push({
				kind: "output",
				markup,
				markupStart,
				range: { start: brace, end },
				inline: false,
			});
			index = end;
			continue;
		}

		const name = TAG_NAME.exec(markup)?.[1]?.toLowerCase();

		// A raw body is not Liquid. Hand it out whole and resume after its close.
		if (name && (RAW_TAGS.has(name) || name === DOC_TAG)) {
			const closeTag = `end${name}`;
			const bodyStart = end;
			const closeIndex = findClosingTag(source, closeTag, bodyStart);
			if (closeIndex === -1) {
				issues.push({
					code: "UNCLOSED_RAW_TAG",
					name,
					range: { start: brace, end: length },
				});
				tokens.push({
					kind: "raw",
					name,
					body: source.slice(bodyStart),
					bodyStart,
					range: { start: brace, end: length },
				});
				break;
			}
			tokens.push({
				kind: "raw",
				name,
				body: source.slice(bodyStart, closeIndex.open),
				bodyStart,
				range: { start: brace, end: closeIndex.end },
			});
			index = closeIndex.end;
			continue;
		}

		if (name === LIQUID_TAG) {
			pushInlineStatements(tokens, markup, markupStart);
			index = end;
			continue;
		}

		tokens.push({
			kind: "tag",
			name,
			markup: name ? markup.slice(markup.indexOf(name) + name.length) : markup,
			markupStart: name
				? markupStart + markup.indexOf(name) + name.length
				: markupStart,
			range: { start: brace, end },
			inline: false,
		});
		index = end;
	}

	const openBlocks: { name: string; start: number }[] = [];
	for (const token of tokens) {
		if (token.kind !== "tag" || !token.name) continue;
		if (BLOCK_TAGS.has(token.name)) {
			openBlocks.push({ name: token.name, start: token.range.start });
			continue;
		}
		if (!token.name.startsWith("end")) continue;
		const closing = token.name.slice(3);
		for (let depth = openBlocks.length - 1; depth >= 0; depth -= 1) {
			if (openBlocks[depth]?.name !== closing) continue;
			openBlocks.length = depth;
			break;
		}
	}
	for (const block of openBlocks) {
		issues.push({
			code: "UNCLOSED_BLOCK",
			name: block.name,
			range: { start: block.start, end: length },
		});
	}

	return { tokens, issues };
}

/** Locates `{% end<name> %}`, returning the offsets of the tag itself. */
function findClosingTag(
	source: string,
	closeTag: string,
	from: number,
): { open: number; end: number } | -1 {
	let cursor = from;
	while (cursor < source.length) {
		const open = source.indexOf("{%", cursor);
		if (open === -1) return -1;
		const close = source.indexOf("%}", open + 2);
		if (close === -1) return -1;
		const markup = source.slice(open + 2, close).replace(/^-|-$/g, "");
		if (TAG_NAME.exec(markup)?.[1]?.toLowerCase() === closeTag) {
			return { open, end: close + 2 };
		}
		cursor = close + 2;
	}
	return -1;
}

/**
 * `{% liquid %}` statements. Each line is a tag, so a `render` inside one is
 * indistinguishable downstream from a standalone `{% render %}` — which is
 * what the reference parser reports, and what dependency extraction expects.
 *
 * A `comment` statement's body is prose rather than statements, so it is
 * skipped to its `endcomment`.
 */
function pushInlineStatements(
	tokens: LiquidToken[],
	markup: string,
	markupStart: number,
): void {
	const bodyStart = markup.indexOf(LIQUID_TAG) + LIQUID_TAG.length;
	let cursor = bodyStart;
	let skipUntil: string | undefined;
	for (const line of markup.slice(bodyStart).split("\n")) {
		const lineStart = cursor;
		cursor += line.length + 1;
		const trimmed = line.trim();
		if (!trimmed) continue;
		const name = TAG_NAME.exec(trimmed)?.[1]?.toLowerCase();
		if (skipUntil) {
			if (name === skipUntil) skipUntil = undefined;
			continue;
		}
		if (!name) continue;
		if (RAW_TAGS.has(name) || name === DOC_TAG) {
			skipUntil = `end${name}`;
			continue;
		}
		const start = markupStart + lineStart + line.indexOf(trimmed);
		const nameEnd = trimmed.indexOf(name) + name.length;
		tokens.push({
			kind: "tag",
			name,
			markup: TAGS_WITHOUT_MARKUP.has(name) ? "" : trimmed.slice(nameEnd),
			markupStart: start + nameEnd,
			range: { start, end: start + trimmed.length },
			inline: true,
		});
	}
}
