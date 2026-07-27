import type Parser from "tree-sitter";

// node-tree-sitter@0.21 rejects direct string inputs at 32,768 UTF-16 code
// units. The callback API has no file-size ceiling and preserves the runtime's
// UTF-16 indices, so use it for every parse rather than introducing a threshold
// where parser behavior changes.
const PARSE_CHUNK_SIZE = 16_384;

export function parseTreeText(
	parser: Parser,
	source: string,
	oldTree?: Parser.Tree,
): Parser.Tree {
	return parser.parse(
		(index) =>
			index >= source.length
				? null
				: source.slice(index, index + PARSE_CHUNK_SIZE),
		oldTree,
	);
}
