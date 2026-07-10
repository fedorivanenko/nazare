import type { Id } from "./id.js";
import type { ArtifactSymbol } from "./symbol.js";
import type { ArtifactSyntaxNode } from "./syntax.js";

export type ArtifactResolution =
	| {
			kind: "setting-projection";
			propSymbolId: Id;
			settingSymbolId: Id;
	  }
	| {
			kind: "alias-target";
			aliasSymbolId: Id;
			targetSymbolId: Id;
	  }
	| {
			kind: "import-target";
			importId: Id;
			aliasSymbolId: Id;
			targetSymbolId: Id;
	  }
	| {
			kind: "render-target";
			renderSiteId: Id;
			symbolId: Id;
	  }
	| {
			kind: "prop-binding";
			renderSiteId: Id;
			argumentId: Id;
			targetComponentSymbolId: Id;
			propSymbolId: Id;
			expressionId: Id;
	  }
	| {
			kind: "symbol-reference";
			expressionId: Id;
			symbolId: Id;
	  };

export type ArtifactIR = {
	syntax: ArtifactSyntaxNode[];
	symbols: ArtifactSymbol[];
	resolutions: ArtifactResolution[];
};
