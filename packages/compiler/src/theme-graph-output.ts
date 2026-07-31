import { compareCanonicalStrings } from "./canonical-order.js";
import type {
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
	ThemeImpactSummary,
	ThemeReference,
	ThemeSemanticModel,
} from "./theme-facts.js";
import { impactSummary } from "./theme-impact.js";
import { blockId, blockInstanceId, fileId, schemaId } from "./theme-model.js";
import {
	themeReferenceTargetName,
	themeReferenceTargetPath,
} from "./theme-reference-pass.js";

export function shareThemeGraphRecords(
	previous: InspectNazareThemeResult,
	next: InspectNazareThemeResult,
): InspectNazareThemeResult {
	const previousNodes = new Map(previous.nodes.map((node) => [node.id, node]));
	const previousEdges = new Map(previous.edges.map((edge) => [edge.id, edge]));
	return {
		...next,
		nodes: next.nodes.map((node) => {
			const old = previousNodes.get(node.id);
			return old && JSON.stringify(old) === JSON.stringify(node) ? old : node;
		}),
		edges: next.edges.map((edge) => {
			const old = previousEdges.get(edge.id);
			return old && JSON.stringify(old) === JSON.stringify(edge) ? old : edge;
		}),
	};
}

export function themeGraphRecordsFromModel(
	model: ThemeSemanticModel,
	semanticIds: ReadonlySet<string>,
): {
	nodes: SemanticThemeGraphNode[];
	edges: SemanticThemeGraphEdge[];
} {
	const graph = themeGraphFromModel(model, {
		impact: {
			dependencies: {},
			dependents: {},
			affectedPages: {},
			unusedFiles: [],
		},
		selectedSemanticIds: semanticIds,
		validate: false,
	});
	return { nodes: graph.nodes, edges: graph.edges };
}

export function themeGraphFromModel(
	model: ThemeSemanticModel,
	options: {
		impact?: ThemeImpactSummary;
		selectedSemanticIds?: ReadonlySet<string>;
		validate?: boolean;
	} = {},
): InspectNazareThemeResult {
	const nodes: SemanticThemeGraphNode[] = [];
	const edges: SemanticThemeGraphEdge[] = [];
	const nodeIds = new Set<string>();
	const edgeIds = new Set<string>();
	const projects = (id: string): boolean =>
		!options.selectedSemanticIds || options.selectedSemanticIds.has(id);

	const pushNode = (node: SemanticThemeGraphNode) => {
		if (nodeIds.has(node.id)) return;
		nodeIds.add(node.id);
		nodes.push(node);
	};
	const pushEdge = (edge: SemanticThemeGraphEdge) => {
		if (edgeIds.has(edge.id)) return;
		edgeIds.add(edge.id);
		edges.push(edge);
	};

	for (const file of model.files) {
		if (!projects(file.id)) continue;
		pushNode({
			id: file.id,
			kind: "file",
			path: file.path,
			fileKind: file.fileKind,
		});
	}
	for (const sourceAnalysis of model.sourceAnalyses) {
		if (!projects(sourceAnalysis.id)) continue;
		pushNode({
			id: sourceAnalysis.id,
			kind: "sourceAnalysis",
			path: sourceAnalysis.path,
			language: sourceAnalysis.language,
			completeness: sourceAnalysis.completeness,
			uncertainty: sourceAnalysis.uncertainty,
		});
		pushEdge({
			id: `edge:hasSourceAnalysis:${fileId(sourceAnalysis.path)}->${sourceAnalysis.id}`,
			kind: "hasSourceAnalysis",
			from: fileId(sourceAnalysis.path),
			to: sourceAnalysis.id,
		});
	}
	for (const declaration of model.declarations) {
		if (!projects(declaration.id)) continue;
		if (declaration.kind === "section") {
			pushNode({
				id: declaration.id,
				kind: "section",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "snippet") {
			pushNode({
				id: declaration.id,
				kind: "snippet",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "template") {
			pushNode({
				id: declaration.id,
				kind: "template",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "layout") {
			pushNode({
				id: declaration.id,
				kind: "layout",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "locale") {
			pushNode({
				id: declaration.id,
				kind: "locale",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "asset") {
			pushNode({
				id: declaration.id,
				kind: "asset",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "sectionGroup") {
			pushNode({
				id: declaration.id,
				kind: "sectionGroup",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "themeBlock") {
			pushNode({
				id: declaration.id,
				kind: "themeBlock",
				name: declaration.name,
				path: declaration.path,
			});
		}
		if (declaration.kind === "component") {
			pushNode({
				id: declaration.id,
				kind: "component",
				name: declaration.name,
				path: declaration.path,
				componentKind: declaration.componentKind,
			});
		}
		pushEdge({
			id: `edge:declares:${fileId(declaration.path)}->${declaration.id}`,
			kind: "declares",
			from: fileId(declaration.path),
			to: declaration.id,
		});
	}
	for (const page of model.pages) {
		if (!projects(page.id)) continue;
		pushNode({
			id: page.id,
			kind: "page",
			name: page.name,
			path: page.path,
			pageType: page.pageType,
		});
		pushEdge({
			id: `edge:pageUsesTemplate:${page.id}->${page.templateDeclarationId}`,
			kind: "pageUsesTemplate",
			from: page.id,
			to: page.templateDeclarationId,
		});
	}
	for (const schema of model.schemas) {
		if (!projects(schema.id)) continue;
		pushNode({
			id: schema.id,
			kind: "schema",
			path: schema.path,
			schemaPath: schema.schemaPath,
		});
		pushEdge({
			id: `edge:definesSchema:${fileId(schema.path)}->${schema.id}`,
			kind: "definesSchema",
			from: fileId(schema.path),
			to: schema.id,
		});
	}
	for (const localeKey of model.localeKeys) {
		if (!projects(localeKey.id)) continue;
		pushNode({
			id: localeKey.id,
			kind: "localeKey",
			key: localeKey.key,
			translationPaths: [],
		});
	}
	for (const localeReference of model.localeReferences) {
		if (!projects(localeReference.id)) continue;
		const targets =
			localeReference.resolvedLocaleKeyIds.length > 0
				? localeReference.resolvedLocaleKeyIds
				: [`unresolved:locale:${localeReference.key ?? localeReference.id}`];
		for (const to of targets) {
			if (to.startsWith("unresolved:")) {
				pushNode({
					id: to,
					kind: "unresolved",
					targetKind: "localeKey",
					name: localeReference.key,
				});
			}
			pushEdge({
				id: `edge:referencesLocaleKey:${localeReference.id}->${to}`,
				kind: "referencesLocaleKey",
				from: fileId(localeReference.fromPath),
				to,
				key: localeReference.key,
				evidenceIds: [localeReference.id],
			});
		}
	}
	for (const setting of model.settings) {
		if (!projects(setting.id)) continue;
		pushNode({
			id: setting.id,
			kind: "setting",
			path: setting.path,
			schemaPath: setting.schemaPath,
			settingId: setting.settingId,
			settingType: setting.settingType,
		});
		pushEdge({
			id: `edge:definesSetting:${schemaId(setting.path, setting.schemaPath)}->${setting.id}`,
			kind: "definesSetting",
			from: schemaId(setting.path, setting.schemaPath),
			to: setting.id,
		});
	}
	for (const block of model.blocks) {
		if (!projects(block.id)) continue;
		pushNode({
			id: block.id,
			kind: "block",
			path: block.path,
			blockType: block.blockType,
			name: block.name,
		});
		pushEdge({
			id: `edge:definesBlock:${fileId(block.path)}->${block.id}`,
			kind: "definesBlock",
			from: fileId(block.path),
			to: block.id,
		});
	}
	const themeBlockByPath = new Map(
		model.declarations
			.filter((declaration) => declaration.kind === "themeBlock")
			.map((declaration) => [declaration.path, declaration]),
	);
	for (const setting of model.blockSettings) {
		if (!projects(setting.id)) continue;
		pushNode({
			id: setting.id,
			kind: "blockSetting",
			path: setting.path,
			blockType: setting.blockType,
			settingId: setting.settingId,
			settingType: setting.settingType,
		});
		const owner =
			themeBlockByPath.get(setting.path)?.id ??
			blockId(setting.path, setting.blockType);
		pushEdge({
			id: `edge:definesBlockSetting:${owner}->${setting.id}`,
			kind: "definesBlockSetting",
			from: owner,
			to: setting.id,
		});
	}
	const pageByPath = new Map(model.pages.map((page) => [page.path, page]));
	const templateDeclarationByPath = new Map(
		model.declarations
			.filter((declaration) => declaration.kind === "template")
			.map((declaration) => [declaration.path, declaration]),
	);
	for (const instance of model.sectionInstances) {
		if (!projects(instance.id)) continue;
		pushNode({
			id: instance.id,
			kind: "sectionInstance",
			templatePath: instance.templatePath,
			instanceId: instance.instanceId,
			sectionType: instance.sectionType,
		});
		pushEdge({
			id: `edge:templateContainsSectionInstance:${instance.id}`,
			kind: "templateContainsSectionInstance",
			from:
				templateDeclarationByPath.get(instance.templatePath)?.id ??
				fileId(instance.templatePath),
			to: instance.id,
			evidenceIds: [instance.id],
		});
		const page = pageByPath.get(instance.templatePath);
		if (page) {
			pushEdge({
				id: `edge:pageContainsSectionInstance:${page.id}->${instance.id}`,
				kind: "pageContainsSectionInstance",
				from: page.id,
				to: instance.id,
				evidenceIds: [instance.id],
			});
		}
		const to =
			instance.resolvedDeclarationId ??
			`unresolved:section:${instance.sectionType ?? instance.id}`;
		if (!instance.resolvedDeclarationId) {
			pushNode({
				id: to,
				kind: "unresolved",
				targetKind: "section",
				name: instance.sectionType,
			});
		}
		pushEdge({
			id: `edge:instanceOf:${instance.id}`,
			kind: "instanceOf",
			from: instance.id,
			to,
			targetName: instance.sectionType,
			evidenceIds: [instance.id],
		});
	}
	for (const instance of model.blockInstances) {
		if (!projects(instance.id)) continue;
		pushNode({
			id: instance.id,
			kind: "blockInstance",
			ownerPath: instance.ownerPath,
			sectionInstanceId: instance.sectionInstanceId,
			instanceId: instance.instanceId,
			blockType: instance.blockType,
			parentInstanceId: instance.parentInstanceId,
		});
		const parentId = instance.parentInstanceId
			? blockInstanceId(
					instance.ownerPath,
					instance.sectionInstanceId,
					instance.parentInstanceId,
				)
			: `section-instance:${instance.ownerPath}:${instance.sectionInstanceId}`;
		pushEdge({
			id: `edge:${instance.parentInstanceId ? "blockInstanceContainsBlockInstance" : "sectionInstanceContainsBlockInstance"}:${parentId}->${instance.id}`,
			kind: instance.parentInstanceId
				? "blockInstanceContainsBlockInstance"
				: "sectionInstanceContainsBlockInstance",
			from: parentId,
			to: instance.id,
			evidenceIds: [instance.id],
		});
		const target =
			instance.resolvedBlockId ??
			`unresolved:themeBlock:${instance.blockType ?? instance.id}`;
		if (!instance.resolvedBlockId) {
			pushNode({
				id: target,
				kind: "unresolved",
				targetKind: "themeBlock",
				name: instance.blockType,
			});
		}
		pushEdge({
			id: `edge:instanceOfBlock:${instance.id}->${target}`,
			kind: "instanceOfBlock",
			from: instance.id,
			to: target,
			evidenceIds: [instance.id],
		});
	}
	for (const settingRead of model.settingReads) {
		if (!projects(settingRead.id)) continue;
		const targets = settingRead.resolvedSettingId
			? [settingRead.resolvedSettingId]
			: (settingRead.candidateSettingIds ?? []);
		if (targets.length === 0) {
			const unresolved = `unresolved:setting:${settingRead.settingObject}:${settingRead.settingId}`;
			pushNode({
				id: unresolved,
				kind: "unresolved",
				targetKind: "setting",
				name: `${settingRead.settingObject}.settings.${settingRead.settingId}`,
			});
			targets.push(unresolved);
		}
		for (const target of targets) {
			pushEdge({
				id: `edge:readsSetting:${settingRead.id}->${target}`,
				kind: "readsSetting",
				from: fileId(settingRead.fromPath),
				to: target,
				evidenceIds: [settingRead.id],
			});
		}
	}
	const storeSchemaNodeId = `store-schema:${model.metafieldSchema.path}`;
	if (projects("projection:metafield-schema"))
		pushNode({
			id: storeSchemaNodeId,
			kind: "storeSchema",
			path: model.metafieldSchema.path,
			state: model.metafieldSchema.state,
			pulledAt: model.metafieldSchema.pulledAt,
		});
	for (const definition of model.metafieldDefinitions) {
		if (!projects(definition.id)) continue;
		pushNode({
			id: definition.id,
			kind: "metafieldDefinition",
			owner: definition.owner,
			namespace: definition.namespace,
			key: definition.key,
			type: definition.type,
		});
		pushEdge({
			id: `edge:schemaFor:${model.metafieldSchema.path}->${definition.id}`,
			kind: "schemaFor",
			from: storeSchemaNodeId,
			to: definition.id,
		});
	}
	for (const read of model.metafieldReads) {
		if (!projects(read.id)) continue;
		const target =
			read.definitionId ??
			`unresolved:metafield:${read.owner}:${read.namespace}:${read.key}`;
		if (!read.definitionId)
			pushNode({
				id: target,
				kind: "unresolved",
				targetKind: "metafield",
				name: `${read.owner}.metafields.${read.namespace}.${read.key}`,
			});
		pushNode({
			id: read.id,
			kind: "metafieldRead",
			fromPath: read.fromPath,
			owner: read.owner,
			namespace: read.namespace,
			key: read.key,
		});
		pushEdge({
			id: `edge:readsMetafield:${read.id}`,
			kind: "readsMetafield",
			from: fileId(read.fromPath),
			to: read.id,
			namespace: read.namespace,
			key: read.key,
			evidenceIds: [read.dataAccessId],
		});
		pushEdge({
			id: `edge:${read.definitionId ? "resolves" : "missing"}Metafield:${read.id}->${target}`,
			kind: read.definitionId
				? "resolvesMetafieldDefinition"
				: "missingMetafieldDefinition",
			from: read.id,
			to: target,
			evidenceIds: [read.dataAccessId],
		});
	}
	const declarationPathById = new Map(
		model.declarations.map((declaration) => [declaration.id, declaration.path]),
	);
	const renderRelations = new Map<
		string,
		{
			from: string;
			to: string;
			targetName?: string;
			evidenceIds: string[];
		}
	>();
	for (const reference of model.references) {
		if (reference.kind !== "rendersSnippet") continue;
		const targetPath = reference.resolvedDeclarationId
			? declarationPathById.get(reference.resolvedDeclarationId)
			: undefined;
		const from = fileId(reference.fromPath);
		const to = targetPath
			? fileId(targetPath)
			: `unresolved:snippet:${reference.targetName ?? "dynamic"}`;
		const key = `${from}\0${to}`;
		const relation = renderRelations.get(key);
		if (relation) relation.evidenceIds.push(reference.id);
		else {
			renderRelations.set(key, {
				from,
				to,
				targetName: reference.targetName,
				evidenceIds: [reference.id],
			});
		}
	}
	for (const relation of renderRelations.values()) {
		if (!relation.evidenceIds.some(projects)) continue;
		if (relation.to.startsWith("unresolved:")) {
			pushNode({
				id: relation.to,
				kind: "unresolved",
				targetKind: "snippet",
				name: relation.targetName,
			});
		}
		pushEdge({
			id: `edge:renders:${relation.from}->${relation.to}`,
			kind: "renders",
			from: relation.from,
			to: relation.to,
			evidenceIds: relation.evidenceIds,
		});
	}
	for (const reference of model.references) {
		if (
			reference.kind === "rendersSnippet" ||
			(reference.kind === "usesLayout" &&
				reference.layoutSelection === "none") ||
			!projects(reference.id)
		) {
			continue;
		}
		const to = reference.resolvedDeclarationId ?? unresolvedNodeId(reference);
		if (!reference.resolvedDeclarationId) {
			pushNode({
				id: to,
				kind: "unresolved",
				targetKind: reference.targetKind,
				name:
					themeReferenceTargetName(reference) ??
					themeReferenceTargetPath(reference),
			});
		}
		if (reference.kind === "containsSection") {
			pushEdge({
				id: `edge:templateContainsSection:${reference.id}`,
				kind: "templateContainsSection",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
				evidenceIds: [reference.id],
			});
		}
		if (reference.kind === "containsSectionGroup") {
			pushEdge({
				id: `edge:containsSectionGroup:${reference.id}`,
				kind: "containsSectionGroup",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
				evidenceIds: [reference.id],
			});
		}
		if (reference.kind === "usesLayout") {
			pushEdge({
				id: `edge:usesLayout:${reference.id}`,
				kind: "usesLayout",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
				evidenceIds: [reference.id],
			});
		}
		if (reference.kind === "referencesAsset") {
			pushEdge({
				id: `edge:referencesAsset:${reference.id}`,
				kind: "referencesAsset",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
				evidenceIds: [reference.id],
			});
		}
		if (reference.kind === "importsComponent") {
			pushEdge({
				id: `edge:imports:${reference.id}`,
				kind: "imports",
				from: fileId(reference.fromPath),
				to,
				specifier: reference.targetPath ?? reference.targetName ?? "",
				evidenceIds: [reference.id],
			});
		}
	}

	return themeGraphFromRecords(model, nodes, edges, {
		impact: options.impact,
		validate: options.validate,
	});
}

const STRUCTURAL_NODE_KINDS = new Set<SemanticThemeGraphNode["kind"]>([
	"file",
	"sourceAnalysis",
	"section",
	"snippet",
	"template",
	"page",
	"layout",
	"locale",
	"asset",
	"sectionGroup",
	"themeBlock",
	"sectionInstance",
	"blockInstance",
	"component",
	"schema",
	"block",
	"blockSetting",
	"setting",
	"localeKey",
	"metafieldDefinition",
	"metafieldRead",
	"storeSchema",
	"unresolved",
]);

const STRUCTURAL_EDGE_KINDS = new Set<SemanticThemeGraphEdge["kind"]>([
	"declares",
	"renders",
	"imports",
	"referencesAsset",
	"containsSectionGroup",
	"usesLayout",
	"referencesLocaleKey",
	"definesSchema",
	"definesSetting",
	"definesBlock",
	"definesBlockSetting",
	"pageUsesTemplate",
	"pageContainsSectionInstance",
	"templateContainsSectionInstance",
	"sectionInstanceContainsBlockInstance",
	"blockInstanceContainsBlockInstance",
	"instanceOf",
	"instanceOfBlock",
	"templateContainsSection",
	"readsSetting",
	"readsMetafield",
	"resolvesMetafieldDefinition",
	"missingMetafieldDefinition",
	"schemaFor",
	"hasSourceAnalysis",
]);

export function themeGraphFromRecords(
	model: ThemeSemanticModel,
	nodes: SemanticThemeGraphNode[],
	edges: SemanticThemeGraphEdge[],
	options: { impact?: ThemeImpactSummary; validate?: boolean } = {},
): InspectNazareThemeResult {
	const sortedNodes = nodes
		.filter((node) => STRUCTURAL_NODE_KINDS.has(node.kind))
		.sort((a, b) => compareCanonicalStrings(a.id, b.id));
	const sortedEdges = edges
		.filter((edge) => STRUCTURAL_EDGE_KINDS.has(edge.kind))
		.map((edge) => {
			const { evidenceIds, ...structural } = edge;
			if (evidenceIds) {
				Object.defineProperty(structural, "evidenceIds", {
					value: evidenceIds,
					enumerable: false,
				});
			}
			return structural as SemanticThemeGraphEdge;
		})
		.sort((a, b) => compareCanonicalStrings(a.id, b.id));
	if (options.validate !== false) {
		assertGraphIntegrity(sortedNodes, sortedEdges);
	}
	return {
		version: 5,
		root: model.root,
		nodes: sortedNodes,
		edges: sortedEdges,
		impact: options.impact ?? impactSummary(model),
		metafields: metafieldQueries(model),
		themeCheck: model.themeCheck,
		issues: model.issues,
	};
}

function metafieldQueries(model: ThemeSemanticModel) {
	const consumedDefinitionIds = new Set(
		model.metafieldReads.flatMap((read) =>
			read.definitionId ? [read.definitionId] : [],
		),
	);
	return {
		path: model.metafieldSchema.path,
		state: model.metafieldSchema.state,
		pulledAt: model.metafieldSchema.pulledAt,
		consumedDefinitionIds: [...consumedDefinitionIds].sort(),
		unconsumedDefinitionIds:
			model.metafieldSchema.state === "present"
				? model.metafieldDefinitions
						.filter((definition) => !consumedDefinitionIds.has(definition.id))
						.map((definition) => definition.id)
						.sort()
				: [],
		brokenReadIds:
			model.metafieldSchema.state === "present"
				? model.metafieldReads
						.filter((read) => !read.definitionId)
						.map((read) => read.id)
						.sort()
				: [],
	};
}

function assertGraphIntegrity(
	nodes: SemanticThemeGraphNode[],
	edges: SemanticThemeGraphEdge[],
): void {
	const nodeIds = new Set(nodes.map((node) => node.id));
	for (const edge of edges) {
		if (!nodeIds.has(edge.from)) {
			throw new Error(
				`Semantic theme graph edge ${edge.id} missing from ${edge.from}`,
			);
		}
		if (!nodeIds.has(edge.to)) {
			throw new Error(
				`Semantic theme graph edge ${edge.id} missing to ${edge.to}`,
			);
		}
	}
}

function unresolvedNodeId(reference: ThemeReference): string {
	return `unresolved:${reference.targetKind}:${themeReferenceTargetPath(reference) ?? themeReferenceTargetName(reference) ?? reference.id}`;
}
