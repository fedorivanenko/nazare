import { compareCanonicalStrings } from "./canonical-order.js";
import type { ThemeBehaviorRecord, ThemeSemanticModel } from "./theme-facts.js";

export type ThemeBehaviorQuery =
	| {
			subjectKind: "domHook";
			hookKind: "class" | "id" | "attribute";
			name: string;
	  }
	| {
			subjectKind: "customProperty" | "customEvent" | "customElement";
			name: string;
	  };

export type ThemeBehaviorQueryRole = "all" | "producers" | "consumers";

export type ThemeBehaviorUncertainSource = {
	path: string;
	completeness: "complete" | "partial" | "failed";
	uncertainty: string[];
};

export type ThemeBehaviorQueryResult = {
	query: ThemeBehaviorQuery;
	role: ThemeBehaviorQueryRole;
	usages: ThemeBehaviorRecord[];
	certainty: "complete" | "partial";
	uncertainSources: ThemeBehaviorUncertainSource[];
};

export type ThemeBehaviorConnection = {
	usage: ThemeBehaviorRecord;
	producers: ThemeBehaviorRecord[];
	consumers: ThemeBehaviorRecord[];
};

export type ThemeBehaviorConnectionsResult = {
	path: string;
	connections: ThemeBehaviorConnection[];
	certainty: "complete" | "partial";
	uncertainSources: ThemeBehaviorUncertainSource[];
};

type ThemeBehaviorRole = "producer" | "consumer";

export class ThemeBehaviorIndex {
	private readonly knownPaths: Set<string>;
	private readonly uncertainSources: ThemeBehaviorUncertainSource[];
	private recordsBySubject: Map<string, ThemeBehaviorRecord[]> | undefined;

	constructor(private readonly model: ThemeSemanticModel) {
		this.knownPaths = new Set(model.files.map((file) => file.path));
		this.uncertainSources = model.sourceAnalyses
			.filter(
				(source) =>
					source.completeness !== "complete" || source.uncertainty.length > 0,
			)
			.map((source) => ({
				path: source.path,
				completeness: source.completeness,
				uncertainty: [...source.uncertainty],
			}));
	}

	query(
		query: ThemeBehaviorQuery,
		role: ThemeBehaviorQueryRole,
	): ThemeBehaviorQueryResult {
		const allUsages = this.getAllUsages(query);
		let usages: ThemeBehaviorRecord[];
		switch (role) {
			case "all":
				usages = allUsages;
				break;
			case "producers":
				usages = allUsages.filter(isBehaviorProducer);
				break;
			case "consumers":
				usages = allUsages.filter(isBehaviorConsumer);
				break;
			default:
				throw new Error(`Invalid behavior query role: ${String(role)}`);
		}
		return {
			query,
			role,
			usages,
			certainty: this.certainty(),
			uncertainSources: this.copyUncertainSources(),
		};
	}

	getConnections(path: string): ThemeBehaviorConnectionsResult | undefined {
		if (!this.knownPaths.has(path)) return undefined;
		const connections = this.model.behavior
			.filter((usage) => usage.fromPath === path)
			.map((usage) => {
				const subjectUsages = this.getAllUsages(queryFromRecord(usage)).filter(
					(record) => record.id !== usage.id,
				);
				return {
					usage,
					producers: subjectUsages.filter(isBehaviorProducer),
					consumers: subjectUsages.filter(isBehaviorConsumer),
				};
			})
			.filter(
				(connection) =>
					connection.producers.length > 0 || connection.consumers.length > 0,
			)
			.sort((a, b) => compareCanonicalStrings(a.usage.id, b.usage.id));
		return {
			path,
			connections,
			certainty: this.certainty(),
			uncertainSources: this.copyUncertainSources(),
		};
	}

	private getAllUsages(query: ThemeBehaviorQuery): ThemeBehaviorRecord[] {
		assertBehaviorQuery(query);
		return [...(this.getRecordsBySubject().get(subjectKey(query)) ?? [])];
	}

	private getRecordsBySubject(): Map<string, ThemeBehaviorRecord[]> {
		if (this.recordsBySubject) return this.recordsBySubject;
		const index = new Map<string, ThemeBehaviorRecord[]>();
		for (const record of this.model.behavior) {
			const key = subjectKey(record);
			const records = index.get(key);
			if (records) records.push(record);
			else index.set(key, [record]);
		}
		this.recordsBySubject = index;
		return index;
	}

	private certainty(): "complete" | "partial" {
		return this.uncertainSources.length === 0 ? "complete" : "partial";
	}

	private copyUncertainSources(): ThemeBehaviorUncertainSource[] {
		return this.uncertainSources.map((source) => ({
			path: source.path,
			completeness: source.completeness,
			uncertainty: [...source.uncertainty],
		}));
	}
}

function assertBehaviorQuery(query: ThemeBehaviorQuery): void {
	if (!query.name) throw new Error("Behavior query name is required");
	switch (query.subjectKind) {
		case "domHook": {
			const hookKind = query.hookKind;
			switch (hookKind) {
				case "class":
				case "id":
				case "attribute":
					return;
				default:
					throw new Error(`Invalid DOM hook kind: ${String(hookKind)}`);
			}
		}
		case "customProperty":
		case "customEvent":
		case "customElement":
			if ("hookKind" in query) {
				throw new Error("hookKind is valid only when subjectKind is domHook");
			}
			return;
		default:
			throw new Error(
				`Invalid behavior subject kind: ${String((query as { subjectKind?: unknown }).subjectKind)}`,
			);
	}
}

function subjectKey(subject: ThemeBehaviorQuery | ThemeBehaviorRecord): string {
	const hookKind = subject.subjectKind === "domHook" ? subject.hookKind : "";
	return `${subject.subjectKind}\0${hookKind}\0${subject.name}`;
}

function queryFromRecord(record: ThemeBehaviorRecord): ThemeBehaviorQuery {
	return record.subjectKind === "domHook"
		? {
				subjectKind: "domHook",
				hookKind: record.hookKind,
				name: record.name,
			}
		: { subjectKind: record.subjectKind, name: record.name };
}

function isBehaviorProducer(record: ThemeBehaviorRecord): boolean {
	return behaviorRoles(record).includes("producer");
}

function isBehaviorConsumer(record: ThemeBehaviorRecord): boolean {
	return behaviorRoles(record).includes("consumer");
}

function behaviorRoles(record: ThemeBehaviorRecord): ThemeBehaviorRole[] {
	switch (record.subjectKind) {
		case "domHook": {
			const operation = record.operation;
			switch (operation) {
				case "emits":
					return ["producer"];
				case "selects":
				case "queries":
					return ["consumer"];
				case "mutates":
					return ["producer", "consumer"];
				default:
					return assertNever(operation);
			}
		}
		case "customProperty": {
			const operation = record.operation;
			switch (operation) {
				case "defines":
					return ["producer"];
				case "reads":
					return ["consumer"];
				default:
					return assertNever(operation);
			}
		}
		case "customEvent": {
			const operation = record.operation;
			switch (operation) {
				case "dispatches":
					return ["producer"];
				case "listens":
					return ["consumer"];
				default:
					return assertNever(operation);
			}
		}
		case "customElement": {
			const operation = record.operation;
			switch (operation) {
				case "defines":
					return ["producer"];
				case "uses":
					return ["consumer"];
				default:
					return assertNever(operation);
			}
		}
		default:
			return assertNever(record);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unhandled theme behavior value: ${String(value)}`);
}
