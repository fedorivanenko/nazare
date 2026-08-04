import type { Diagnostic } from "@nazare/core";
import type { ProductKey } from "../computation/canonical-key.js";
import {
	type ComputationGraph,
	type ComputationRequestOptions,
	createComputationGraph,
} from "../computation/graph.js";
import type { Product } from "../computation/product.js";
import { coalesceInputChanges } from "./change-batch.js";
import {
	compareProjectFileIds,
	type ProjectFileId,
	projectFileId,
	serializeProjectFileId,
} from "./file-id.js";
import type { ProjectFile } from "./file-system-provider.js";
import type { ExternalProjectInputProvider, ProjectHost } from "./host.js";
import type { InputChange } from "./input-provider.js";
import { mergeAsyncIterables } from "./merged-watcher.js";

export type ExternalProjectInputId = {
	providerId: string;
	key: string;
};

export type ExternalProjectInputSnapshot = ExternalProjectInputId & {
	providerVersion: number;
	fingerprint: string;
};

export type ProjectSnapshot = {
	revision: number;
	fileIds: readonly ProjectFileId[];
	externalInputs: readonly ExternalProjectInputSnapshot[];
};

export type ProjectChangeBatch =
	| {
			kind: "files";
			changes: readonly InputChange<ProjectFileId>[];
	  }
	| {
			kind: "external";
			providerId: string;
			changes: readonly InputChange<string>[];
	  };

export type ProjectSessionUpdate =
	| {
			committed: true;
			revision: number;
			changedFileIds: readonly ProjectFileId[];
			changedExternalInputs: readonly ExternalProjectInputId[];
	  }
	| {
			committed: false;
			revision: number;
			diagnostics: readonly Diagnostic[];
			error?: unknown;
	  };

export type ProjectSessionValidator = (
	snapshot: ProjectSnapshot,
) => readonly Diagnostic[];

export type ProjectSession = {
	host: ProjectHost<ProjectFileId, ProjectFile>;
	graph: ComputationGraph;
	snapshot(): ProjectSnapshot;
	get<Key extends ProductKey, Result>(
		product: Product<Key, Result>,
		options?: Omit<ComputationRequestOptions, "revision">,
	): Promise<Result>;
	apply(batch: ProjectChangeBatch): Promise<ProjectSessionUpdate>;
	watch(): AsyncIterable<ProjectSessionUpdate>;
};

type ExternalState = {
	input: ExternalProjectInputProvider;
	fingerprints: Map<string, string>;
};

export async function createProjectSession(input: {
	host: ProjectHost<ProjectFileId, ProjectFile>;
	graph?: ComputationGraph;
	validators?: readonly ProjectSessionValidator[];
}): Promise<ProjectSession> {
	const graph = input.graph ?? createComputationGraph();
	const validators = input.validators ?? [];
	const filesByIdentity = new Map<string, ProjectFileId>();
	const externalByProvider = new Map<string, ExternalState>();
	const initial = graph.beginUpdate();

	for (const discovered of await input.host.discover()) {
		const id = projectFileId(discovered);
		const identity = serializeProjectFileId(id);
		if (filesByIdentity.has(identity)) {
			throw new Error(`Duplicate project file ID: ${id.path}`);
		}
		const file = await input.host.files.read(id);
		filesByIdentity.set(identity, id);
		initial.setInput(projectFileRevisionInput(id), file.fingerprint);
	}

	for (const external of input.host.externalInputs ?? []) {
		const fingerprints = new Map<string, string>();
		for (const key of [...(await external.discover())].sort()) {
			if (fingerprints.has(key)) {
				throw new Error(`Duplicate ${external.provider.id} input key: ${key}`);
			}
			const value = await external.provider.read(key);
			fingerprints.set(key, value.fingerprint);
			initial.setInput(
				externalProjectInput(
					external.provider.id,
					external.provider.version,
					key,
				),
				value.fingerprint,
			);
		}
		externalByProvider.set(external.provider.id, {
			input: external,
			fingerprints,
		});
	}

	const createSnapshot = (revision: number): ProjectSnapshot =>
		Object.freeze({
			revision,
			fileIds: Object.freeze(
				[...filesByIdentity.values()].sort(compareProjectFileIds),
			),
			externalInputs: Object.freeze(externalSnapshots(externalByProvider)),
		});
	const initialDiagnostics = validateSnapshot(
		createSnapshot(graph.revision + 1),
		validators,
	);
	if (hasErrors(initialDiagnostics)) {
		initial.rollback();
		throw new ProjectSessionValidationError(initialDiagnostics);
	}
	initial.commit();

	const apply = async (
		batch: ProjectChangeBatch,
	): Promise<ProjectSessionUpdate> => {
		const candidateFiles = new Map(filesByIdentity);
		const candidateExternal = cloneExternalState(externalByProvider);
		const update = graph.beginUpdate();
		const changedFileIds: ProjectFileId[] = [];
		const changedExternalInputs: ExternalProjectInputId[] = [];

		try {
			if (batch.kind === "files") {
				const normalized = normalizeFileChanges(batch.changes);
				for (const change of normalized) {
					changedFileIds.push(change.key);
					const identity = serializeProjectFileId(change.key);
					if (change.kind === "removed") {
						candidateFiles.delete(identity);
						update.removeInput(projectFileRevisionInput(change.key));
					} else {
						candidateFiles.set(identity, change.key);
						update.setInput(
							projectFileRevisionInput(change.key),
							change.fingerprint,
						);
					}
				}
			} else {
				const state = candidateExternal.get(batch.providerId);
				if (!state) {
					throw new Error(
						`Unknown external input provider: ${batch.providerId}`,
					);
				}
				for (const change of coalesceInputChanges(batch.changes)) {
					changedExternalInputs.push({
						providerId: state.input.provider.id,
						key: change.key,
					});
					if (change.kind === "removed") {
						state.fingerprints.delete(change.key);
						update.removeInput(
							externalProjectInput(
								state.input.provider.id,
								state.input.provider.version,
								change.key,
							),
						);
						continue;
					}
					state.fingerprints.set(change.key, change.fingerprint);
					update.setInput(
						externalProjectInput(
							state.input.provider.id,
							state.input.provider.version,
							change.key,
						),
						change.fingerprint,
					);
				}
			}

			const candidateSnapshot = snapshotFromState(
				graph.revision + 1,
				candidateFiles,
				candidateExternal,
			);
			const diagnostics = validateSnapshot(candidateSnapshot, validators);
			if (hasErrors(diagnostics)) {
				update.rollback();
				return {
					committed: false,
					revision: graph.revision,
					diagnostics,
				};
			}

			const revision = update.commit();
			replaceMap(filesByIdentity, candidateFiles);
			replaceMap(externalByProvider, candidateExternal);
			return {
				committed: true,
				revision,
				changedFileIds,
				changedExternalInputs,
			};
		} catch (error) {
			try {
				update.rollback();
			} catch {
				// A failed commit is already closed; candidate state remains uninstalled.
			}
			return {
				committed: false,
				revision: graph.revision,
				diagnostics: [],
				error,
			};
		}
	};

	return {
		host: input.host,
		graph,
		snapshot() {
			return snapshotFromState(
				graph.revision,
				filesByIdentity,
				externalByProvider,
			);
		},
		get(product, options = {}) {
			return graph.get(product, { ...options, revision: graph.revision });
		},
		apply,
		async *watch() {
			const watchers: AsyncIterable<ProjectChangeBatch>[] = [];
			if (input.host.watchFiles) {
				watchers.push(mapFileChanges(input.host.watchFiles()));
			}
			for (const external of input.host.externalInputs ?? []) {
				if (external.provider.watch) {
					watchers.push(
						mapExternalChanges(external.provider.id, external.provider.watch()),
					);
				}
			}
			for await (const batch of mergeAsyncIterables(watchers)) {
				yield await apply(batch);
			}
		},
	};
}

export class ProjectSessionValidationError extends Error {
	readonly diagnostics: readonly Diagnostic[];

	constructor(diagnostics: readonly Diagnostic[]) {
		super("Project session input validation failed");
		this.name = "ProjectSessionValidationError";
		this.diagnostics = diagnostics;
	}
}

export function projectFileRevisionInput(id: ProjectFileId): string {
	return `project-file:${serializeProjectFileId(id)}`;
}

export function externalProjectInput(
	providerId: string,
	providerVersion: number,
	key: string,
): string {
	return `project-external:${providerId}@${providerVersion}:${key}`;
}

function normalizeFileChanges(
	changes: readonly InputChange<ProjectFileId>[],
): readonly Exclude<InputChange<ProjectFileId>, { kind: "moved" }>[] {
	return coalesceInputChanges(
		changes.map((change) =>
			change.kind === "moved"
				? {
						...change,
						from: projectFileId(change.from),
						key: projectFileId(change.key),
					}
				: { ...change, key: projectFileId(change.key) },
		),
	) as readonly Exclude<InputChange<ProjectFileId>, { kind: "moved" }>[];
}

function snapshotFromState(
	revision: number,
	files: ReadonlyMap<string, ProjectFileId>,
	external: ReadonlyMap<string, ExternalState>,
): ProjectSnapshot {
	return Object.freeze({
		revision,
		fileIds: Object.freeze([...files.values()].sort(compareProjectFileIds)),
		externalInputs: Object.freeze(externalSnapshots(external)),
	});
}

function externalSnapshots(
	external: ReadonlyMap<string, ExternalState>,
): ExternalProjectInputSnapshot[] {
	return [...external.values()]
		.flatMap((state) =>
			[...state.fingerprints].map(([key, fingerprint]) => ({
				providerId: state.input.provider.id,
				providerVersion: state.input.provider.version,
				key,
				fingerprint,
			})),
		)
		.sort((left, right) =>
			`${left.providerId}\0${left.key}`.localeCompare(
				`${right.providerId}\0${right.key}`,
			),
		);
}

function cloneExternalState(
	state: ReadonlyMap<string, ExternalState>,
): Map<string, ExternalState> {
	return new Map(
		[...state].map(([id, value]) => [
			id,
			{ input: value.input, fingerprints: new Map(value.fingerprints) },
		]),
	);
}

function replaceMap<Key, Value>(
	target: Map<Key, Value>,
	replacement: ReadonlyMap<Key, Value>,
): void {
	target.clear();
	for (const [key, value] of replacement) target.set(key, value);
}

function validateSnapshot(
	snapshot: ProjectSnapshot,
	validators: readonly ProjectSessionValidator[],
): readonly Diagnostic[] {
	return validators.flatMap((validate) => validate(snapshot));
}

function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
	return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}

async function* mapFileChanges(
	changes: AsyncIterable<readonly InputChange<ProjectFileId>[]>,
): AsyncIterable<ProjectChangeBatch> {
	for await (const batch of changes) yield { kind: "files", changes: batch };
}

async function* mapExternalChanges(
	providerId: string,
	changes: AsyncIterable<readonly InputChange<string>[]>,
): AsyncIterable<ProjectChangeBatch> {
	for await (const batch of changes) {
		yield { kind: "external", providerId, changes: batch };
	}
}
