import type {
	ArtifactMorphism,
	ArtifactObject,
	ArtifactSemanticGraph,
	Id,
} from "@nazare/core";
import type { NazareAst, NazareNode } from "./ast.js";

export function artifactGraphFromAst(ast: NazareAst): ArtifactSemanticGraph {
	const objects = new Map<Id, ArtifactObject>();
	const morphisms: ArtifactMorphism[] = [];
	const fileId = `file:${ast.file}`;
	const imports = new Map<string, string>();

	addObject(objects, {
		id: fileId,
		kind: "file",
		name: ast.file,
		span: ast.nodes[0]?.span,
	});

	let morphismIndex = 0;
	let renderIndex = 0;

	for (const node of ast.nodes) {
		if (node.type === "NazareImport") {
			const importId = `import:${ast.file}:${node.localName}`;
			const componentId = componentIdForPackage(node.packageId);
			imports.set(node.localName, componentId);

			addObject(objects, {
				id: importId,
				kind: "import",
				name: node.localName,
				data: { packageId: node.packageId },
				span: node.span,
			});
			addObject(objects, {
				id: componentId,
				kind: "component",
				name: node.localName,
				data: { packageId: node.packageId },
				span: node.span,
			});
			morphisms.push({
				id: morphismId(++morphismIndex),
				kind: "declares",
				from: fileId,
				to: importId,
				span: node.span,
			});
			morphisms.push({
				id: morphismId(++morphismIndex),
				kind: "imports",
				from: fileId,
				to: componentId,
				span: node.span,
			});
			continue;
		}

		if (node.type === "NazareProps") {
			const propsInterfaceId = `props-interface:${ast.file}`;
			addObject(objects, {
				id: propsInterfaceId,
				kind: "props-interface",
				name: `${ast.file} props`,
				span: node.span,
			});
			morphisms.push({
				id: morphismId(++morphismIndex),
				kind: "declares",
				from: fileId,
				to: propsInterfaceId,
				span: node.span,
			});

			for (const prop of node.props) {
				const propId = `prop:${ast.file}:expected:${prop.name}`;
				addObject(objects, {
					id: propId,
					kind: "prop",
					name: prop.name,
					data: {
						typeExpression: prop.typeExpression,
						required: prop.required,
						hasDefault: prop.hasDefault,
					},
					span: prop.span,
				});
				morphisms.push({
					id: morphismId(++morphismIndex),
					kind: "expects-prop",
					from: propsInterfaceId,
					to: propId,
					span: prop.span,
				});
			}
			continue;
		}

		if (node.type === "NazareRender") {
			renderIndex += 1;
			morphismIndex = addRenderNode({
				ast,
				node,
				objects,
				morphisms,
				imports,
				renderIndex,
				morphismIndex,
			});
		}
	}

	return { objects: Array.from(objects.values()), morphisms };
}

function addRenderNode(input: {
	ast: NazareAst;
	node: Extract<NazareNode, { type: "NazareRender" }>;
	objects: Map<Id, ArtifactObject>;
	morphisms: ArtifactMorphism[];
	imports: Map<string, string>;
	renderIndex: number;
	morphismIndex: number;
}): number {
	const renderId = `render:${input.ast.file}:${input.renderIndex}`;
	const targetId =
		input.imports.get(input.node.target) ?? `component:${input.node.target}`;
	let morphismIndex = input.morphismIndex;

	addObject(input.objects, {
		id: renderId,
		kind: "render-site",
		name: `${input.node.target} render`,
		data: { target: input.node.target },
		span: input.node.span,
	});
	addObject(input.objects, {
		id: targetId,
		kind: "component",
		name: input.node.target,
		span: input.node.span,
	});
	input.morphisms.push({
		id: morphismId(++morphismIndex),
		kind: "renders",
		from: renderId,
		to: targetId,
		span: input.node.span,
	});

	for (const prop of input.node.props) {
		const propId = `prop:${input.ast.file}:render:${input.renderIndex}:${prop.name}`;
		addObject(input.objects, {
			id: propId,
			kind: "prop",
			name: prop.name,
			data: { expression: prop.expression },
			span: prop.span,
		});
		input.morphisms.push({
			id: morphismId(++morphismIndex),
			kind: "passes-prop",
			from: renderId,
			to: propId,
			span: prop.span,
		});
	}

	return morphismIndex;
}

function addObject(
	objects: Map<Id, ArtifactObject>,
	object: ArtifactObject,
): void {
	if (!objects.has(object.id)) objects.set(object.id, object);
}

function componentIdForPackage(packageId: string): Id {
	return `component:${packageId}`;
}

function morphismId(index: number): Id {
	return `morphism:${index}`;
}
