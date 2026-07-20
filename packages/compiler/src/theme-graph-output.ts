import type {
	InspectNazareThemeResult,
	SemanticThemeGraphEdge,
	SemanticThemeGraphNode,
	ThemeReference,
	ThemeSemanticModel,
} from "./theme-facts.js";
import {
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
		issues: model.issues,
	};
}

function unresolvedNodeId(reference: ThemeReference): string {
	return `unresolved:${reference.targetKind}:${reference.targetPath ?? reference.targetName ?? reference.id}`;
}
