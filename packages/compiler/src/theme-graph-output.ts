import type {
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
	ThemeGraphViews,
	ThemeImpactSummary,
	ThemeReference,
	ThemeSemanticModel,
} from "./theme-facts.js";
import { impactSummary } from "./theme-impact.js";
import {
	blockId,
	blockInstanceId,
	dataObjectId,
	dataPropertyId,
	fileId,
	schemaId,
} from "./theme-model.js";

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
		pushEdge({
			id: `edge:implementedBy:${declaration.id}->${fileId(declaration.path)}`,
			kind: "implementedBy",
			from: declaration.id,
			to: fileId(declaration.path),
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
	const translationPathsByLocaleKeyId = new Map<string, string[]>();
	for (const translation of model.localeTranslations) {
		if (!projects(translation.id)) continue;
		translationPathsByLocaleKeyId.set(translation.localeKeyId, [
			...(translationPathsByLocaleKeyId.get(translation.localeKeyId) ?? []),
			translation.path,
		]);
	}
	for (const localeKey of model.localeKeys) {
		if (!projects(localeKey.id)) continue;
		pushNode({
			id: localeKey.id,
			kind: "localeKey",
			key: localeKey.key,
			translationPaths: [
				...new Set(translationPathsByLocaleKeyId.get(localeKey.id) ?? []),
			].sort((a, b) => a.localeCompare(b)),
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
	for (const dataAccess of model.dataAccesses) {
		if (!projects(dataAccess.id)) continue;
		const objectId = dataObjectId(dataAccess.object);
		pushNode({
			id: objectId,
			kind: "shopifyObject",
			object: dataAccess.object,
		});
		const to = dataAccess.propertyPath
			? dataPropertyId(dataAccess.object, dataAccess.propertyPath)
			: objectId;
		if (dataAccess.propertyPath) {
			pushNode({
				id: to,
				kind: "shopifyProperty",
				object: dataAccess.object,
				propertyPath: dataAccess.propertyPath,
			});
			pushEdge({
				id: `edge:declares:${objectId}->${to}`,
				kind: "declares",
				from: objectId,
				to,
			});
		}
		pushEdge({
			id: `edge:accessesData:${dataAccess.id}`,
			kind: "accessesData",
			from: fileId(dataAccess.fromPath),
			to,
			expression: dataAccess.expression,
			evidenceIds: [dataAccess.id],
		});
	}
	const declarationById = new Map(
		model.declarations.map((declaration) => [declaration.id, declaration]),
	);
	const expectedInputByPathAndName = new Map(
		model.expectedInputs.map((input) => [`${input.path}:${input.name}`, input]),
	);
	const renderArgumentById = new Map(
		model.renderArguments.map((argument) => [argument.id, argument]),
	);
	const renderEvidenceByLocation = new Map(
		model.references
			.filter((reference) => reference.kind === "rendersSnippet")
			.map((reference) => [
				`${reference.fromPath}:${reference.span?.start.line}:${reference.span?.start.column}`,
				reference.id,
			]),
	);
	for (const site of model.renderSites) {
		if (!projects(site.id)) continue;
		const renderEvidenceId = renderEvidenceByLocation.get(
			`${site.fromPath}:${site.span?.start.line}:${site.span?.start.column}`,
		);
		pushNode({
			id: site.id,
			kind: "renderSite",
			fromPath: site.fromPath,
			targetName: site.targetName,
			invocationKind: site.invocationKind,
		});
		pushEdge({
			id: `edge:invokes:${fileId(site.fromPath)}->${site.id}`,
			kind: "invokes",
			from: fileId(site.fromPath),
			to: site.id,
			evidenceIds: renderEvidenceId ? [renderEvidenceId] : undefined,
		});
		const target =
			site.resolvedDeclarationId ??
			`unresolved:snippet:${site.targetName ?? site.id}`;
		if (!site.resolvedDeclarationId) {
			pushNode({
				id: target,
				kind: "unresolved",
				targetKind: "snippet",
				name: site.targetName,
			});
		}
		pushEdge({
			id: `edge:resolvesRenderTarget:${site.id}->${target}`,
			kind: "resolvesRenderTarget",
			from: site.id,
			to: target,
			evidenceIds: renderEvidenceId ? [renderEvidenceId] : undefined,
		});
		for (const argumentId of site.argumentIds) {
			pushEdge({
				id: `edge:hasArgument:${site.id}->${argumentId}`,
				kind: "hasArgument",
				from: site.id,
				to: argumentId,
				evidenceIds: [argumentId],
			});
			const argument = renderArgumentById.get(argumentId);
			const targetPath = site.resolvedDeclarationId
				? declarationById.get(site.resolvedDeclarationId)?.path
				: undefined;
			const input =
				argument && targetPath
					? expectedInputByPathAndName.get(
							`${targetPath}:${argument.argumentName}`,
						)
					: undefined;
			if (input) {
				pushEdge({
					id: `edge:satisfiesInput:${argumentId}->${input.id}`,
					kind: "satisfiesInput",
					from: argumentId,
					to: input.id,
					evidenceIds: [argumentId, ...input.evidenceIds],
				});
			}
		}
	}
	for (const argument of model.renderArguments) {
		if (!projects(argument.id)) continue;
		pushNode({
			id: argument.id,
			kind: "renderArgument",
			argumentName: argument.argumentName,
			valueExpression: argument.valueExpression,
			fromPath: argument.fromPath,
			targetName: argument.targetName,
		});
		pushEdge({
			id: `edge:passesArgument:${argument.id}`,
			kind: "passesArgument",
			from: fileId(argument.fromPath),
			to: argument.id,
			argumentName: argument.argumentName,
			valueExpression: argument.valueExpression,
			evidenceIds: [argument.id],
		});
		if (argument.sourceObject?.endsWith(".settings") && argument.sourcePath) {
			const sourceKind = argument.sourceObject.split(".")[0];
			const targets =
				sourceKind === "section"
					? model.settings
							.filter(
								(setting) =>
									setting.path === argument.fromPath &&
									setting.settingId === argument.sourcePath,
							)
							.map((setting) => setting.id)
					: model.blockSettings
							.filter(
								(setting) =>
									setting.path === argument.fromPath &&
									setting.settingId === argument.sourcePath,
							)
							.map((setting) => setting.id);
			if (targets.length === 0) {
				const unresolved = `unresolved:setting:${argument.sourceObject}:${argument.sourcePath}`;
				pushNode({
					id: unresolved,
					kind: "unresolved",
					targetKind: "setting",
					name: `${argument.sourceObject}.${argument.sourcePath}`,
				});
				targets.push(unresolved);
			}
			for (const target of targets) {
				pushEdge({
					id: `edge:argumentReadsSetting:${argument.id}->${target}`,
					kind: "argumentReadsSetting",
					from: argument.id,
					to: target,
					evidenceIds: [argument.id],
				});
			}
		}
		if (argument.sourceObject && !argument.sourceObject.endsWith(".settings")) {
			const objectId = dataObjectId(argument.sourceObject);
			pushNode({
				id: objectId,
				kind: "shopifyObject",
				object: argument.sourceObject,
			});
			const to = argument.sourcePath
				? dataPropertyId(argument.sourceObject, argument.sourcePath)
				: objectId;
			if (argument.sourcePath) {
				pushNode({
					id: to,
					kind: "shopifyProperty",
					object: argument.sourceObject,
					propertyPath: argument.sourcePath,
				});
				pushEdge({
					id: `edge:declares:${objectId}->${to}`,
					kind: "declares",
					from: objectId,
					to,
				});
			}
			pushEdge({
				id: `edge:argumentValue:${argument.id}`,
				kind: "accessesData",
				from: argument.id,
				to,
				expression: argument.valueExpression,
			});
		}
	}
	for (const input of model.expectedInputs) {
		if (!projects(input.id)) continue;
		pushNode({
			id: input.id,
			kind: "expectedInput",
			path: input.path,
			name: input.name,
			required: input.required,
			requirement: input.requirement,
			provenance: input.provenance,
			inferredRequirement: input.inferredRequirement,
			declaredType: input.declaredType,
			origin: input.origin,
			propertyPaths: input.propertyPaths,
			evidenceIds: input.evidenceIds,
		});
		pushEdge({
			id: `edge:expectsInput:${fileId(input.path)}->${input.id}`,
			kind: "expectsInput",
			from: fileId(input.path),
			to: input.id,
		});
	}
	for (const capability of model.capabilities) {
		if (!projects(capability.id)) continue;
		pushNode({
			id: capability.id,
			kind: "capability",
			capability: capability.capability,
			confidence: capability.confidence,
			evidenceIds: capability.evidenceIds,
		});
		pushEdge({
			id: `edge:hasCapability:${fileId(capability.path)}->${capability.id}`,
			kind: "hasCapability",
			from: fileId(capability.path),
			to: capability.id,
		});
	}
	for (const classification of model.classifications) {
		if (!projects(classification.id)) continue;
		pushNode({
			id: classification.id,
			kind: "classification",
			label: classification.label,
			confidence: classification.confidence,
			evidenceIds: classification.evidenceIds,
			uncertainty: classification.uncertainty,
		});
		pushEdge({
			id: `edge:classifiedAs:${fileId(classification.path)}->${classification.id}`,
			kind: "classifiedAs",
			from: fileId(classification.path),
			to: classification.id,
		});
	}
	for (const reference of model.references) {
		if (!projects(reference.id)) continue;
		const to = reference.resolvedDeclarationId ?? unresolvedNodeId(reference);
		if (!reference.resolvedDeclarationId) {
			pushNode({
				id: to,
				kind: "unresolved",
				targetKind: reference.targetKind,
				name: reference.targetName ?? reference.targetPath,
			});
		}
		if (reference.kind === "rendersSnippet") {
			pushEdge({
				id: `edge:renders:${reference.id}`,
				kind: "renders",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
				evidenceIds: [reference.id],
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

export function themeGraphFromRecords(
	model: ThemeSemanticModel,
	nodes: SemanticThemeGraphNode[],
	edges: SemanticThemeGraphEdge[],
	options: { impact?: ThemeImpactSummary; validate?: boolean } = {},
): InspectNazareThemeResult {
	const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
	const sortedEdges = [...edges].sort((a, b) => a.id.localeCompare(b.id));
	const views = graphViews(sortedNodes, sortedEdges);
	if (options.validate !== false) {
		assertGraphIntegrity(sortedNodes, sortedEdges, views, model.evidence);
	}
	return {
		version: 2,
		root: model.root,
		nodes: sortedNodes,
		edges: sortedEdges,
		evidence: model.evidence,
		impact: options.impact ?? impactSummary(model),
		metafields: metafieldQueries(model),
		themeCheck: model.themeCheck,
		views,
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
	views: ThemeGraphViews,
	evidence: ThemeSemanticModel["evidence"],
): void {
	const nodeIds = new Set(nodes.map((node) => node.id));
	const evidenceIds = new Set(evidence.map((record) => record.id));
	const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
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
		for (const evidenceId of edge.evidenceIds ?? []) {
			if (!evidenceIds.has(evidenceId)) {
				throw new Error(
					`Semantic theme graph edge ${edge.id} points to missing evidence ${evidenceId}`,
				);
			}
		}
	}
	for (const [viewName, view] of Object.entries(views)) {
		const viewNodeIds = new Set(view.nodeIds);
		for (const nodeId of view.nodeIds) {
			if (!nodeIds.has(nodeId)) {
				throw new Error(
					`Semantic theme graph view ${viewName} references missing node ${nodeId}`,
				);
			}
		}
		for (const edgeId of view.edgeIds) {
			const edge = edgeById.get(edgeId);
			if (!edge) {
				throw new Error(
					`Semantic theme graph view ${viewName} references missing edge ${edgeId}`,
				);
			}
			if (!viewNodeIds.has(edge.from)) {
				throw new Error(
					`Semantic theme graph view ${viewName} omits ${edge.from}`,
				);
			}
			if (!viewNodeIds.has(edge.to)) {
				throw new Error(
					`Semantic theme graph view ${viewName} omits ${edge.to}`,
				);
			}
		}
	}
}

function graphViews(
	nodes: SemanticThemeGraphNode[],
	edges: SemanticThemeGraphEdge[],
): ThemeGraphViews {
	const view = (
		nodeKinds: Set<SemanticThemeGraphNode["kind"]>,
		edgeKinds: Set<SemanticThemeGraphEdge["kind"]>,
	) => {
		const selectedEdges = edges.filter((edge) => edgeKinds.has(edge.kind));
		const selectedNodeIds = new Set(
			nodes.filter((node) => nodeKinds.has(node.kind)).map((node) => node.id),
		);
		for (const edge of selectedEdges) {
			selectedNodeIds.add(edge.from);
			selectedNodeIds.add(edge.to);
		}
		return {
			nodeIds: [...selectedNodeIds].sort((a, b) => a.localeCompare(b)),
			edgeIds: selectedEdges
				.map((edge) => edge.id)
				.sort((a, b) => a.localeCompare(b)),
		};
	};
	return {
		themeStructure: view(
			new Set([
				"file",
				"template",
				"section",
				"sectionGroup",
				"sectionInstance",
				"blockInstance",
				"themeBlock",
				"snippet",
				"renderSite",
				"component",
				"asset",
				"layout",
			]),
			new Set([
				"declares",
				"implementedBy",
				"renders",
				"invokes",
				"resolvesRenderTarget",
				"hasArgument",
				"satisfiesInput",
				"imports",
				"referencesAsset",
				"containsSectionGroup",
				"usesLayout",
				"templateContainsSection",
				"templateContainsSectionInstance",
				"instanceOf",
				"sectionInstanceContainsBlockInstance",
				"blockInstanceContainsBlockInstance",
				"instanceOfBlock",
			]),
		),
		shopifyData: view(
			new Set(["file", "shopifyObject", "shopifyProperty"]),
			new Set(["accessesData", "declares"]),
		),
		storefrontArchitecture: view(
			new Set([
				"page",
				"template",
				"sectionInstance",
				"blockInstance",
				"section",
				"themeBlock",
				"snippet",
				"renderSite",
				"capability",
				"classification",
			]),
			new Set([
				"pageUsesTemplate",
				"pageContainsSectionInstance",
				"templateContainsSectionInstance",
				"instanceOf",
				"sectionInstanceContainsBlockInstance",
				"blockInstanceContainsBlockInstance",
				"instanceOfBlock",
				"renders",
				"invokes",
				"resolvesRenderTarget",
				"hasCapability",
				"classifiedAs",
			]),
		),
		configuration: view(
			new Set([
				"file",
				"schema",
				"setting",
				"block",
				"blockSetting",
				"locale",
				"localeKey",
			]),
			new Set([
				"definesSchema",
				"definesSetting",
				"definesBlock",
				"definesBlockSetting",
				"readsSetting",
				"argumentReadsSetting",
				"referencesLocaleKey",
			]),
		),
		changeImpact: view(
			new Set(nodes.map((node) => node.kind)),
			new Set(edges.map((edge) => edge.kind)),
		),
	};
}

function unresolvedNodeId(reference: ThemeReference): string {
	return `unresolved:${reference.targetKind}:${reference.targetPath ?? reference.targetName ?? reference.id}`;
}
