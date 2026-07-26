import type Parser from "tree-sitter";
import { collectEmbeddedRegions } from "./embedded-regions.js";
import { SourceOffsetIndex } from "./offset-index.js";
import type { SourceParserRegistry } from "./registry.js";
import type {
	SourceDocument,
	SourceEdit,
	SourceLanguage,
	SourceParseIssue,
	SourceRange,
	SourceUpdate,
} from "./types.js";

export function parseSourceDocument(
	registry: SourceParserRegistry,
	file: string,
	language: SourceLanguage,
	source: string,
): SourceDocument {
	const parser = registry.createParser(language);
	const tree = parser.parse(source);
	return buildDocument(file, language, source, tree);
}

/** Persistent parse state for one file. */
export class SourceFile {
	private readonly parser: Parser;
	private current: SourceDocument;

	constructor(
		registry: SourceParserRegistry,
		file: string,
		language: SourceLanguage,
		source: string,
	) {
		this.parser = registry.createParser(language);
		const tree = this.parser.parse(source);
		this.current = buildDocument(file, language, source, tree);
	}

	get document(): SourceDocument {
		return this.current;
	}

	update(edits: readonly SourceEdit[]): SourceUpdate {
		let source = this.current.source;
		const oldTree = this.current.tree;
		let index = new SourceOffsetIndex(source);
		let editedRanges: SourceRange[] = [];

		for (const edit of edits) {
			assertEdit(edit, source.length);
			editedRanges = editedRanges.map((range) =>
				mapRangeThroughEdit(range, edit),
			);
			editedRanges.push({
				start: edit.start,
				end: edit.start + edit.text.length,
			});
			const startIndex = index.treeIndexAt(edit.start);
			const oldEndIndex = index.treeIndexAt(edit.end);
			const startPosition = index.treePointAt(edit.start);
			source = `${source.slice(0, edit.start)}${edit.text}${source.slice(edit.end)}`;
			const newIndex = new SourceOffsetIndex(source);
			const newUtf16End = edit.start + edit.text.length;
			oldTree.edit({
				startIndex,
				oldEndIndex,
				newEndIndex: newIndex.treeIndexAt(newUtf16End),
				startPosition,
				oldEndPosition: index.treePointAt(edit.end),
				newEndPosition: newIndex.treePointAt(newUtf16End),
			});
			index = newIndex;
		}

		const tree = this.parser.parse(source, oldTree);
		const changedRanges = mergeRanges([
			...editedRanges,
			...oldTree
				.getChangedRanges(tree)
				.map((range) =>
					index.rangeFromTreeIndices(range.startIndex, range.endIndex),
				),
		]);
		this.current = buildDocument(
			this.current.file,
			this.current.language,
			source,
			tree,
			index,
		);
		return { document: this.current, changedRanges };
	}
}

function buildDocument(
	file: string,
	language: SourceLanguage,
	source: string,
	tree: Parser.Tree,
	index = new SourceOffsetIndex(source),
): SourceDocument {
	return {
		file,
		language,
		source,
		tree,
		issues: collectIssues(tree, index),
		embeddedRegions: collectEmbeddedRegions(source, tree, index),
	};
}

function collectIssues(
	tree: Parser.Tree,
	index: SourceOffsetIndex,
): SourceParseIssue[] {
	const issues: SourceParseIssue[] = [];
	const visit = (node: Parser.SyntaxNode): void => {
		if (node.isError || node.isMissing) {
			issues.push({
				code: node.isMissing ? "TREE_SITTER_MISSING" : "TREE_SITTER_ERROR",
				range: index.rangeFromTreeIndices(node.startIndex, node.endIndex),
				message: node.isMissing
					? `Missing ${node.type}`
					: `Unexpected syntax: ${node.text || node.type}`,
			});
		}
		for (const child of node.children) visit(child);
	};
	visit(tree.rootNode);
	return issues;
}

function mapRangeThroughEdit(
	range: SourceRange,
	edit: SourceEdit,
): SourceRange {
	const delta = edit.text.length - (edit.end - edit.start);
	if (range.end <= edit.start) return range;
	if (range.start >= edit.end) {
		return { start: range.start + delta, end: range.end + delta };
	}
	return {
		start: Math.min(range.start, edit.start),
		end: Math.max(edit.start + edit.text.length, range.end + delta),
	};
}

function mergeRanges(ranges: readonly SourceRange[]): SourceRange[] {
	const sorted = [...ranges].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const merged: SourceRange[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
		} else merged.push({ ...range });
	}
	return merged;
}

function assertEdit(edit: SourceEdit, sourceLength: number): void {
	if (
		!Number.isInteger(edit.start) ||
		!Number.isInteger(edit.end) ||
		edit.start < 0 ||
		edit.end < edit.start ||
		edit.end > sourceLength
	) {
		throw new RangeError(
			`Source edit ${edit.start}..${edit.end} is outside 0..${sourceLength}`,
		);
	}
}

export function sourceRangeFromTreeRange(
	index: SourceOffsetIndex,
	range: Parser.Range,
): SourceRange {
	return index.rangeFromTreeIndices(range.startIndex, range.endIndex);
}
