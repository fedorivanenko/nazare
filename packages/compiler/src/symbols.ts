import type {
	ArtifactContract,
	ArtifactIR,
	ArtifactResolution,
	ArtifactSymbol,
	ArtifactSyntaxNode,
	ExpressionSyntaxNode,
	Id,
	PropArgumentSyntaxNode,
	PropDeclarationSyntaxNode,
	RenderSiteSyntaxNode,
	ValidationIssue,
} from "@nazare/core";

export type BindArtifactIROptions = {
	contracts?: ArtifactContract[];
};

export function bindArtifactIR(
	syntax: ArtifactSyntaxNode[],
	options: BindArtifactIROptions = {},
): ArtifactIR {
	const symbols = new Map<Id, ArtifactSymbol>();
	const resolutions: ArtifactResolution[] = [];
	const diagnostics: ValidationIssue[] = [];
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

	for (const node of syntax) {
		if (node.kind === "component") {
			addSymbol(symbols, {
				id: componentSymbolIdForSyntax(node.id),
				kind: "component",
				name: node.name,
				declarations: [node.id],
				resolution: "local",
				source: "syntax",
			});
			continue;
		}

		if (node.kind === "import") {
			const aliasSymbolId = aliasSymbolIdForImport(node.fileId, node.localName);
			const targetSymbolId = componentSymbolIdForPackage(node.packageId);
			importTargetsByLocalName.set(node.localName, targetSymbolId);

			addSymbol(symbols, {
				id: aliasSymbolId,
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
				aliasSymbolId,
				targetSymbolId,
			});
			resolutions.push({
				kind: "import-target",
				importId: node.id,
				aliasSymbolId,
				targetSymbolId,
			});
			continue;
		}

		if (node.kind === "prop-declaration") {
			const propSymbol = symbolForPropDeclaration(node);
			const settingSymbol = settingSymbolForPropDeclaration(node);
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

	for (const node of syntax) {
		if (node.kind !== "render-site") continue;

		const targetSymbolId =
			importTargetsByLocalName.get(node.targetName) ??
			componentSymbolIdForName(node.targetName);
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
		if (!contract) {
			diagnostics.push({
				severity: "warning",
				code: "CONSTRAINT_UNRESOLVED_EXTERNAL_CONTRACT",
				message: `Cannot validate props for render target ${node.targetName}; contract not loaded`,
				nodeId: node.id,
				span: node.span,
			});
			continue;
		}

		const arguments_ = argumentsForRender(syntax, node);
		const argumentNames = new Set(arguments_.map((argument) => argument.name));
		for (const contractProp of contract.props) {
			if (
				!contractProp.required ||
				contractProp.hasDefault ||
				argumentNames.has(contractProp.name)
			)
				continue;
			diagnostics.push({
				severity: "error",
				code: "CONSTRAINT_REQUIRED_PROP_MISSING",
				message: `Render target ${node.targetName} requires prop ${contractProp.name}`,
				nodeId: node.id,
				span: node.span,
			});
		}

		for (const argument of arguments_) {
			const contractProp = contract.props.find(
				(prop) => prop.name === argument.name,
			);
			if (!contractProp) {
				diagnostics.push({
					severity: "error",
					code: "CONSTRAINT_UNKNOWN_PROP_ARGUMENT",
					message: `Render target ${node.targetName} has no prop ${argument.name}`,
					nodeId: argument.id,
					span: argument.span,
				});
				continue;
			}

			const expression = expressionForArgument(syntax, argument);
			const expressionType = inferExpressionType(
				expression,
				settingSymbolsByPath,
			);
			if (!isAssignable(expressionType, contractProp.typeInfo.valueType)) {
				diagnostics.push({
					severity: "error",
					code: "CONSTRAINT_PROP_TYPE_MISMATCH",
					message: `Prop ${argument.name} expects ${contractProp.typeInfo.valueType.kind} but received ${expressionType?.kind ?? "unknown"}`,
					nodeId: argument.id,
					span: argument.span,
				});
				continue;
			}

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
		diagnostics,
	};
}

export function contractFromIR(
	ir: ArtifactIR,
	packageId: string,
): ArtifactContract {
	const componentSymbolId = componentSymbolIdForPackage(packageId);
	const props = ir.syntax
		.filter(
			(node): node is PropDeclarationSyntaxNode =>
				node.kind === "prop-declaration",
		)
		.map((node) => ({
			name: node.name,
			symbolId: propSymbolIdForComponent(componentSymbolId, node.name),
			required: node.required,
			hasDefault: node.hasDefault,
			typeExpression: node.typeExpression,
			typeInfo: node.typeInfo,
		}));

	return { packageId, componentSymbolId, props };
}

function symbolForPropDeclaration(
	node: PropDeclarationSyntaxNode,
): ArtifactSymbol {
	return {
		id: propSymbolIdForComponent(
			componentSymbolIdForFile(fileFromPropsInterfaceId(node.propsInterfaceId)),
			node.name,
		),
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
): ArtifactSymbol {
	return {
		id: settingSymbolIdForComponent(
			componentSymbolIdForFile(fileFromPropsInterfaceId(node.propsInterfaceId)),
			node.name,
		),
		kind: "setting",
		name: `section.settings.${node.name}`,
		declarations: [node.id],
		resolution: "local",
		source: "syntax",
		semanticType: node.typeInfo.valueType,
	};
}

function expressionForArgument(
	syntax: ArtifactSyntaxNode[],
	argument: PropArgumentSyntaxNode,
): ExpressionSyntaxNode | undefined {
	return syntax.find(
		(node): node is ExpressionSyntaxNode =>
			node.kind === "expression" && node.id === argument.expressionId,
	);
}

function inferExpressionType(
	expression: ExpressionSyntaxNode | undefined,
	settingSymbolsByPath: Map<
		string,
		{ id: Id; semanticType: ArtifactSymbol["semanticType"] }
	>,
): ArtifactSymbol["semanticType"] {
	if (!expression) return { kind: "unknown" };
	if (expression.inferredType) return expression.inferredType;
	return (
		settingSymbolsByPath.get(expression.source.trim())?.semanticType ?? {
			kind: "unknown",
		}
	);
}

function isAssignable(
	from: ArtifactSymbol["semanticType"],
	to: ArtifactSymbol["semanticType"],
): boolean {
	if (!from || !to) return true;
	if (from.kind === "unknown" || to.kind === "unknown") return true;
	if (from.kind === "string-literal" && to.kind === "string") return true;
	if (from.kind === "number-literal" && to.kind === "number") return true;
	if (from.kind === "literal") return true;
	if (from.kind === "array" && to.kind === "array") {
		return isAssignable(from.element, to.element);
	}
	if (from.kind === "object" && to.kind === "object") {
		return isObjectAssignable(from, to);
	}
	return from.kind === to.kind;
}

function isObjectAssignable(
	from: Extract<
		NonNullable<ArtifactSymbol["semanticType"]>,
		{ kind: "object" }
	>,
	to: Extract<NonNullable<ArtifactSymbol["semanticType"]>, { kind: "object" }>,
): boolean {
	if (from.name && to.name) return from.name === to.name;
	if (!to.fields) return true;
	if (!from.fields) return false;
	return Object.entries(to.fields).every(([fieldName, fieldType]) =>
		isAssignable(from.fields?.[fieldName], fieldType),
	);
}

function argumentsForRender(
	syntax: ArtifactSyntaxNode[],
	renderSite: RenderSiteSyntaxNode,
): PropArgumentSyntaxNode[] {
	const argumentIds = new Set(renderSite.argumentIds);
	return syntax.filter(
		(node): node is PropArgumentSyntaxNode =>
			node.kind === "prop-argument" && argumentIds.has(node.id),
	);
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

function componentSymbolIdForSyntax(syntaxId: Id): Id {
	return componentSymbolIdForFile(fileFromComponentSyntaxId(syntaxId));
}

function componentSymbolIdForFile(file: string): Id {
	return `symbol:component:${file}#default`;
}

export function componentSymbolIdForPackage(packageId: string): Id {
	return `symbol:component:${packageId}#default`;
}

function componentSymbolIdForName(name: string): Id {
	return `symbol:component:${name}#default`;
}

function propSymbolIdForComponent(componentSymbolId: Id, propName: string): Id {
	return `symbol:prop:${componentSymbolId.replace(/^symbol:component:/, "")}.${propName}`;
}

function settingSymbolIdForComponent(
	componentSymbolId: Id,
	settingName: string,
): Id {
	return `symbol:setting:${componentSymbolId.replace(/^symbol:component:/, "")}.${settingName}`;
}

function aliasSymbolIdForImport(fileId: Id, localName: string): Id {
	return `symbol:alias:${fileFromFileSyntaxId(fileId)}.${localName}`;
}

function fileFromComponentSyntaxId(syntaxId: Id): string {
	return syntaxId.replace(/^syntax:component:/, "");
}

function fileFromFileSyntaxId(syntaxId: Id): string {
	return syntaxId.replace(/^syntax:file:/, "");
}

function fileFromPropsInterfaceId(propsInterfaceId: Id): string {
	return propsInterfaceId.replace(/^syntax:props-interface:/, "");
}
