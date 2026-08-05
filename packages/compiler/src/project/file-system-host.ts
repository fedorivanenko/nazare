import { watch as watchFileSystem } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { type ProjectFileId, projectFileId } from "./file-id.js";
import {
	createFileSystemInputProvider,
	type ProjectFile,
} from "./file-system-provider.js";
import { defineProjectHost, type ProjectHost } from "./host.js";
import type { InputChange, InputSnapshot } from "./input-provider.js";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
	".git",
	".nazare-out",
	"dist",
	"node_modules",
]);

export type ProjectFileFingerprint = {
	id: ProjectFileId;
	fingerprint: string;
};

export function createFileSystemProjectHost(options: {
	root: string;
	workspace: string;
	package: string;
	ignoredDirectories?: readonly string[];
	watchDebounceMs?: number;
}): ProjectHost<ProjectFileId, ProjectFile> {
	const root = resolve(options.root);
	const ignored = new Set([
		...DEFAULT_IGNORED_DIRECTORIES,
		...(options.ignoredDirectories ?? []),
	]);
	const files = createFileSystemInputProvider({
		root,
		workspace: options.workspace,
		package: options.package,
	});
	const discover = (): Promise<readonly ProjectFileId[]> =>
		discoverProjectFiles({
			root,
			workspace: options.workspace,
			package: options.package,
			ignoredDirectories: ignored,
		});

	return defineProjectHost({
		files,
		discover,
		watchFiles() {
			return watchProjectFiles({
				root,
				files,
				discover,
				debounceMs: options.watchDebounceMs ?? 30,
			});
		},
	});
}

export async function discoverProjectFiles(options: {
	root: string;
	workspace: string;
	package: string;
	ignoredDirectories?: ReadonlySet<string>;
}): Promise<readonly ProjectFileId[]> {
	const discovered: ProjectFileId[] = [];
	const ignored = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;

	const visit = async (
		directory: string,
		projectDirectory: string,
	): Promise<void> => {
		const entries = await readdir(directory, { withFileTypes: true });
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const projectPath = projectDirectory
				? `${projectDirectory}/${entry.name}`
				: entry.name;
			if (entry.isDirectory()) {
				if (ignored.has(entry.name)) continue;
				await visit(join(directory, entry.name), projectPath);
				continue;
			}
			// Symlinks are intentionally excluded from discovery. Explicit reads still
			// permit contained file symlinks while rejecting escapes.
			if (!entry.isFile()) continue;
			discovered.push(
				projectFileId({
					workspace: options.workspace,
					package: options.package,
					path: projectPath,
				}),
			);
		}
	};

	await visit(resolve(options.root), "");
	return discovered;
}

export function diffProjectFileSnapshots(
	previous: readonly ProjectFileFingerprint[],
	current: readonly ProjectFileFingerprint[],
): readonly InputChange<ProjectFileId>[] {
	const previousByPath = new Map(previous.map((file) => [file.id.path, file]));
	const currentByPath = new Map(current.map((file) => [file.id.path, file]));
	const removed = previous.filter((file) => !currentByPath.has(file.id.path));
	const added = current.filter((file) => !previousByPath.has(file.id.path));
	const changes: InputChange<ProjectFileId>[] = [];

	const removedByFingerprint = groupByFingerprint(removed);
	const addedByFingerprint = groupByFingerprint(added);
	const movedFrom = new Set<string>();
	const movedTo = new Set<string>();
	for (const [fingerprint, removedFiles] of removedByFingerprint) {
		const addedFiles = addedByFingerprint.get(fingerprint);
		if (removedFiles.length !== 1 || addedFiles?.length !== 1) continue;
		const [from] = removedFiles;
		const [to] = addedFiles;
		movedFrom.add(from.id.path);
		movedTo.add(to.id.path);
		changes.push({ kind: "moved", from: from.id, key: to.id, fingerprint });
	}

	for (const file of removed) {
		if (!movedFrom.has(file.id.path))
			changes.push({ kind: "removed", key: file.id });
	}
	for (const file of added) {
		if (!movedTo.has(file.id.path)) {
			changes.push({
				kind: "added",
				key: file.id,
				fingerprint: file.fingerprint,
			});
		}
	}
	for (const file of current) {
		const old = previousByPath.get(file.id.path);
		if (old && old.fingerprint !== file.fingerprint) {
			changes.push({
				kind: "changed",
				key: file.id,
				fingerprint: file.fingerprint,
			});
		}
	}

	return changes.sort((left, right) =>
		changePath(left).localeCompare(changePath(right)),
	);
}

function watchProjectFiles(options: {
	root: string;
	files: ProjectHost<ProjectFileId, ProjectFile>["files"];
	discover(): Promise<readonly ProjectFileId[]>;
	debounceMs: number;
}): AsyncIterable<readonly InputChange<ProjectFileId>[]> {
	return {
		[Symbol.asyncIterator]() {
			let previous = options
				.discover()
				.then((ids) => fingerprintDiscoveredFiles(options.files, ids));
			const queue = createAsyncSignalQueue();
			let timer: ReturnType<typeof setTimeout> | undefined;
			let closed = false;
			const watcher = watchFileSystem(options.root, { recursive: true }, () => {
				if (timer) clearTimeout(timer);
				timer = setTimeout(() => queue.push(), options.debounceMs);
			});
			watcher.on("error", (error) => queue.fail(error));
			const close = (): void => {
				if (closed) return;
				closed = true;
				if (timer) clearTimeout(timer);
				watcher.close();
			};
			return {
				async next(): Promise<
					IteratorResult<readonly InputChange<ProjectFileId>[]>
				> {
					while (!closed) {
						if (!(await queue.next(100))) continue;
						if (closed) break;
						const current = await fingerprintDiscoveredFiles(
							options.files,
							await options.discover(),
						);
						const changes = diffProjectFileSnapshots(await previous, current);
						previous = Promise.resolve(current);
						if (changes.length > 0) return { done: false, value: changes };
					}
					return { done: true, value: undefined };
				},
				return(): Promise<
					IteratorResult<readonly InputChange<ProjectFileId>[]>
				> {
					close();
					return Promise.resolve({ done: true, value: undefined });
				},
			};
		},
	};
}

async function fingerprintDiscoveredFiles(
	provider: ProjectHost<ProjectFileId, ProjectFile>["files"],
	ids: readonly ProjectFileId[],
): Promise<readonly ProjectFileFingerprint[]> {
	return Promise.all(
		ids.map(async (id) => {
			const snapshot: InputSnapshot<ProjectFile> = await provider.read(id);
			return { id, fingerprint: snapshot.fingerprint };
		}),
	);
}

function groupByFingerprint(
	files: readonly ProjectFileFingerprint[],
): Map<string, ProjectFileFingerprint[]> {
	const grouped = new Map<string, ProjectFileFingerprint[]>();
	for (const file of files) {
		const group = grouped.get(file.fingerprint) ?? [];
		group.push(file);
		grouped.set(file.fingerprint, group);
	}
	return grouped;
}

function changePath(change: InputChange<ProjectFileId>): string {
	return change.kind === "moved"
		? `${change.from.path}\0${change.key.path}`
		: change.key.path;
}

function createAsyncSignalQueue(): {
	push(): void;
	fail(error: unknown): void;
	next(timeoutMs: number): Promise<boolean>;
} {
	let queued = 0;
	const readers: Array<{
		resolve(value: boolean): void;
		reject(error: unknown): void;
	}> = [];
	let failure: unknown;

	return {
		push() {
			const reader = readers.shift();
			if (reader) reader.resolve(true);
			else queued++;
		},
		fail(error) {
			failure = error;
			for (const reader of readers.splice(0)) reader.reject(error);
		},
		async next(timeoutMs) {
			if (failure) throw failure;
			if (queued > 0) {
				queued--;
				return true;
			}
			return new Promise<boolean>((resolve, reject) => {
				const reader = { resolve, reject };
				readers.push(reader);
				const timeout = setTimeout(() => {
					const index = readers.indexOf(reader);
					if (index >= 0) readers.splice(index, 1);
					resolve(false);
				}, timeoutMs);
				reader.resolve = (value) => {
					clearTimeout(timeout);
					resolve(value);
				};
				reader.reject = (error) => {
					clearTimeout(timeout);
					reject(error);
				};
			});
		},
	};
}
