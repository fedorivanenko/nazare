import type {
	ArtifactContract,
	ArtifactIR,
	ArtifactResolution,
	ArtifactSymbol,
	ArtifactSyntaxNode,
	Id,
	PropDeclarationSyntaxNode,
} from "@nazare/core";
import {
	aliasSymbolId,
	componentSymbolId,
	componentSymbolIdForPackage,
	propSymbolId,
	settingSymbolId,
} from "./ids.js";

export { componentSymbolIdForPackage } from "./ids.js";

export type BindArtifactIROptions = {
	contracts?: ArtifactContract[];
};

export function bindArtifactIR(
	syntax: ArtifactSyntaxNode[],
	options: BindArtifactIROptions = {},
): ArtifactIR {
	const symbols = new Map<Id, ArtifactSymbol>();
	const resolutions: ArtifactResolution[] = [];
	const importTargetsByLocalName = new Map<string, Id>();
	const contractsByComponentSymbolId = new Map(
		(options.contracts ?? []).map((contract) => [
			contract.componentSymbolId,
			contract,
		]),
	);
	const settingSymbolsByPath = new Map<
		string,
		{ id: Id; semanticType: ArtifactSymbol["semanticType"] }
	>();
	const scopes = scopeLookup(syntax);

	for (const node of syntax) {
		if (node.kind === "component") {
			addSymbol(symbols, {
				id: componentSymbolId(scopes.forFileId(node.fileId)),
				kind: "component",
				name: node.name,
				declarations: [node.id],
				resolution: "local",
				source: "syntax",
			});
			continue;
		}

		if (node.kind === "import") {
			const importAliasId = aliasSymbolId(
				scopes.forFileId(node.fileId),
				node.localName,
			);
			const targetSymbolId = componentSymbolIdForPackage(node.packageId);
			importTargetsByLocalName.set(node.localName, targetSymbolId);

			addSymbol(symbols, {
				id: importAliasId,
				kind: "alias",
				name: node.localName,
				declarations: [node.id],
				resolution: "local",
				source: "syntax",
			});
			addSymbol(symbols, {
				id: targetSymbolId,
				kind: "component",
				name: node.packageId,
				declarations: [],
				resolution: contractsByComponentSymbolId.has(targetSymbolId)
					? "external-resolved"
					: "external-unresolved",
				source: contractsByComponentSymbolId.has(targetSymbolId)
					? "compiled-contract"
					: "manifest",
				packageId: node.packageId,
			});
			resolutions.push({
				kind: "alias-target",
				aliasSymbolId: importAliasId,
				targetSymbolId,
			});
			resolutions.push({
				kind: "import-target",
				importId: node.id,
				aliasSymbolId: importAliasId,
				targetSymbolId,
			});
			continue;
		}

		if (node.kind === "prop-declaration") {
			const scope = scopes.forPropsInterfaceId(node.propsInterfaceId);
			const propSymbol = symbolForPropDeclaration(node, scope);
			const settingSymbol = settingSymbolForPropDeclaration(node, scope);
			settingSymbolsByPath.set(`section.settings.${node.name}`, {
				id: settingSymbol.id,
				semanticType: settingSymbol.semanticType,
			});
			addSymbol(symbols, propSymbol);
			addSymbol(symbols, settingSymbol);
			resolutions.push({
				kind: "setting-projection",
				propSymbolId: propSymbol.id,
				settingSymbolId: settingSymbol.id,
			});
		}
	}

	for (const contract of options.contracts ?? []) {
		addSymbol(symbols, {
			id: contract.componentSymbolId,
			kind: "component",
			name: contract.packageId,
			declarations: [],
			resolution: "external-resolved",
			source: "compiled-contract",
			packageId: contract.packageId,
		});
		for (const prop of contract.props) {
			addSymbol(symbols, {
				id: prop.symbolId,
				kind: "prop",
				name: prop.name,
				declarations: [],
				resolution: "external-resolved",
				source: "compiled-contract",
				ownerSymbolId: contract.componentSymbolId,
				semanticType: prop.typeInfo.valueType,
			});
		}
	}

	const argumentsById = new Map(
		syntax
			.filter((node) => node.kind === "prop-argument")
			.map((node) => [node.id, node]),
	);

	for (const node of syntax) {
		if (node.kind !== "render-site") continue;

		const targetSymbolId =
			importTargetsByLocalName.get(node.targetName) ??
			componentSymbolId(node.targetName);
		if (!symbols.has(targetSymbolId)) {
			addSymbol(symbols, {
				id: targetSymbolId,
				kind: "component",
				name: node.targetName,
				declarations: [],
				resolution: "external-unresolved",
				source: "syntax",
			});
		}

		resolutions.push({
			kind: "render-target",
			renderSiteId: node.id,
			symbolId: targetSymbolId,
		});

		const contract = contractsByComponentSymbolId.get(targetSymbolId);
		if (!contract) continue;

		for (const argumentId of node.argumentIds) {
			const argument = argumentsById.get(argumentId);
			if (argument?.kind !== "prop-argument") continue;

			const contractProp = contract.props.find(
				(prop) => prop.name === argument.name,
			);
			if (!contractProp) continue;

			resolutions.push({
				kind: "prop-binding",
				renderSiteId: node.id,
				argumentId: argument.id,
				targetComponentSymbolId: targetSymbolId,
				propSymbolId: contractProp.symbolId,
				expressionId: argument.expressionId,
			});
		}
	}

	for (const node of syntax) {
		if (node.kind !== "expression") continue;
		const settingSymbol = settingSymbolsByPath.get(node.source.trim());
		if (!settingSymbol) continue;
		resolutions.push({
			kind: "symbol-reference",
			expressionId: node.id,
			symbolId: settingSymbol.id,
		});
	}

	return {
		syntax,
		symbols: Array.from(symbols.values()),
		resolutions,
		diagnostics: [],
	};
}

export function contractFromIR(
	ir: ArtifactIR,
	packageId: string,
): ArtifactContract {
	const props = ir.syntax
		.filter(
			(node): node is PropDeclarationSyntaxNode =>
				node.kind === "prop-declaration",
		)
		.map((node) => ({
			name: node.name,
			symbolId: propSymbolId(packageId, node.name),
			required: node.required,
			hasDefault: node.hasDefault,
			typeExpression: node.typeExpression,
			typeInfo: node.typeInfo,
		}));

	return {
		packageId,
		componentSymbolId: componentSymbolIdForPackage(packageId),
		props,
	};
}

// Symbol scopes come from navigating syntax nodes (prop-declaration →
// props-interface → component → file), never from parsing an ID string.
type ScopeLookup = {
	forFileId(fileId: Id): string;
	forPropsInterfaceId(propsInterfaceId: Id): string;
};

function scopeLookup(syntax: ArtifactSyntaxNode[]): ScopeLookup {
	const filePathByFileId = new Map<Id, string>();
	const fileIdByComponentId = new Map<Id, Id>();
	const ownerIdByInterfaceId = new Map<Id, Id>();

	for (const node of syntax) {
		if (node.kind === "file") filePathByFileId.set(node.id, node.path);
		if (node.kind === "component")
			fileIdByComponentId.set(node.id, node.fileId);
		if (node.kind === "props-interface")
			ownerIdByInterfaceId.set(node.id, node.ownerId);
	}

	const forFileId = (fileId: Id): string => {
		const path = filePathByFileId.get(fileId);
		if (path === undefined) {
			throw new Error(`Syntax references unknown file node ${fileId}`);
		}
		return path;
	};

	return {
		forFileId,
		forPropsInterfaceId: (propsInterfaceId) => {
			const ownerId = ownerIdByInterfaceId.get(propsInterfaceId);
			const fileId =
				ownerId === undefined ? undefined : fileIdByComponentId.get(ownerId);
			if (fileId === undefined) {
				throw new Error(
					`Props interface ${propsInterfaceId} has no resolvable owner component`,
				);
			}
			return forFileId(fileId);
		},
	};
}

function symbolForPropDeclaration(
	node: PropDeclarationSyntaxNode,
	scope: string,
): ArtifactSymbol {
	return {
		id: propSymbolId(scope, node.name),
		kind: "prop",
		name: node.name,
		declarations: [node.id],
		resolution: "local",
		source: "syntax",
		semanticType: node.typeInfo.valueType,
	};
}

function settingSymbolForPropDeclaration(
	node: PropDeclarationSyntaxNode,
	scope: string,
): ArtifactSymbol {
	return {
		id: settingSymbolId(scope, node.name),
		kind: "setting",
		name: `section.settings.${node.name}`,
		declarations: [node.id],
		resolution: "local",
		source: "syntax",
		semanticType: node.typeInfo.valueType,
	};
}

function addSymbol(
	symbols: Map<Id, ArtifactSymbol>,
	symbol: ArtifactSymbol,
): void {
	const existing = symbols.get(symbol.id);
	if (!existing) {
		symbols.set(symbol.id, symbol);
		return;
	}

	if (
		existing.resolution === "external-unresolved" &&
		symbol.resolution === "external-resolved"
	) {
		symbols.set(symbol.id, {
			...existing,
			...symbol,
			declarations: Array.from(
				new Set([...existing.declarations, ...symbol.declarations]),
			),
		});
	}
}
