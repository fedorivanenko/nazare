import {
	type ComputationGraph,
	createComputationGraph,
} from "../computation/graph.js";
import { coalesceInputChanges } from "./change-batch.js";
import {
	compareProjectFileIds,
	type ProjectFileId,
	projectFileId,
	serializeProjectFileId,
} from "./file-id.js";
import type { ProjectFile } from "./file-system-provider.js";
import type { ProjectHost } from "./host.js";
import type { InputChange } from "./input-provider.js";

export type ProjectSnapshot = {
	revision: number;
	fileIds: readonly ProjectFileId[];
};

export type ProjectSessionUpdate =
	| {
			committed: true;
			revision: number;
			changedFileIds: readonly ProjectFileId[];
	  }
	| {
			committed: false;
			revision: number;
			error: unknown;
	  };

export type ProjectSession = {
	host: ProjectHost<ProjectFileId, ProjectFile>;
	graph: ComputationGraph;
	snapshot(): ProjectSnapshot;
	apply(
		changes: readonly InputChange<ProjectFileId>[],
	): Promise<ProjectSessionUpdate>;
};

export async function createProjectSession(input: {
	host: ProjectHost<ProjectFileId, ProjectFile>;
	graph?: ComputationGraph;
}): Promise<ProjectSession> {
	const graph = input.graph ?? createComputationGraph();
	const filesByIdentity = new Map<string, ProjectFileId>();
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
	initial.commit();

	const snapshot = (): ProjectSnapshot =>
		Object.freeze({
			revision: graph.revision,
			fileIds: Object.freeze(
				[...filesByIdentity.values()].sort(compareProjectFileIds),
			),
		});

	return {
		host: input.host,
		graph,
		snapshot,
		async apply(changes) {
			const normalized = coalesceInputChanges(
				changes.map((change) => ({
					...change,
					key: projectFileId(change.key),
				})),
			);
			if (normalized.length === 0) {
				return {
					committed: true,
					revision: graph.revision,
					changedFileIds: [],
				};
			}

			const candidate = new Map(filesByIdentity);
			const update = graph.beginUpdate();
			try {
				for (const change of normalized) {
					const identity = serializeProjectFileId(change.key);
					if (change.kind === "removed") {
						candidate.delete(identity);
						update.removeInput(projectFileRevisionInput(change.key));
						continue;
					}
					candidate.set(identity, change.key);
					update.setInput(
						projectFileRevisionInput(change.key),
						change.fingerprint,
					);
				}
				const revision = update.commit();
				filesByIdentity.clear();
				for (const [identity, id] of candidate) {
					filesByIdentity.set(identity, id);
				}
				return {
					committed: true,
					revision,
					changedFileIds: normalized.map((change) => change.key),
				};
			} catch (error) {
				try {
					update.rollback();
				} catch {
					// A failed commit is already closed; candidate state remains uninstalled.
				}
				return { committed: false, revision: graph.revision, error };
			}
		},
	};
}

export function projectFileRevisionInput(id: ProjectFileId): string {
	return `project-file:${serializeProjectFileId(id)}`;
}
