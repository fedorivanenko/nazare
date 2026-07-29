import type Parser from "tree-sitter";

export function walkNamedNodes(
	root: Parser.SyntaxNode,
	visit: (node: Parser.SyntaxNode) => void,
): void {
	const cursor = root.walk();
	while (true) {
		if (cursor.currentNode.isNamed) visit(cursor.currentNode);
		if (cursor.gotoFirstChild()) continue;
		while (!cursor.gotoNextSibling()) {
			if (!cursor.gotoParent()) return;
		}
	}
}
