import type Parser from "tree-sitter";

/**
 * Node view handed to walk visitors.
 *
 * Every `SyntaxNode` property crosses the native boundary, so the walk reads
 * type and ancestry from the cursor and materializes the node only when a
 * visitor asks for it. The view is reused across visits: never retain it.
 */
export type WalkedNode = {
	/** Type of the node being visited. */
	readonly type: string;
	/** Type of the enclosing node, named or not; undefined at the root. */
	readonly parentType: string | undefined;
	/** Ancestor types from the root down to the parent. */
	readonly ancestorTypes: readonly string[];
	/** True when the parser inserted the node to recover from a syntax error. */
	readonly isMissing: boolean;
	/** Materializes the node. Cheap to call once, costly in a loop. */
	node(): Parser.SyntaxNode;
};

export function walkNamedNodes(
	root: Parser.SyntaxNode,
	visit: (walked: WalkedNode) => void,
): void {
	const cursor = root.walk();
	const ancestorTypes: string[] = [];
	let type = "";
	const walked: WalkedNode = {
		get type() {
			return type;
		},
		get parentType() {
			return ancestorTypes[ancestorTypes.length - 1];
		},
		ancestorTypes,
		get isMissing() {
			return cursor.nodeIsMissing;
		},
		node: () => cursor.currentNode,
	};
	while (true) {
		type = cursor.nodeType;
		if (cursor.nodeIsNamed) visit(walked);
		if (cursor.gotoFirstChild()) {
			ancestorTypes.push(type);
			continue;
		}
		while (!cursor.gotoNextSibling()) {
			if (!cursor.gotoParent()) return;
			ancestorTypes.pop();
		}
	}
}
