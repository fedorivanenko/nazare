// Bind pass: builds the IR from syntax nodes — symbols (components, aliases,
// props, settings) and resolutions linking uses to them. Records facts only:
// a prop binding exists whenever an argument names a contract prop, even if
// the types disagree. Judging those facts belongs to check.ts; this file
// must never emit a diagnostic.
import type {
	ArtifactContract,
	ArtifactIR,
	ArtifactResolution,
	ArtifactSymbol,
	ArtifactSyntaxNode,
	Id,
	PropDeclarationSyntaxNode,
} from "@nazare/core";
import { resolveHoistedSettings } from "./hoist.js";
import {
	aliasSymbolId,
	componentSymbolId,
	componentSymbolIdForFile,
	propSymbolId,
	refSymbolId,
	settingSymbolId,
} from "./ids.js";

export { componentSymbolIdForFile } from "./ids.js";

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
			const targetSymbolId = componentSymbolIdForFile(node.path);
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
				name: node.path,
				declarations: [],
				resolution: contractsByComponentSymbolId.has(targetSymbolId)
					? "external-resolved"
					: "external-unresolved",
				source: contractsByComponentSymbolId.has(targetSymbolId)
					? "compiled-contract"
					: "syntax",
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

		if (node.kind === "element-ref") {
			const symbolId = refSymbolId(scopes.forComponentId(node.ownerId), node.name);
			const existing = symbols.get(symbolId);
			if (existing) {
				existing.declarations.push(node.id);
			} else {
				addSymbol(symbols, {
					id: symbolId,
					kind: "ref",
					name: node.name,
					declarations: [node.id],
					resolution: "local",
					source: "syntax",
				});
			}
			continue;
		}

		if (node.kind === "prop-declaration") {
			const scope = scopes.forPropsInterfaceId(node.propsInterfaceId);
			const propSymbol = symbolForPropDeclaration(node, scope);
			const settingSymbol = settingSymbolForPropDeclaration(node, scope);
			// props.x is the canonical read; section.settings.x stays resolvable
			// for themes not yet migrated.
			settingSymbolsByPath.set(`props.${node.name}`, {
				id: propSymbol.id,
				semanticType: propSymbol.semanticType,
			});
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
			name: contract.path,
			declarations: [],
			resolution: "external-resolved",
			source: "compiled-contract",
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
	const scriptsById = new Map(
		syntax
			.filter((node) => node.kind === "script")
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
		if (node.kind === "expression") {
			const settingSymbol = settingSymbolsByPath.get(node.source.trim());
			if (!settingSymbol) continue;
			resolutions.push({
				kind: "symbol-reference",
				expressionId: node.id,
				symbolId: settingSymbol.id,
			});
		}

		if (node.kind === "ref-access") {
			const scriptNode = scriptsById.get(node.scriptId);
			if (!scriptNode) continue;
			const symbolId = refSymbolId(
				scopes.forComponentId(scriptNode.ownerId),
				node.name,
			);
			if (!symbols.has(symbolId)) continue;
			resolutions.push({
				kind: "ref-binding",
				refAccessId: node.id,
				symbolId,
			});
		}
	}

	return {
		syntax,
		symbols: Array.from(symbols.values()),
		resolutions,
	};
}

export function contractFromIR(
	ir: ArtifactIR,
	path: string,
	dependencyContracts: ArtifactContract[] = [],
): ArtifactContract {
	const props = ir.syntax
		.filter(
			(node): node is PropDeclarationSyntaxNode =>
				node.kind === "prop-declaration",
		)
		.map((node) => ({
			name: node.name,
			symbolId: propSymbolId(path, node.name),
			required: node.required,
			hasDefault: node.hasDefault,
			typeExpression: node.typeExpression,
			typeInfo: node.typeInfo,
		}));

	// Settings this component hoists from its dependencies surface at its own
	// boundary as implicit render arguments, so consumers can hoist further.
	const hoisted = resolveHoistedSettings(ir, dependencyContracts).hoisted.map(
		(setting) => ({
			name: setting.settingId,
			sourcePath: setting.sourcePath,
			sourcePropName: setting.sourcePropName,
			typeInfo: setting.typeInfo,
		}),
	);

	return {
		path,
		componentSymbolId: componentSymbolIdForFile(path),
		props,
		...(hoisted.length > 0 ? { hoisted } : {}),
	};
}

// Symbol scopes come from navigating syntax nodes (prop-declaration →
// props-interface → component → file), never from parsing an ID string.
type ScopeLookup = {
	forFileId(fileId: Id): string;
	forComponentId(componentId: Id): string;
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

	const forComponentId = (componentId: Id): string => {
		const fileId = fileIdByComponentId.get(componentId);
		if (fileId === undefined) {
			throw new Error(`Unknown component syntax node ${componentId}`);
		}
		return forFileId(fileId);
	};

	return {
		forFileId,
		forComponentId,
		forPropsInterfaceId: (propsInterfaceId) => {
			const ownerId = ownerIdByInterfaceId.get(propsInterfaceId);
			if (ownerId === undefined) {
				throw new Error(
					`Props interface ${propsInterfaceId} has no resolvable owner component`,
				);
			}
			return forComponentId(ownerId);
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
