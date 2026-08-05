import { createHash } from "node:crypto";
import type { Diagnostic } from "@nazare/core";
import { normalizeProjectPath } from "./project/file-id.js";

export type OwnedOutputFile = {
	path: string;
	contents: string;
	ownerId: string;
	ownership?: "generated" | "merchant";
};

export const OUTPUT_OWNERSHIP_MANIFEST_PATH = ".nazare/build-manifest.json";

export type OutputOwnershipManifest = {
	version: 1;
	files: Readonly<Record<string, { hash: string; ownerId: string }>>;
};

export type ExistingOutputState = {
	hashes: Readonly<Record<string, string>>;
	contents: Readonly<Record<string, string>>;
	ownership: OutputOwnershipManifest;
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

export function createProtectedOwnedOutputPlan(input: {
	writes: readonly OwnedOutputFile[];
	existing: ExistingOutputState;
}): OwnedOutputPlan {
	const base = createOwnedOutputPlan({ writes: input.writes });
	const diagnostics = [...base.diagnostics];
	const writesByPath = new Map(base.writes.map((file) => [file.path, file]));
	const generatedWrites = base.writes.filter(
		(file) => file.ownership !== "merchant",
	);
	for (const file of generatedWrites) {
		const existingHash = input.existing.hashes[file.path];
		if (!existingHash) continue;
		const owned = input.existing.ownership.files[file.path];
		if (!owned) {
			diagnostics.push(
				outputConflict(
					"OUTPUT_PATH_NOT_OWNED",
					`${file.path} exists but is not owned by Nazare`,
				),
			);
		} else if (owned.hash !== existingHash) {
			diagnostics.push(
				outputConflict(
					"OUTPUT_OWNED_FILE_MODIFIED",
					`${file.path} is Nazare-owned but was modified after publication`,
				),
			);
		}
	}
	const deletes: string[] = [];
	for (const [path, owned] of Object.entries(input.existing.ownership.files)) {
		if (writesByPath.has(path) || !input.existing.hashes[path]) continue;
		if (input.existing.hashes[path] !== owned.hash) {
			diagnostics.push(
				outputConflict(
					"OUTPUT_STALE_FILE_MODIFIED",
					`${path} is stale Nazare output but was modified after publication`,
				),
			);
			continue;
		}
		deletes.push(path);
	}
	const manifest: OutputOwnershipManifest = {
		version: 1,
		files: Object.fromEntries(
			generatedWrites
				.map(
					(file) =>
						[
							file.path,
							{ hash: hashOutput(file.contents), ownerId: file.ownerId },
						] as const,
				)
				.sort(([left], [right]) => left.localeCompare(right)),
		),
	};
	const manifestFile: OwnedOutputFile = {
		path: OUTPUT_OWNERSHIP_MANIFEST_PATH,
		contents: `${JSON.stringify(manifest, null, 2)}\n`,
		ownerId: "nazare:output-ownership",
	};
	return Object.freeze({
		version: 1,
		writes: Object.freeze(
			[...base.writes, manifestFile].sort((left, right) =>
				left.path.localeCompare(right.path),
			),
		),
		deletes: Object.freeze(deletes.sort()),
		diagnostics: Object.freeze(diagnostics),
	});
}

export function hashOutput(contents: string): string {
	return `sha256-${createHash("sha256").update(contents).digest("hex")}`;
}

function outputConflict(code: string, message: string): Diagnostic {
	return { severity: "error", code, message, phase: "emit" };
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
