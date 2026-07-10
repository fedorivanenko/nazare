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

	for (const syntaxNode of ir.syntax) {
		if (syntaxNode.kind === "component") {
			pushEdge(edges, "declares", syntaxNode.fileId, syntaxNode.id, "syntax");
		}
		if (syntaxNode.kind === "import") {
			pushEdge(edges, "declares", syntaxNode.fileId, syntaxNode.id, "syntax");
		}
		if (syntaxNode.kind === "props-interface") {
			pushEdge(edges, "declares", syntaxNode.ownerId, syntaxNode.id, "syntax");
		}
		if (syntaxNode.kind === "prop-declaration") {
			pushEdge(
				edges,
				"declares",
				syntaxNode.propsInterfaceId,
				syntaxNode.id,
				"syntax",
			);
		}
		if (syntaxNode.kind === "render-site") {
			pushEdge(edges, "declares", syntaxNode.ownerId, syntaxNode.id, "syntax");
			for (const argumentId of syntaxNode.argumentIds) {
				pushEdge(
					edges,
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
				"uses-expression",
				syntaxNode.id,
				syntaxNode.expressionId,
				"syntax",
			);
		}
	}

	for (const symbol of ir.symbols) {
		for (const declaration of symbol.declarations) {
			pushEdge(edges, "resolves-to", declaration, symbol.id, "resolved");
		}
	}

	for (const resolution of ir.resolutions) {
		if (resolution.kind === "setting-projection") {
			pushEdge(
				edges,
				"materializes-as-setting",
				resolution.propSymbolId,
				resolution.settingSymbolId,
				"resolved",
			);
		}
		if (resolution.kind === "alias-target") {
			pushEdge(
				edges,
				"aliases",
				resolution.aliasSymbolId,
				resolution.targetSymbolId,
				"resolved",
			);
		}
		if (resolution.kind === "import-target") {
			pushEdge(
				edges,
				"imports",
				resolution.importId,
				resolution.targetSymbolId,
				"derived",
			);
		}
		if (resolution.kind === "render-target") {
			pushEdge(
				edges,
				"renders",
				resolution.renderSiteId,
				resolution.symbolId,
				"resolved",
			);
		}
		if (resolution.kind === "prop-binding") {
			pushEdge(
				edges,
				"expects-prop",
				resolution.targetComponentSymbolId,
				resolution.propSymbolId,
				"resolved",
			);
			pushEdge(
				edges,
				"binds-to",
				resolution.argumentId,
				resolution.propSymbolId,
				"resolved",
			);
		}
		if (resolution.kind === "symbol-reference") {
			pushEdge(
				edges,
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
	kind: ArtifactGraphEdge["kind"],
	from: Id,
	to: Id,
	origin: ArtifactGraphEdge["origin"],
): void {
	if (
		edges.some(
			(edge) =>
				edge.kind === kind &&
				edge.from === from &&
				edge.to === to &&
				edge.origin === origin,
		)
	) {
		return;
	}

	edges.push({ id: `edge:${edges.length + 1}`, kind, from, to, origin });
}
