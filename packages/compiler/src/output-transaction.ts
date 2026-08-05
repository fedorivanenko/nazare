import type { Diagnostic } from "@nazare/core";
import { normalizeProjectPath } from "./project/file-id.js";

export type OwnedOutputFile = {
	path: string;
	contents: string;
	ownerId: string;
};

export type OwnedOutputPlan = {
	version: 1;
	writes: readonly OwnedOutputFile[];
	deletes: readonly string[];
	diagnostics: readonly Diagnostic[];
};

export type AtomicOutputCommit = {
	plan: OwnedOutputPlan;
	expectedRevision: number;
	isCurrentRevision(): boolean;
};

export type AtomicOutputStore = {
	/**
	 * Commit all writes/deletes or none. Store must call isCurrentRevision after
	 * staging and immediately before publication, then return false without
	 * publication when stale.
	 */
	atomicCommit(commit: AtomicOutputCommit): Promise<boolean>;
};

export type OutputTransactionResult = {
	committed: true;
	revision: number;
	writtenPaths: readonly string[];
	deletedPaths: readonly string[];
};

export function createOwnedOutputPlan(input: {
	writes: readonly OwnedOutputFile[];
	previouslyOwnedPaths?: readonly string[];
}): OwnedOutputPlan {
	const writes = input.writes.map((file) => ({
		...file,
		path: normalizeProjectPath(file.path),
	}));
	const byPath = new Map<string, OwnedOutputFile[]>();
	for (const file of writes) {
		const owners = byPath.get(file.path) ?? [];
		owners.push(file);
		byPath.set(file.path, owners);
	}
	const diagnostics: Diagnostic[] = [];
	for (const [path, candidates] of byPath) {
		if (candidates.length < 2) continue;
		diagnostics.push({
			severity: "error",
			code: "OUTPUT_PATH_COLLISION",
			message: `Multiple owners emit ${path}: ${candidates
				.map((candidate) => candidate.ownerId)
				.sort()
				.join(", ")}`,
			phase: "emit",
		});
	}
	const currentPaths = new Set(writes.map((file) => file.path));
	const deletes = [...new Set(input.previouslyOwnedPaths ?? [])]
		.map(normalizeProjectPath)
		.filter((path) => !currentPaths.has(path))
		.sort();
	return Object.freeze({
		version: 1,
		writes: Object.freeze(
			writes
				.filter((file, index) =>
					writes.every(
						(candidate, candidateIndex) =>
							candidate.path !== file.path || candidateIndex === index,
					),
				)
				.sort((left, right) => left.path.localeCompare(right.path)),
		),
		deletes: Object.freeze(deletes),
		diagnostics: Object.freeze(diagnostics),
	});
}

export async function executeOutputTransaction(input: {
	plan: OwnedOutputPlan;
	expectedRevision: number;
	currentRevision(): number;
	store: AtomicOutputStore;
}): Promise<OutputTransactionResult> {
	const errors = input.plan.diagnostics.filter(
		(diagnostic) => diagnostic.severity === "error",
	);
	if (errors.length > 0) throw new OutputPlanValidationError(errors);
	const isCurrentRevision = (): boolean =>
		input.currentRevision() === input.expectedRevision;
	if (!isCurrentRevision()) {
		throw new ObsoleteOutputRevisionError(
			input.expectedRevision,
			input.currentRevision(),
		);
	}
	const committed = await input.store.atomicCommit({
		plan: input.plan,
		expectedRevision: input.expectedRevision,
		isCurrentRevision,
	});
	if (!committed) {
		throw new ObsoleteOutputRevisionError(
			input.expectedRevision,
			input.currentRevision(),
		);
	}
	return {
		committed: true,
		revision: input.expectedRevision,
		writtenPaths: input.plan.writes.map((file) => file.path),
		deletedPaths: input.plan.deletes,
	};
}

export class OutputPlanValidationError extends Error {
	readonly diagnostics: readonly Diagnostic[];

	constructor(diagnostics: readonly Diagnostic[]) {
		super("Output plan validation failed");
		this.name = "OutputPlanValidationError";
		this.diagnostics = diagnostics;
	}
}

export class ObsoleteOutputRevisionError extends Error {
	readonly expected: number;
	readonly actual: number;

	constructor(expected: number, actual: number) {
		super(
			`Output revision ${expected} is obsolete; current revision is ${actual}`,
		);
		this.name = "ObsoleteOutputRevisionError";
		this.expected = expected;
		this.actual = actual;
	}
}
