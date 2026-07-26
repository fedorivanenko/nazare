// Liquid tokenization and structural validation.
//
// Emits a token stream rather than facts: dependencies, settings reads, locale
// references and the Nazare tag layer are all different readings of the same
// tags, and they should not each pay for their own pass. Consumers walk the
// tokens and build whatever they need.
//
// This is not an HTML parser. Everything outside `{{ }}` and `{% %}` is text
// the scanner steps over, which is exactly what theme analysis needs — the
// build path keeps a real HTML parser for the checks that require one.
import { scanLiquidExpression } from "./liquid-expression.js";
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
			/** Authored tag name. `undefined` when the tag opens with no name. */
			authoredName?: string;
			/** Canonical lowercase tag name used for grammar matching. */
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
			/** Authored spelling of the opening tag name. */
			authoredName: string;
			/** Canonical lowercase tag name used for grammar matching. */
			name: string;
			/** Body text between the open and close tags, unparsed. */
			body: string;
			/** Offset of `body` within the source. */
			bodyStart: number;
			/** The whole `{% raw %}…{% endraw %}`. */
			range: Range;
	  };

export type LiquidScanIssue = {
	code:
		| "UNTERMINATED_TAG"
		| "UNCLOSED_RAW_TAG"
		| "UNCLOSED_BLOCK"
		| "MISMATCHED_BLOCK"
		| "UNTERMINATED_STRING"
		| "UNCLOSED_BRACKET";
	name?: string;
	range: Range;
};

const validLiquidDocument: unique symbol = Symbol("validLiquidDocument");

/** Token stream proven free of scanner and expression errors. */
export type LiquidDocument = {
	readonly tokens: readonly LiquidToken[];
	readonly [validLiquidDocument]: true;
};

export type LiquidValidScan = {
	status: "valid";
	document: LiquidDocument;
	issues: readonly [];
};

export type LiquidInvalidScan = {
	status: "invalid";
	partialTokens: readonly LiquidToken[];
	issues: readonly [LiquidScanIssue, ...LiquidScanIssue[]];
};

export type LiquidScan = LiquidValidScan | LiquidInvalidScan;

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

type CloserMode = "first-delimiter" | "outside-string";

function isEscaped(value: string, index: number): boolean {
	let backslashes = 0;
	for (
		let cursor = index - 1;
		cursor >= 0 && value[cursor] === "\\";
		cursor -= 1
	) {
		backslashes += 1;
	}
	return backslashes % 2 === 1;
}

function closerAt(
	source: string,
	from: number,
	closer: string,
	mode: CloserMode,
): number {
	if (mode === "first-delimiter") return source.indexOf(closer, from);
	let quote: string | undefined;
	for (let cursor = from; cursor < source.length; cursor += 1) {
		const character = source[cursor] as string;
		if (quote) {
			if (character === quote && !isEscaped(source, cursor)) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (source.startsWith(closer, cursor)) return cursor;
	}
	return -1;
}

/** Finds an opener before a closer, excluding same-line string contents. */
function nestedOpenerAt(
	source: string,
	from: number,
	close: number,
	opener: string,
): number {
	let quote: string | undefined;
	for (let cursor = from; cursor < close; cursor += 1) {
		const character = source[cursor] as string;
		if (quote) {
			if (character === quote && !isEscaped(source, cursor)) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (source.startsWith(opener, cursor)) return cursor;
	}
	return -1;
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
		const provisionalTagName = isTag
			? TAG_NAME.exec(source.slice(brace + 2))?.[1]?.toLowerCase()
			: undefined;
		const closerMode: CloserMode =
			provisionalTagName === LIQUID_TAG ? "first-delimiter" : "outside-string";
		let close = closerAt(source, brace + 2, closer, closerMode);
		if (close === -1 && closerMode === "outside-string") {
			close = source.indexOf(closer, brace + 2);
		}
		const nestedOpen =
			close === -1
				? source.indexOf(isTag ? "{%" : "{{", brace + 2)
				: closerMode === "first-delimiter"
					? -1
					: nestedOpenerAt(source, brace + 2, close, isTag ? "{%" : "{{");
		if (close === -1 || nestedOpen !== -1) {
			const issueEnd = nestedOpen === -1 ? length : nestedOpen;
			issues.push({
				code: "UNTERMINATED_TAG",
				range: { start: brace, end: issueEnd },
			});
			index = nestedOpen === -1 ? brace + 1 : nestedOpen;
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

		const authoredName = TAG_NAME.exec(markup)?.[1];
		const name = authoredName?.toLowerCase();
		const nameStart = authoredName ? markup.indexOf(authoredName) : -1;

		// A raw body is not Liquid. Hand it out whole and resume after its close.
		if (name && authoredName && (RAW_TAGS.has(name) || name === DOC_TAG)) {
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
					authoredName,
					name,
					body: source.slice(bodyStart),
					bodyStart,
					range: { start: brace, end: length },
				});
				break;
			}
			tokens.push({
				kind: "raw",
				authoredName,
				name,
				body: source.slice(bodyStart, closeIndex.open),
				bodyStart,
				range: { start: brace, end: closeIndex.end },
			});
			index = closeIndex.end;
			continue;
		}

		if (name === LIQUID_TAG) {
			pushInlineStatements(tokens, issues, markup, markupStart, end);
			index = end;
			continue;
		}

		tokens.push({
			kind: "tag",
			authoredName,
			name,
			markup: name ? markup.slice(nameStart + name.length) : markup,
			markupStart: name ? markupStart + nameStart + name.length : markupStart,
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
		const current = openBlocks.at(-1);
		if (!current || current.name !== closing) {
			issues.push({
				code: "MISMATCHED_BLOCK",
				name: closing,
				range: token.range,
			});
			continue;
		}
		openBlocks.pop();
	}
	for (const block of openBlocks) {
		issues.push({
			code: "UNCLOSED_BLOCK",
			name: block.name,
			range: { start: block.start, end: length },
		});
	}

	for (const token of tokens) {
		if (token.kind === "raw") continue;
		const expression = scanLiquidExpression(token.markup, token.markupStart);
		issues.push(...expression.issues);
	}

	if (issues.length > 0) {
		return {
			status: "invalid",
			partialTokens: tokens,
			issues: issues as [LiquidScanIssue, ...LiquidScanIssue[]],
		};
	}
	return {
		status: "valid",
		document: { tokens, [validLiquidDocument]: true },
		issues: [],
	};
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
	issues: LiquidScanIssue[],
	markup: string,
	markupStart: number,
	outerEnd: number,
): void {
	const bodyStart = markup.indexOf(LIQUID_TAG) + LIQUID_TAG.length;
	let cursor = bodyStart;
	let skippedRaw:
		| { name: string; closeName: string; start: number }
		| undefined;
	for (const line of markup.slice(bodyStart).split("\n")) {
		const lineStart = cursor;
		cursor += line.length + 1;
		const trimmed = line.trim();
		if (!trimmed) continue;
		const authoredName = TAG_NAME.exec(trimmed)?.[1];
		const name = authoredName?.toLowerCase();
		if (skippedRaw) {
			if (name === skippedRaw.closeName) skippedRaw = undefined;
			continue;
		}
		if (!name || !authoredName) continue;
		if (RAW_TAGS.has(name) || name === DOC_TAG) {
			skippedRaw = {
				name,
				closeName: `end${name}`,
				start: markupStart + lineStart + line.indexOf(trimmed),
			};
			continue;
		}
		const start = markupStart + lineStart + line.indexOf(trimmed);
		const nameEnd = trimmed.indexOf(authoredName) + name.length;
		tokens.push({
			kind: "tag",
			authoredName,
			name,
			markup: TAGS_WITHOUT_MARKUP.has(name) ? "" : trimmed.slice(nameEnd),
			markupStart: start + nameEnd,
			range: { start, end: start + trimmed.length },
			inline: true,
		});
	}
	if (skippedRaw) {
		issues.push({
			code: "UNCLOSED_RAW_TAG",
			name: skippedRaw.name,
			range: { start: skippedRaw.start, end: outerEnd },
		});
	}
}
