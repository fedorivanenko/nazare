import type {
	ArtifactGraph,
	ArtifactGraphEdge,
	ArtifactGraphNode,
	ArtifactIR,
	ArtifactSyntaxNode,
	Id,
} from "@nazare/core";

export function artifactGraphFromIR(ir: ArtifactIR): ArtifactGraph {
	const nodes: ArtifactGraphNode[] = [
		...ir.syntax.map(graphNodeFromSyntax),
		...ir.symbols.map(
			(symbol): ArtifactGraphNode => ({
				id: symbol.id,
				kind: symbol.kind,
				name: symbol.name,
				layer: "symbol",
			}),
		),
	];
	const edges: ArtifactGraphEdge[] = [];
	const edgeIds = new Set<Id>();

	for (const syntaxNode of ir.syntax) {
		if (syntaxNode.kind === "component") {
			pushEdge(edges, edgeIds,"declares", syntaxNode.fileId, syntaxNode.id, "syntax");
		}
		if (syntaxNode.kind === "import") {
			pushEdge(edges, edgeIds,"declares", syntaxNode.fileId, syntaxNode.id, "syntax");
		}
		if (syntaxNode.kind === "props-interface") {
			pushEdge(edges, edgeIds,"declares", syntaxNode.ownerId, syntaxNode.id, "syntax");
		}
		if (syntaxNode.kind === "prop-declaration") {
			pushEdge(
				edges,
				edgeIds,
				"declares",
				syntaxNode.propsInterfaceId,
				syntaxNode.id,
				"syntax",
			);
		}
		if (syntaxNode.kind === "render-site") {
			pushEdge(edges, edgeIds,"declares", syntaxNode.ownerId, syntaxNode.id, "syntax");
			for (const argumentId of syntaxNode.argumentIds) {
				pushEdge(
					edges,
					edgeIds,
					"supplies-argument",
					syntaxNode.id,
					argumentId,
					"syntax",
				);
			}
		}
		if (syntaxNode.kind === "prop-argument") {
			pushEdge(
				edges,
				edgeIds,
				"uses-expression",
				syntaxNode.id,
				syntaxNode.expressionId,
				"syntax",
			);
		}
	}

	for (const symbol of ir.symbols) {
		for (const declaration of symbol.declarations) {
			pushEdge(edges, edgeIds,"resolves-to", declaration, symbol.id, "resolved");
		}
	}

	for (const resolution of ir.resolutions) {
		if (resolution.kind === "setting-projection") {
			pushEdge(
				edges,
				edgeIds,
				"materializes-as-setting",
				resolution.propSymbolId,
				resolution.settingSymbolId,
				"resolved",
			);
		}
		if (resolution.kind === "alias-target") {
			pushEdge(
				edges,
				edgeIds,
				"aliases",
				resolution.aliasSymbolId,
				resolution.targetSymbolId,
				"resolved",
			);
		}
		if (resolution.kind === "import-target") {
			pushEdge(
				edges,
				edgeIds,
				"imports",
				resolution.importId,
				resolution.targetSymbolId,
				"derived",
			);
		}
		if (resolution.kind === "render-target") {
			pushEdge(
				edges,
				edgeIds,
				"renders",
				resolution.renderSiteId,
				resolution.symbolId,
				"resolved",
			);
		}
		if (resolution.kind === "prop-binding") {
			pushEdge(
				edges,
				edgeIds,
				"expects-prop",
				resolution.targetComponentSymbolId,
				resolution.propSymbolId,
				"resolved",
			);
			pushEdge(
				edges,
				edgeIds,
				"binds-to",
				resolution.argumentId,
				resolution.propSymbolId,
				"resolved",
			);
		}
		if (resolution.kind === "symbol-reference") {
			pushEdge(
				edges,
				edgeIds,
				"references",
				resolution.expressionId,
				resolution.symbolId,
				"resolved",
			);
		}
	}

	return { nodes, edges };
}

function graphNodeFromSyntax(node: ArtifactSyntaxNode): ArtifactGraphNode {
	return {
		id: node.id,
		kind: node.kind,
		name: syntaxName(node),
		layer: "syntax",
		span: "span" in node ? node.span : undefined,
	};
}

function syntaxName(node: ArtifactSyntaxNode): string {
	if (node.kind === "file") return node.path;
	if ("name" in node) return node.name;
	if (node.kind === "render-site") return node.targetName;
	if (node.kind === "import") return node.localName;
	if (node.kind === "expression") return node.source;
	return node.kind;
}

function pushEdge(
	edges: ArtifactGraphEdge[],
	edgeIds: Set<Id>,
	kind: ArtifactGraphEdge["kind"],
	from: Id,
	to: Id,
	origin: ArtifactGraphEdge["origin"],
): void {
	// Edge identity is its content, so ids stay stable across emission order.
	const id = `edge:${origin}:${kind}:${from}->${to}`;
	if (edgeIds.has(id)) return;

	edgeIds.add(id);
	edges.push({ id, kind, from, to, origin });
}
