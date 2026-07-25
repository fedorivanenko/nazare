// Derived lookup indexes over an ArtifactIR. The IR itself stays flat arrays
// so it serializes cleanly (golden snapshots, CLI output); passes that need
// by-id or by-kind access use this index instead of scanning. The IR is
// immutable after bind, so the index is memoized per IR object — every pass
// that asks gets the same one, built once.
import type {
	ArtifactIR,
	ArtifactResolution,
	ArtifactSymbol,
	ArtifactSyntaxNode,
	Id,
} from "@nazare/core";

type PropBindingResolution = Extract<
	ArtifactResolution,
	{ kind: "prop-binding" }
>;
type RenderTargetResolution = Extract<
	ArtifactResolution,
	{ kind: "render-target" }
>;
type SymbolReferenceResolution = Extract<
	ArtifactResolution,
	{ kind: "symbol-reference" }
>;

export type ArtifactIRIndex = {
	nodeById: Map<Id, ArtifactSyntaxNode>;
	symbolById: Map<Id, ArtifactSymbol>;
	nodesOfKind<K extends ArtifactSyntaxNode["kind"]>(
		kind: K,
	): Extract<ArtifactSyntaxNode, { kind: K }>[];
	renderTargetsBySiteId: Map<Id, RenderTargetResolution[]>;
	propBindingsByArgumentId: Map<Id, PropBindingResolution[]>;
	symbolReferencesByExpressionId: Map<Id, SymbolReferenceResolution[]>;
};

const indexByIR = new WeakMap<ArtifactIR, ArtifactIRIndex>();

export function indexArtifactIR(ir: ArtifactIR): ArtifactIRIndex {
	const cached = indexByIR.get(ir);
	if (cached) return cached;

	const nodeById = new Map(ir.syntax.map((node) => [node.id, node]));
	const symbolById = new Map(ir.symbols.map((symbol) => [symbol.id, symbol]));
	const nodesByKind = new Map<string, ArtifactSyntaxNode[]>();
	for (const node of ir.syntax) {
		const bucket = nodesByKind.get(node.kind);
		if (bucket) bucket.push(node);
		else nodesByKind.set(node.kind, [node]);
	}

	const renderTargetsBySiteId = new Map<Id, RenderTargetResolution[]>();
	const propBindingsByArgumentId = new Map<Id, PropBindingResolution[]>();
	const symbolReferencesByExpressionId = new Map<
		Id,
		SymbolReferenceResolution[]
	>();
	for (const resolution of ir.resolutions) {
		if (resolution.kind === "render-target") {
			appendTo(renderTargetsBySiteId, resolution.renderSiteId, resolution);
		}
		if (resolution.kind === "prop-binding") {
			appendTo(propBindingsByArgumentId, resolution.argumentId, resolution);
		}
		if (resolution.kind === "symbol-reference") {
			appendTo(
				symbolReferencesByExpressionId,
				resolution.expressionId,
				resolution,
			);
		}
	}

	const index: ArtifactIRIndex = {
		nodeById,
		symbolById,
		nodesOfKind: <K extends ArtifactSyntaxNode["kind"]>(kind: K) =>
			(nodesByKind.get(kind) ?? []) as Extract<
				ArtifactSyntaxNode,
				{ kind: K }
			>[],
		renderTargetsBySiteId,
		propBindingsByArgumentId,
		symbolReferencesByExpressionId,
	};
	indexByIR.set(ir, index);
	return index;
}

function appendTo<V>(map: Map<Id, V[]>, key: Id, value: V): void {
	const bucket = map.get(key);
	if (bucket) bucket.push(value);
	else map.set(key, [value]);
}
