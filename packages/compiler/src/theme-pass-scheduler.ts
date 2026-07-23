export const THEME_PASS_ORDER = [
	"source",
	"facts",
	"declarations",
	"references",
	"resolution",
	"schema",
	"dataFlow",
	"metafields",
	"capabilities",
	"diagnostics",
	"impact",
	"projection",
] as const;

export type ThemePassStage = (typeof THEME_PASS_ORDER)[number];

export type PassChange =
	| { kind: "sourceChanged"; path: string }
	| { kind: "factsChanged"; path: string }
	| { kind: "declarationChanged"; key: string }
	| { kind: "referenceChanged"; id: string }
	| { kind: "resolutionChanged"; id: string }
	| { kind: "settingChanged"; id: string }
	| { kind: "dataFlowChanged"; sourcePath: string; targetName?: string }
	| { kind: "metafieldReadChanged"; id: string }
	| {
			kind: "metafieldSnapshotChanged";
			changedKeys: string[];
			state: "unknown" | "present" | "invalid";
	  }
	| { kind: "themeCheckPolicyChanged" }
	| { kind: "exclusionPolicyChanged"; changedPatterns: string[] }
	| { kind: "diagnosticsChanged"; owner: string };

export type PassChangeKind = PassChange["kind"];
export type PassRoute = {
	kind: PassChangeKind;
	target: ThemePassStage;
	fixedPointGroup?: string;
};

export type PassDelta<RecordValue> = {
	records: RecordValue[];
	changes: PassChange[];
};

export type FixedPointStep<Key, RecordValue> = PassDelta<RecordValue> & {
	pending: Set<Key>;
};

export interface IncrementalPass<Key, RecordValue, Context> {
	readonly name: string;
	readonly stage: ThemePassStage;
	readonly routes: readonly PassRoute[];
	collectChanges(
		changes: readonly PassChange[],
		context: Readonly<Context>,
	): Set<Key>;
	run(keys: ReadonlySet<Key>, context: Context): PassDelta<RecordValue>;
}

export interface FixedPointPass<Key, RecordValue, Context> {
	readonly name: string;
	readonly stage: ThemePassStage;
	readonly routes: readonly PassRoute[];
	readonly fixedPointGroup: string;
	seed(changes: readonly PassChange[], context: Readonly<Context>): Set<Key>;
	step(
		pending: ReadonlySet<Key>,
		context: Context,
	): FixedPointStep<Key, RecordValue>;
}

type RegisteredPass<Context> =
	| { kind: "incremental"; pass: IncrementalPass<unknown, unknown, Context> }
	| { kind: "fixedPoint"; pass: FixedPointPass<unknown, unknown, Context> };

export type ThemePassTrace = {
	pass: string;
	stage: ThemePassStage;
	iterations: number;
	inputChangeCount: number;
	emittedChangeCount: number;
	recordCount: number;
};

export type ThemeSchedulerResult = {
	changes: PassChange[];
	records: unknown[];
	trace: ThemePassTrace[];
};

export class ThemePassScheduler<Context> {
	private readonly passes: RegisteredPass<Context>[];
	private readonly maximumFixedPointIterations: number;

	constructor(
		passes: RegisteredPass<Context>[],
		options: { maximumFixedPointIterations?: number } = {},
	) {
		this.passes = [...passes].sort(comparePasses);
		this.maximumFixedPointIterations =
			options.maximumFixedPointIterations ?? 10_000;
		this.validateRoutes();
	}

	execute(
		initialChanges: readonly PassChange[],
		context: Context,
	): ThemeSchedulerResult {
		const changes = deduplicateChanges(initialChanges);
		const records: unknown[] = [];
		const trace: ThemePassTrace[] = [];
		for (const registration of this.passes) {
			const before = changes.length;
			if (registration.kind === "incremental") {
				const keys = registration.pass.collectChanges(changes, context);
				if (keys.size === 0) continue;
				const delta = registration.pass.run(keys, context);
				records.push(...delta.records);
				changes.push(...newChanges(changes, delta.changes));
				trace.push({
					pass: registration.pass.name,
					stage: registration.pass.stage,
					iterations: 1,
					inputChangeCount: before,
					emittedChangeCount: changes.length - before,
					recordCount: delta.records.length,
				});
				continue;
			}
			let pending = registration.pass.seed(changes, context);
			if (pending.size === 0) continue;
			let iterations = 0;
			let recordCount = 0;
			while (pending.size > 0) {
				iterations += 1;
				if (iterations > this.maximumFixedPointIterations) {
					throw new Error(
						`Theme pass ${registration.pass.name} did not converge after ${this.maximumFixedPointIterations} iterations`,
					);
				}
				const step = registration.pass.step(pending, context);
				records.push(...step.records);
				recordCount += step.records.length;
				changes.push(...newChanges(changes, step.changes));
				pending = step.pending;
			}
			trace.push({
				pass: registration.pass.name,
				stage: registration.pass.stage,
				iterations,
				inputChangeCount: before,
				emittedChangeCount: changes.length - before,
				recordCount,
			});
		}
		return { changes, records, trace };
	}

	private validateRoutes(): void {
		const names = new Set<string>();
		for (const registration of this.passes) {
			const pass = registration.pass;
			if (names.has(pass.name)) {
				throw new Error(`Duplicate theme pass name ${pass.name}`);
			}
			names.add(pass.name);
			const sourceIndex = stageIndex(pass.stage);
			for (const route of pass.routes) {
				const targetIndex = stageIndex(route.target);
				const insideFixedPointGroup =
					registration.kind === "fixedPoint" &&
					targetIndex === sourceIndex &&
					route.fixedPointGroup === registration.pass.fixedPointGroup;
				if (
					targetIndex < sourceIndex ||
					(targetIndex === sourceIndex && !insideFixedPointGroup)
				) {
					throw new Error(
						`Theme pass ${pass.name} has non-forward ${route.kind} route ${pass.stage} -> ${route.target}`,
					);
				}
			}
		}
	}
}

export function incrementalThemePass<Context, Key, RecordValue>(
	pass: IncrementalPass<Key, RecordValue, Context>,
): RegisteredPass<Context> {
	return {
		kind: "incremental",
		pass: pass as IncrementalPass<unknown, unknown, Context>,
	};
}

export function fixedPointThemePass<Context, Key, RecordValue>(
	pass: FixedPointPass<Key, RecordValue, Context>,
): RegisteredPass<Context> {
	return {
		kind: "fixedPoint",
		pass: pass as FixedPointPass<unknown, unknown, Context>,
	};
}

function comparePasses<Context>(
	a: RegisteredPass<Context>,
	b: RegisteredPass<Context>,
): number {
	return (
		stageIndex(a.pass.stage) - stageIndex(b.pass.stage) ||
		a.pass.name.localeCompare(b.pass.name)
	);
}

function stageIndex(stage: ThemePassStage): number {
	return THEME_PASS_ORDER.indexOf(stage);
}

function deduplicateChanges(changes: readonly PassChange[]): PassChange[] {
	return newChanges([], changes);
}

function newChanges(
	existing: readonly PassChange[],
	incoming: readonly PassChange[],
): PassChange[] {
	const seen = new Set(existing.map(changeKey));
	const result: PassChange[] = [];
	for (const change of incoming) {
		const key = changeKey(change);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(change);
	}
	return result.sort((a, b) => changeKey(a).localeCompare(changeKey(b)));
}

function changeKey(change: PassChange): string {
	return JSON.stringify(change, Object.keys(change).sort());
}
