import type { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeRenderArgumentRecord,
	ThemeRenderSiteRecord,
	ThemeVariableReadRecord,
} from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeDataFlowWorkKey = string;

export function dataFlowWorkKey(
	sourcePath: string,
	targetName?: string,
): ThemeDataFlowWorkKey {
	return targetName ? `${sourcePath}\0${targetName}` : sourcePath;
}

export type ThemeDataFlowInputPassResult = {
	dataAccesses: ThemeDataAccessRecord[];
	variableReads: ThemeVariableReadRecord[];
	guardedObjects: string[];
	defaultedObjects: string[];
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[];
	renderSiteFacts: Extract<ThemeFact, { kind: "rendersSnippet" }>[];
	renderArguments: ThemeRenderArgumentRecord[];
};

export type ThemeDataFlowInputRecord =
	| ThemeDataAccessRecord
	| ThemeVariableReadRecord
	| ThemeRenderArgumentRecord;

export function deriveThemeRenderSites(
	renderSiteFacts: Extract<ThemeFact, { kind: "rendersSnippet" }>[],
	declarationByKey: Map<string, ThemeDeclaration>,
	renderArguments: ThemeRenderArgumentRecord[],
	id: (siteId: string) => string,
): ThemeRenderSiteRecord[] {
	const argumentsBySiteId = new Map<string, ThemeRenderArgumentRecord[]>();
	for (const argument of renderArguments) {
		const siteArguments = argumentsBySiteId.get(argument.siteId) ?? [];
		siteArguments.push(argument);
		argumentsBySiteId.set(argument.siteId, siteArguments);
	}
	return renderSiteFacts.map((fact) => ({
		id: id(fact.siteId),
		fromPath: fact.fromPath,
		targetName: fact.targetName,
		invocationKind: fact.invocationKind,
		resolvedDeclarationId: fact.targetName
			? declarationByKey.get(`snippet:${fact.targetName}`)?.id
			: undefined,
		argumentIds: (argumentsBySiteId.get(fact.siteId) ?? []).map(
			(argument) => argument.id,
		),
		span: fact.span,
	}));
}

export function deriveRenderArgumentDataAccesses(
	renderSites: ThemeRenderSiteRecord[],
	renderArguments: ThemeRenderArgumentRecord[],
	expectedInputs: ThemeExpectedInputRecord[],
	declarations: ThemeDeclaration[],
	variableReads: ThemeVariableReadRecord[],
): ThemeDataAccessRecord[] {
	const declarationById = new Map(
		declarations.map((declaration) => [declaration.id, declaration]),
	);
	const argumentById = new Map(
		renderArguments.map((argument) => [argument.id, argument]),
	);
	const inputsByPathAndName = new Map(
		expectedInputs.map((input) => [`${input.path}:${input.name}`, input]),
	);
	const variableReadById = new Map(
		variableReads.map((read) => [read.id, read]),
	);
	const accesses: ThemeDataAccessRecord[] = [];
	for (const site of renderSites) {
		if (!site.resolvedDeclarationId) continue;
		const targetPath = declarationById.get(site.resolvedDeclarationId)?.path;
		if (!targetPath) continue;
		for (const argumentId of site.argumentIds) {
			const argument = argumentById.get(argumentId);
			if (
				!argument?.sourceObject ||
				argument.sourceObject.endsWith(".settings")
			) {
				continue;
			}
			const input = inputsByPathAndName.get(
				`${targetPath}:${argument.argumentName}`,
			);
			if (!input) continue;
			for (const inputPropertyPath of input.propertyPaths) {
				const propertyPath = [argument.sourcePath, inputPropertyPath]
					.filter(Boolean)
					.join(".");
				const expression = propertyPath
					? `${argument.sourceObject}.${propertyPath}`
					: argument.sourceObject;
				const readEvidence = input.evidenceIds
					.map((id) => variableReadById.get(id))
					.find((read) => read?.propertyPath === inputPropertyPath);
				accesses.push({
					id: `data-access-derived:${targetPath}:${argument.id}:${expression}`,
					fromPath: targetPath,
					object: argument.sourceObject,
					propertyPath: propertyPath || undefined,
					expression,
					origin: "renderArgument",
					sourceRenderArgumentId: argument.id,
					inputName: argument.argumentName,
					span: readEvidence?.span,
				});
			}
		}
	}
	return accesses;
}

export type ThemeDataFlowIds = {
	dataAccess(
		path: string,
		expression: string,
		span: ThemeDataAccessRecord["span"],
	): string;
	variableRead(
		path: string,
		name: string,
		span: ThemeVariableReadRecord["span"],
	): string;
	renderArgument(siteId: string, argumentName: string): string;
};

export type ThemeDataFlowInputPassContext = {
	facts: ThemeFactStore;
	dataFlowInputResultsBySource: Map<string, ThemeDataFlowInputPassResult>;
	dataFlowIds: ThemeDataFlowIds;
};

export function createThemeDataFlowInputPass(): IncrementalPass<
	string,
	ThemeDataFlowInputRecord,
	ThemeDataFlowInputPassContext
> {
	return {
		name: "data-flow-inputs",
		stage: "schema",
		routes: [{ kind: "dataFlowChanged", target: "dataFlow" }],
		collectChanges(changes) {
			return new Set(
				changes
					.filter((change) => change.kind === "factsChanged")
					.map((change) => change.path),
			);
		},
		run(paths, context) {
			const records: ThemeDataFlowInputRecord[] = [];
			const changes: PassChange[] = [];
			for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
				const next = collectThemeDataFlowInputs(
					context.facts.getFile(path),
					context.dataFlowIds,
				);
				if (dataFlowInputCount(next) === 0) {
					context.dataFlowInputResultsBySource.delete(path);
				} else {
					context.dataFlowInputResultsBySource.set(path, next);
				}
				records.push(
					...next.dataAccesses,
					...next.variableReads,
					...next.renderArguments,
				);
				const targetNames = new Set(
					next.renderSiteFacts
						.map((fact) => fact.targetName)
						.filter((name): name is string => Boolean(name)),
				);
				if (targetNames.size === 0) {
					changes.push({ kind: "dataFlowChanged", sourcePath: path });
				} else {
					for (const targetName of [...targetNames].sort()) {
						changes.push({
							kind: "dataFlowChanged",
							sourcePath: path,
							targetName,
						});
					}
				}
			}
			return { records, changes };
		},
	};
}

export function collectThemeDataFlowInputs(
	facts: ThemeFact[],
	ids: ThemeDataFlowIds,
): ThemeDataFlowInputPassResult {
	const dataAccesses: ThemeDataAccessRecord[] = [];
	const variableReads: ThemeVariableReadRecord[] = [];
	const guardedObjects = new Set<string>();
	const defaultedObjects = new Set<string>();
	const docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[] = [];
	const renderSiteFacts: Extract<ThemeFact, { kind: "rendersSnippet" }>[] = [];
	const renderArguments: ThemeRenderArgumentRecord[] = [];
	for (const fact of facts) {
		if (fact.kind === "rendersSnippet") renderSiteFacts.push(fact);
		if (fact.kind === "readsFreeVariable") {
			variableReads.push({
				id: ids.variableRead(fact.fromPath, fact.name, fact.span),
				fromPath: fact.fromPath,
				name: fact.name,
				propertyPath: fact.propertyPath,
				expression: fact.expression,
				usage: fact.usage,
				span: fact.span,
			});
		}
		if (fact.kind === "guardsObject") {
			const key = `${fact.fromPath}:${fact.name}`;
			guardedObjects.add(key);
			if (fact.via === "default") defaultedObjects.add(key);
		}
		if (fact.kind === "declaresDocParam") docParams.push(fact);
		if (fact.kind === "readsShopifyData") {
			dataAccesses.push({
				id: ids.dataAccess(fact.fromPath, fact.expression, fact.span),
				fromPath: fact.fromPath,
				object: fact.object,
				propertyPath: fact.propertyPath,
				expression: fact.expression,
				conditional: fact.conditional,
				span: fact.span,
			});
		}
		if (fact.kind === "passesRenderArgument") {
			renderArguments.push({
				id: ids.renderArgument(fact.siteId, fact.argumentName),
				fromPath: fact.fromPath,
				targetName: fact.targetName,
				siteId: fact.siteId,
				argumentName: fact.argumentName,
				valueExpression: fact.valueExpression,
				sourceObject: fact.sourceObject,
				sourcePath: fact.sourcePath,
				span: fact.span,
			});
		}
	}
	return {
		dataAccesses,
		variableReads,
		guardedObjects: [...guardedObjects].sort(),
		defaultedObjects: [...defaultedObjects].sort(),
		docParams,
		renderSiteFacts,
		renderArguments,
	};
}

function dataFlowInputCount(result: ThemeDataFlowInputPassResult): number {
	return (
		result.dataAccesses.length +
		result.variableReads.length +
		result.guardedObjects.length +
		result.defaultedObjects.length +
		result.docParams.length +
		result.renderSiteFacts.length +
		result.renderArguments.length
	);
}
