// Syntax pass: lowers the parsed AST into flat ArtifactSyntaxNodes with
// stable ids (formats owned by ids.ts). This is where tree structure becomes
// id-linked records — every later pass works on this flat form, never on the
// AST. Also infers types for literal expressions, since that is still a
// purely syntactic fact.
import type {
	ArtifactSyntaxNode,
	ComponentSyntaxNode,
	ExpressionSyntaxNode,
	FileSyntaxNode,
	ImportSyntaxNode,
	PropArgumentSyntaxNode,
	PropDeclarationSyntaxNode,
	PropsInterfaceSyntaxNode,
	RenderSiteSyntaxNode,
	SemanticType,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import {
	argumentExpressionSyntaxId,
	blocksSlotSyntaxId,
	componentSyntaxId,
	elementRefSyntaxId,
	fileSyntaxId,
	importSyntaxId,
	islandPlacementSyntaxId,
	propArgumentSyntaxId,
	propDeclarationSyntaxId,
	propsInterfaceSyntaxId,
	refAccessSyntaxId,
	referenceSyntaxId,
	renderSiteSyntaxId,
	rootMarkerSyntaxId,
	scriptSyntaxId,
	styleSyntaxId,
} from "./ids.js";
import { spanFromOffsets } from "./source.js";

export {
	componentSyntaxId,
	fileSyntaxId,
	propDeclarationSyntaxId,
} from "./ids.js";

export function syntaxFromAst(ast: NazareAst): ArtifactSyntaxNode[] {
	const syntax: ArtifactSyntaxNode[] = [];
	const fileId = fileSyntaxId(ast.file);
	const componentId = componentSyntaxId(ast.file);
	const source = ast.liquidAst._source;
	const fileSpan = spanFromOffsets(source, ast.file, {
		start: 0,
		end: source.length,
	});

	const fileNode: FileSyntaxNode = {
		id: fileId,
		kind: "file",
		path: ast.file,
		span: fileSpan,
	};
	const declaredKind = ast.nodes.find(
		(node) => node.type === "NazareComponent",
	)?.componentKind;
	const componentNode: ComponentSyntaxNode = {
		id: componentId,
		kind: "component",
		name: ast.file,
		fileId,
		componentKind: declaredKind ?? "snippet",
		span: fileSpan,
	};

	syntax.push(fileNode, componentNode);

	let importIndex = 0;
	let renderIndex = 0;
	let referenceIndex = 0;
	let elementRefIndex = 0;
	let rootMarkerIndex = 0;
	let islandPlacementIndex = 0;
	let scriptIndex = 0;
	let styleIndex = 0;
	let blocksSlotIndex = 0;

	for (const node of ast.nodes) {
		if (node.type === "NazareImport") {
			importIndex += 1;
			const importNode: ImportSyntaxNode = {
				id: importSyntaxId(ast.file, node.localName, importIndex),
				kind: "import",
				localName: node.localName,
				path: node.path,
				fileId,
				span: node.span,
			};
			syntax.push(importNode);
			continue;
		}

		if (node.type === "NazareProps") {
			const propsInterfaceId = propsInterfaceSyntaxId(ast.file);
			const propDeclarations: PropDeclarationSyntaxNode[] = node.props.map(
				(prop, propIndex) => ({
					id: propDeclarationSyntaxId(ast.file, prop.name, propIndex + 1),
					kind: "prop-declaration",
					name: prop.name,
					typeExpression: prop.typeExpression,
					typeInfo: prop.typeInfo,
					required: prop.required,
					hasDefault: prop.hasDefault,
					propsInterfaceId,
					span: prop.span,
				}),
			);
			const propsInterface: PropsInterfaceSyntaxNode = {
				id: propsInterfaceId,
				kind: "props-interface",
				ownerId: componentId,
				propDeclarationIds: propDeclarations.map((prop) => prop.id),
				span: node.span,
			};

			syntax.push(propsInterface, ...propDeclarations);
			continue;
		}

		if (node.type === "NazareReference") {
			referenceIndex += 1;
			syntax.push({
				id: referenceSyntaxId(ast.file, referenceIndex),
				kind: "reference",
				target: node.target,
				binding: node.binding,
				name: node.name,
				form: node.form,
				ownerId: componentId,
				span: node.span,
			});
			continue;
		}

		if (node.type === "NazareElementRef") {
			elementRefIndex += 1;
			syntax.push({
				id: elementRefSyntaxId(ast.file, elementRefIndex),
				kind: "element-ref",
				name: node.name,
				tagName: node.tagName,
				ownerId: componentId,
				dataBindings: node.dataBindings.length ? node.dataBindings : undefined,
				span: node.span,
			});
			continue;
		}

		if (node.type === "NazareRootMarker") {
			rootMarkerIndex += 1;
			syntax.push({
				id: rootMarkerSyntaxId(ast.file, rootMarkerIndex),
				kind: "root-marker",
				tagName: node.tagName,
				ownerId: componentId,
				span: node.span,
			});
			continue;
		}

		if (node.type === "NazareIsland") {
			islandPlacementIndex += 1;
			syntax.push({
				id: islandPlacementSyntaxId(ast.file, islandPlacementIndex),
				kind: "island-placement",
				name: node.name,
				tagName: node.tagName,
				ownerId: componentId,
				span: node.span,
			});
			continue;
		}

		if (node.type === "NazareScript") {
			scriptIndex += 1;
			const scriptId = scriptSyntaxId(ast.file, scriptIndex);
			syntax.push({
				id: scriptId,
				kind: "script",
				lang: node.lang,
				source: node.source,
				ownerId: componentId,
				dataAccesses: node.dataAccesses.length ? node.dataAccesses : undefined,
				bindingName: node.bindingName,
				span: node.span,
				bodySpan: node.bodySpan,
			});
			node.refAccesses.forEach((access, accessIndex) => {
				syntax.push({
					id: refAccessSyntaxId(ast.file, scriptIndex, accessIndex + 1),
					kind: "ref-access",
					name: access.name,
					scriptId,
					span: access.span,
				});
			});
			continue;
		}

		if (node.type === "NazareStyle") {
			styleIndex += 1;
			syntax.push({
				id: styleSyntaxId(ast.file, styleIndex),
				kind: "style",
				source: node.source,
				ownerId: componentId,
				bindingName: node.bindingName,
				span: node.span,
				bodySpan: node.bodySpan,
			});
			continue;
		}

		if (node.type === "NazareBlocks") {
			blocksSlotIndex += 1;
			syntax.push({
				id: blocksSlotSyntaxId(ast.file, blocksSlotIndex),
				kind: "blocks-slot",
				blockNames: node.blockNames,
				ownerId: componentId,
				span: node.span,
			});
			continue;
		}

		if (node.type === "NazareRender") {
			renderIndex += 1;
			const renderSiteId = renderSiteSyntaxId(ast.file, renderIndex);
			const argumentNodes: PropArgumentSyntaxNode[] = [];
			const expressionNodes: ExpressionSyntaxNode[] = [];

			for (const [argumentIndex, prop] of node.props.entries()) {
				const expressionId = argumentExpressionSyntaxId(
					ast.file,
					renderIndex,
					argumentIndex + 1,
					prop.name,
				);
				const argumentId = propArgumentSyntaxId(
					ast.file,
					renderIndex,
					argumentIndex + 1,
					prop.name,
				);
				expressionNodes.push({
					id: expressionId,
					kind: "expression",
					source: prop.expression,
					inferredType: inferExpressionType(prop.expression),
					span: prop.expressionSpan,
				});
				argumentNodes.push({
					id: argumentId,
					kind: "prop-argument",
					name: prop.name,
					nameSpan: prop.nameSpan,
					expressionId,
					renderSiteId,
					span: prop.span,
				});
			}

			const renderSite: RenderSiteSyntaxNode = {
				id: renderSiteId,
				kind: "render-site",
				targetName: node.target,
				argumentIds: argumentNodes.map((argument) => argument.id),
				ownerId: componentId,
				reachability: node.reachability,
				span: node.span,
			};

			syntax.push(renderSite, ...argumentNodes, ...expressionNodes);
		}
	}

	return syntax;
}

function inferExpressionType(source: string): SemanticType | undefined {
	const trimmed = source.trim();
	const stringLiteral = trimmed.match(/^["']([^"']*)["']$/);
	if (stringLiteral) return { kind: "string-literal", value: stringLiteral[1] };
	const numberLiteral = Number(trimmed);
	if (trimmed !== "" && Number.isFinite(numberLiteral)) {
		return { kind: "number-literal", value: numberLiteral };
	}
	if (trimmed === "true" || trimmed === "false") return { kind: "boolean" };
	return undefined;
}
