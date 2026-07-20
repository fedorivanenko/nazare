import type {
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
	ThemeReference,
	ThemeSemanticModel,
} from "./theme-facts.js";
import {
	blockId,
	dataObjectId,
	dataPropertyId,
	fileId,
	schemaId,
} from "./theme-model.js";

export function themeGraphFromModel(
	model: ThemeSemanticModel,
): InspectNazareThemeResult {
	const nodes: SemanticThemeGraphNode[] = [];
	const edges: SemanticThemeGraphEdge[] = [];
	const nodeIds = new Set<string>();
	const edgeIds = new Set<string>();

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
		pushNode({
			id: file.id,
			kind: "file",
			path: file.path,
			fileKind: file.fileKind,
		});
	}
	for (const declaration of model.declarations) {
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
		pushNode({
			id: localeKey.id,
			kind: "localeKey",
			path: localeKey.path,
			key: localeKey.key,
		});
		pushEdge({
			id: `edge:declares:${fileId(localeKey.path)}->${localeKey.id}`,
			kind: "declares",
			from: fileId(localeKey.path),
			to: localeKey.id,
		});
	}
	for (const localeReference of model.localeReferences) {
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
			});
		}
	}
	for (const setting of model.settings) {
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
	for (const setting of model.blockSettings) {
		pushNode({
			id: setting.id,
			kind: "blockSetting",
			path: setting.path,
			blockType: setting.blockType,
			settingId: setting.settingId,
			settingType: setting.settingType,
		});
		pushEdge({
			id: `edge:definesBlockSetting:${blockId(setting.path, setting.blockType)}->${setting.id}`,
			kind: "definesBlockSetting",
			from: blockId(setting.path, setting.blockType),
			to: setting.id,
		});
	}
	for (const instance of model.sectionInstances) {
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
			from: fileId(instance.templatePath),
			to: instance.id,
		});
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
		});
	}
	for (const settingRead of model.settingReads) {
		const to =
			settingRead.resolvedSettingId ??
			`unresolved:setting:${settingRead.settingObject}:${settingRead.settingId}`;
		if (!settingRead.resolvedSettingId) {
			pushNode({
				id: to,
				kind: "unresolved",
				targetKind: "setting",
				name: `${settingRead.settingObject}.settings.${settingRead.settingId}`,
			});
		}
		pushEdge({
			id: `edge:readsSetting:${settingRead.id}`,
			kind: "readsSetting",
			from: fileId(settingRead.fromPath),
			to,
		});
	}
	for (const dataAccess of model.dataAccesses) {
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
		});
	}
	for (const argument of model.renderArguments) {
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
		});
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
		pushNode({
			id: input.id,
			kind: "expectedInput",
			path: input.path,
			name: input.name,
			required: input.required,
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
			});
		}
		if (reference.kind === "containsSection") {
			pushEdge({
				id: `edge:templateContainsSection:${reference.id}`,
				kind: "templateContainsSection",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
			});
		}
		if (reference.kind === "referencesAsset") {
			pushEdge({
				id: `edge:referencesAsset:${reference.id}`,
				kind: "referencesAsset",
				from: fileId(reference.fromPath),
				to,
				targetName: reference.targetName,
			});
		}
		if (reference.kind === "importsComponent") {
			pushEdge({
				id: `edge:imports:${reference.id}`,
				kind: "imports",
				from: fileId(reference.fromPath),
				to,
				specifier: reference.targetPath ?? reference.targetName ?? "",
			});
		}
	}

	return {
		version: 1,
		root: model.root,
		nodes: nodes.sort((a, b) => a.id.localeCompare(b.id)),
		edges: edges.sort((a, b) => a.id.localeCompare(b.id)),
		evidence: model.evidence,
		issues: model.issues,
	};
}

function unresolvedNodeId(reference: ThemeReference): string {
	return `unresolved:${reference.targetKind}:${reference.targetPath ?? reference.targetName ?? reference.id}`;
}
