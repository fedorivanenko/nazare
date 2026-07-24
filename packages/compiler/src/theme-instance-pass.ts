import type { ThemeFactStore } from "./theme-fact-store.js";
import type {
	ThemeBlockInstanceRecord,
	ThemeFact,
	ThemeSectionInstanceRecord,
} from "./theme-facts.js";
import type { IncrementalPass, PassChange } from "./theme-pass-scheduler.js";

export type ThemeInstancePassResult = {
	sectionInstances: ThemeSectionInstanceRecord[];
	blockInstances: ThemeBlockInstanceRecord[];
};

export type ThemeInstanceRecord =
	| ThemeSectionInstanceRecord
	| ThemeBlockInstanceRecord;

export type ThemeInstanceIds = {
	section(templatePath: string, instanceId: string): string;
	block(
		ownerPath: string,
		sectionInstanceId: string,
		instanceId: string,
	): string;
};

export type ThemeInstancePassContext = {
	facts: ThemeFactStore;
	instanceResultsBySource: Map<string, ThemeInstancePassResult>;
	instanceIds: ThemeInstanceIds;
};

export function createThemeInstancePass(): IncrementalPass<
	string,
	ThemeInstanceRecord,
	ThemeInstancePassContext
> {
	return {
		name: "instances",
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
			const records: ThemeInstanceRecord[] = [];
			const changes: PassChange[] = [];
			for (const path of [...paths].sort((a, b) => a.localeCompare(b))) {
				const next = collectThemeInstances(
					context.facts.getFile(path),
					context.instanceIds,
				);
				if (
					next.sectionInstances.length === 0 &&
					next.blockInstances.length === 0
				) {
					context.instanceResultsBySource.delete(path);
				} else {
					context.instanceResultsBySource.set(path, next);
				}
				records.push(...next.sectionInstances, ...next.blockInstances);
				changes.push({ kind: "dataFlowChanged", sourcePath: path });
			}
			return { records, changes };
		},
	};
}

export function collectThemeInstances(
	facts: ThemeFact[],
	ids: ThemeInstanceIds,
): ThemeInstancePassResult {
	const sectionInstances: ThemeSectionInstanceRecord[] = [];
	const blockInstances: ThemeBlockInstanceRecord[] = [];
	for (const fact of facts) {
		if (fact.kind === "sectionInstance") {
			sectionInstances.push({
				id: ids.section(fact.templatePath, fact.instanceId),
				templatePath: fact.templatePath,
				instanceId: fact.instanceId,
				sectionType: fact.sectionType,
				static: fact.static,
			});
		}
		if (fact.kind === "blockInstance") {
			blockInstances.push({
				id: ids.block(fact.ownerPath, fact.sectionInstanceId, fact.instanceId),
				ownerPath: fact.ownerPath,
				sectionInstanceId: fact.sectionInstanceId,
				instanceId: fact.instanceId,
				blockType: fact.blockType,
				parentInstanceId: fact.parentInstanceId,
				static: fact.static,
			});
		}
	}
	return { sectionInstances, blockInstances };
}
