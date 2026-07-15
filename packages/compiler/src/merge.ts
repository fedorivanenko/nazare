// Whole-repo view: merges per-component IRs into one repo-wide IR. Purely
// derived and lossless-by-id. Because ids are path-addressed (an import in
// one file and the component it targets in another are built from the same
// project-relative file path), the two share a symbol id and their cross-file edges connect
// once merged. This adds no judgments — it only unions facts. Extensions build
// a repo graph with `artifactGraphFromIR(mergeArtifactIR(components...))`.
//
// Semantics an extension can rely on:
//   - Built from whatever compiled; a component with errors still contributes.
//   - An import whose target never compiled stays as an `external-unresolved`
//     component symbol with no outbound edge — a dangling node, not an error.
//   - Import cycles are allowed; the graph is a fact, not a validated tree.
import type {
	ArtifactIR,
	ArtifactResolution,
	ArtifactSymbol,
	ArtifactSymbolResolution,
	ArtifactSyntaxNode,
} from "@nazare/core";

const RESOLUTION_RANK: Record<ArtifactSymbolResolution, number> = {
	local: 2,
	"external-resolved": 1,
	"external-unresolved": 0,
};

export function mergeArtifactIR(irs: ArtifactIR[]): ArtifactIR {
	const syntax = new Map<string, ArtifactSyntaxNode>();
	const symbols = new Map<string, ArtifactSymbol>();
	const resolutions = new Map<string, ArtifactResolution>();

	for (const ir of irs) {
		for (const node of ir.syntax) {
			const existing = syntax.get(node.id);
			if (!existing) {
				syntax.set(node.id, node);
				continue;
			}
			if (!sameSyntaxNode(existing, node)) {
				throw new Error(
					`Conflicting syntax node id while merging IR: ${node.id}`,
				);
			}
		}
		for (const symbol of ir.symbols) {
			const existing = symbols.get(symbol.id);
			symbols.set(symbol.id, existing ? mergeSymbol(existing, symbol) : symbol);
		}
		for (const resolution of ir.resolutions) {
			// Resolutions carry no id; dedupe by an explicit structural key.
			resolutions.set(resolutionKey(resolution), resolution);
		}
	}

	return {
		syntax: [...syntax.values()],
		symbols: [...symbols.values()],
		resolutions: [...resolutions.values()],
	};
}

function sameSyntaxNode(a: ArtifactSyntaxNode, b: ArtifactSyntaxNode): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

// A resolution's identity is its kind plus its referenced ids. Explicit per
// kind (not JSON.stringify) so the shape is deliberate, and so adding a new
// resolution kind is a compile error here rather than a silent dedupe gap.
function resolutionKey(resolution: ArtifactResolution): string {
	switch (resolution.kind) {
		case "setting-projection":
			return `setting-projection\0${resolution.propSymbolId}\0${resolution.settingSymbolId}`;
		case "alias-target":
			return `alias-target\0${resolution.aliasSymbolId}\0${resolution.targetSymbolId}`;
		case "import-target":
			return `import-target\0${resolution.importId}\0${resolution.aliasSymbolId}\0${resolution.targetSymbolId}`;
		case "render-target":
			return `render-target\0${resolution.renderSiteId}\0${resolution.symbolId}`;
		case "prop-binding":
			return `prop-binding\0${resolution.renderSiteId}\0${resolution.argumentId}\0${resolution.targetComponentSymbolId}\0${resolution.propSymbolId}\0${resolution.expressionId}`;
		case "symbol-reference":
			return `symbol-reference\0${resolution.expressionId}\0${resolution.symbolId}`;
		case "ref-binding":
			return `ref-binding\0${resolution.refAccessId}\0${resolution.symbolId}`;
	}
}

// One component symbol appears many times: as its own local declaration and as
// an import stub in every file that imports it. Keep the most-resolved copy and
// union the declaration sites so no fact is lost.
function mergeSymbol(a: ArtifactSymbol, b: ArtifactSymbol): ArtifactSymbol {
	const base =
		RESOLUTION_RANK[a.resolution] >= RESOLUTION_RANK[b.resolution] ? a : b;
	const other = base === a ? b : a;
	return {
		...base,
		declarations: [...new Set([...base.declarations, ...other.declarations])],
		ownerSymbolId: base.ownerSymbolId ?? other.ownerSymbolId,
		semanticType: base.semanticType ?? other.semanticType,
	};
}
