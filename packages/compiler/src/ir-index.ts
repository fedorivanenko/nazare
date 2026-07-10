// Derived lookup indexes over an ArtifactIR. The IR itself stays flat arrays
// so it serializes cleanly (golden snapshots, CLI output); passes that need
// by-id or by-kind access build this index once instead of scanning. Never
// stored — always rebuilt from the IR it wraps.
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

export type ArtifactIRIndex = {
	nodeById: Map<Id, ArtifactSyntaxNode>;
	symbolById: Map<Id, ArtifactSymbol>;
	nodesOfKind<K extends ArtifactSyntaxNode["kind"]>(
		kind: K,
	): Extract<ArtifactSyntaxNode, { kind: K }>[];
	renderTargetsBySiteId: Map<Id, RenderTargetResolution[]>;
	propBindingsByArgumentId: Map<Id, PropBindingResolution[]>;
};

export function indexArtifactIR(ir: ArtifactIR): ArtifactIRIndex {
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
	for (const resolution of ir.resolutions) {
		if (resolution.kind === "render-target") {
			appendTo(renderTargetsBySiteId, resolution.renderSiteId, resolution);
		}
		if (resolution.kind === "prop-binding") {
			appendTo(propBindingsByArgumentId, resolution.argumentId, resolution);
		}
	}

	return {
		nodeById,
		symbolById,
		nodesOfKind: <K extends ArtifactSyntaxNode["kind"]>(kind: K) =>
			(nodesByKind.get(kind) ?? []) as Extract<
				ArtifactSyntaxNode,
				{ kind: K }
			>[],
		renderTargetsBySiteId,
		propBindingsByArgumentId,
	};
}

function appendTo<V>(map: Map<Id, V[]>, key: Id, value: V): void {
	const bucket = map.get(key);
	if (bucket) bucket.push(value);
	else map.set(key, [value]);
}
