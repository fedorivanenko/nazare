import type Parser from "tree-sitter";
import type { SourceOffsetIndex } from "./offset-index.js";
import type { EmbeddedRegion } from "./types.js";

type BlockKind = "script" | "stylesheet";
type LexicalState =
	| "code"
	| "single"
	| "double"
	| "template"
	| "line-comment"
	| "block-comment"
	| "regex";

const openTagPattern = /{%-?\s*(script|stylesheet)\b([\s\S]*?)-?%}/g;

export function collectEmbeddedRegions(
	source: string,
	tree: Parser.Tree,
	index: SourceOffsetIndex,
): EmbeddedRegion[] {
	const regions: EmbeddedRegion[] = [];
	openTagPattern.lastIndex = 0;
	let match = openTagPattern.exec(source);
	while (match) {
		const kind = match[1] as BlockKind;
		const openStart = match.index;
		const openEnd = openStart + match[0].length;
		const keywordStart = openStart + match[0].indexOf(kind);
		if (!isCstTag(tree, index, keywordStart, kind)) {
			match = openTagPattern.exec(source);
			continue;
		}

		const close = findClose(source, openEnd, kind);
		regions.push({
			language:
				kind === "stylesheet"
					? "css"
					: /\blang\s*=\s*(["'])ts\1/.test(match[2] ?? "")
						? "typescript"
						: "javascript",
			bodyRange: { start: openEnd, end: close?.start ?? source.length },
			openRange: { start: openStart, end: openEnd },
			closeRange: close,
		});

		if (!close) break;
		openTagPattern.lastIndex = close.end;
		match = openTagPattern.exec(source);
	}
	return regions;
}

function isCstTag(
	tree: Parser.Tree,
	index: SourceOffsetIndex,
	keywordStart: number,
	kind: BlockKind,
): boolean {
	let node: Parser.SyntaxNode | null = tree.rootNode.descendantForIndex(
		index.treeIndexAt(keywordStart),
	);
	while (node) {
		if (
			node.type === "custom_unpaired_statement" ||
			(kind === "stylesheet" && node.type === "stylesheet_statement")
		) {
			return true;
		}
		if (node.type === "string" || node.type === "comment") return false;
		node = node.parent;
	}
	return false;
}

function findClose(
	source: string,
	start: number,
	kind: BlockKind,
): { start: number; end: number } | undefined {
	const closeName = kind === "script" ? "endscript" : "endstylesheet";
	let state: LexicalState = "code";
	let escaped = false;
	let previousToken: string | undefined;

	for (let offset = start; offset < source.length; offset += 1) {
		const character = source[offset] as string;
		const next = source[offset + 1];
		if (state === "code") {
			const close = closeAt(source, offset, closeName);
			if (close !== undefined) return { start: offset, end: close };
			if (character === "'") state = "single";
			else if (character === '"') state = "double";
			else if (kind === "script" && character === "`") state = "template";
			else if (character === "/" && next === "*") {
				state = "block-comment";
				offset += 1;
			} else if (kind === "script" && character === "/" && next === "/") {
				state = "line-comment";
				offset += 1;
			} else if (
				kind === "script" &&
				character === "/" &&
				mayStartRegex(previousToken)
			) {
				state = "regex";
			} else if (kind === "script" && !/\s/.test(character)) {
				const identifier = source.slice(offset).match(/^[A-Za-z_$][\w$]*/)?.[0];
				if (identifier) {
					previousToken = identifier;
					offset += identifier.length - 1;
				} else previousToken = character;
			}
			continue;
		}

		if (state === "line-comment") {
			if (character === "\n" || character === "\r") state = "code";
			continue;
		}
		if (state === "block-comment") {
			if (character === "*" && next === "/") {
				state = "code";
				offset += 1;
			}
			continue;
		}
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (
			(state === "single" && character === "'") ||
			(state === "double" && character === '"') ||
			(state === "template" && character === "`") ||
			(state === "regex" && character === "/")
		) {
			previousToken = state === "regex" ? "/" : "literal";
			state = "code";
		}
	}
	return undefined;
}

function closeAt(
	source: string,
	offset: number,
	name: string,
): number | undefined {
	const match = source
		.slice(offset)
		.match(new RegExp(`^\\{%-?\\s*${name}\\s*-?%}`));
	return match ? offset + match[0].length : undefined;
}

function mayStartRegex(previousToken: string | undefined): boolean {
	return (
		previousToken === undefined ||
		"([{=,:;!&|?+-*~^<>".includes(previousToken) ||
		/^(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/.test(
			previousToken,
		)
	);
}
