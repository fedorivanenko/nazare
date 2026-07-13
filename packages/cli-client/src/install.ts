// Install orchestration for `nazare add` / `nazare update`. Given a
// RegistryClient (HTTP in production, a filesystem fake in tests), it fetches a
// component and its transitive dependencies, writes each as a sibling folder
// under the source root — so relative ../<dep>/ imports survive untouched — and
// records exact installed versions + file hashes in nazare.theme.json. All
// registry access is through the injected client; this module never touches the
// network directly.
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RegistryClient, RegistryComponent } from "@nazare/core";
import {
	componentFolderName,
	validateBasicRegistryComponent,
} from "@nazare/registry";

const THEME_MANIFEST = "nazare.theme.json";

/** add keeps an already-installed copy; update overwrites it after hash guards. */
export type InstallMode = "add" | "update";

export type InstallOptions = {
	client: RegistryClient;
	projectRoot: string;
	sourceRoot: string;
	/** Overwrite/delete local edits during update. Intended for explicit --force. */
	force?: boolean;
};

export type InstallOutcome = {
	installed: { id: string; version: string }[];
	skipped: { id: string; version: string }[];
	warnings: string[];
	written: string[];
};

export type ComponentDiffEntry = {
	path: string;
	change: "added" | "changed" | "removed" | "unchanged";
	local: "clean" | "modified" | "missing" | "untracked";
};

export type ComponentDiff = {
	id: string;
	fromVersion: string | undefined;
	toVersion: string;
	entries: ComponentDiffEntry[];
	localEdits: string[];
};

type ThemeManifest = {
	dependencies?: Record<string, string>;
	installed?: Record<string, string>;
	installedFiles?: Record<string, Record<string, string>>;
};

/**
 * Installs one component and its dependency closure. Returns what was written,
 * what was left in place (add only), and any one-copy-per-project warnings.
 */
export async function installComponent(
	id: string,
	version: string,
	mode: InstallMode,
	options: InstallOptions,
): Promise<InstallOutcome> {
	const { client, projectRoot, sourceRoot } = options;
	const manifest = await readThemeManifest(projectRoot);
	const installedRecord = { ...(manifest.installed ?? {}) };
	const installedFiles = cloneInstalledFiles(manifest.installedFiles ?? {});

	const toWrite = new Map<string, RegistryComponent>();
	const warnings: string[] = [];
	const skipped: { id: string; version: string }[] = [];

	const queue: { id: string; version: string }[] = [{ id, version }];
	while (queue.length > 0) {
		const request = queue.shift();
		if (!request) break;

		const resolved = toWrite.get(request.id);
		if (resolved) {
			// Already chosen this run: a diamond. One copy wins; note a mismatch.
			if (
				request.version !== "latest" &&
				resolved.version !== request.version
			) {
				warnings.push(
					`${request.id}: keeping ${resolved.version}; ${request.version} also requested (one copy per project)`,
				);
			}
			continue;
		}

		const component = await client.fetchComponent(request.id, request.version);
		if (!component) {
			throw new Error(
				`${request.id}@${request.version} was not found in the registry`,
			);
		}

		const invalid = validateBasicRegistryComponent(component);
		if (invalid) {
			throw new Error(
				`${request.id}@${request.version} returned an invalid registry component: ${invalid}`,
			);
		}

		const installedVersion = installedRecord[request.id];
		if (mode === "add" && installedVersion !== undefined) {
			// One copy per project: an existing install is kept, not replaced. Its
			// dependencies are already on disk, so the closure is not re-walked.
			if (installedVersion !== component.version) {
				warnings.push(
					`${request.id}: already installed at ${installedVersion}, keeping it (skipped ${component.version})`,
				);
			}
			skipped.push({ id: request.id, version: installedVersion });
			continue;
		}

		toWrite.set(request.id, component);
		for (const [depId, depVersion] of Object.entries(component.dependencies)) {
			queue.push({ id: depId, version: depVersion });
		}
	}

	assertNoFolderCollisions(installedRecord, toWrite, sourceRoot);
	await assertInstallWritesAreSafe(
		toWrite,
		installedFiles,
		options,
		options.force === true,
	);

	const written: string[] = [];
	for (const component of toWrite.values()) {
		const folder = componentFolderName(component.id);
		const nextHashes: Record<string, string> = {};
		for (const relativePath of staleInstalledPaths(component, installedFiles)) {
			await rm(join(projectRoot, sourceRoot, folder, relativePath), {
				force: true,
			});
		}
		for (const [relativePath, contents] of Object.entries(component.files)) {
			const outputPath = join(projectRoot, sourceRoot, folder, relativePath);
			await mkdir(dirname(outputPath), { recursive: true });
			await writeFile(outputPath, contents);
			written.push(join(sourceRoot, folder, relativePath));
			nextHashes[relativePath] = sha256(contents);
		}
		installedRecord[component.id] = component.version;
		installedFiles[component.id] = sortRecord(nextHashes);
	}

	await writeThemeManifest(projectRoot, {
		...manifest,
		installed: sortRecord(installedRecord),
		installedFiles: sortInstalledFiles(installedFiles),
	});

	return {
		installed: [...toWrite.values()].map((component) => ({
			id: component.id,
			version: component.version,
		})),
		skipped,
		warnings,
		written: written.sort(),
	};
}

/** Updates every installed component to its latest published version. */
export async function updateAll(
	options: InstallOptions,
): Promise<InstallOutcome> {
	const manifest = await readThemeManifest(options.projectRoot);
	const ids = Object.keys(manifest.installed ?? {});
	const merged: InstallOutcome = {
		installed: [],
		skipped: [],
		warnings: [],
		written: [],
	};
	for (const id of ids) {
		const outcome = await installComponent(id, "latest", "update", options);
		merged.installed.push(...outcome.installed);
		merged.skipped.push(...outcome.skipped);
		merged.warnings.push(...outcome.warnings);
		merged.written.push(...outcome.written);
	}
	return merged;
}

export async function diffComponent(
	id: string,
	version: string,
	options: InstallOptions,
): Promise<ComponentDiff> {
	const manifest = await readThemeManifest(options.projectRoot);
	const component = await options.client.fetchComponent(id, version);
	if (!component)
		throw new Error(`${id}@${version} was not found in the registry`);
	const invalid = validateBasicRegistryComponent(component);
	if (invalid) {
		throw new Error(
			`${id}@${version} returned an invalid registry component: ${invalid}`,
		);
	}

	const previous = manifest.installedFiles?.[id] ?? {};
	const folder = componentFolderName(id);
	const entries: ComponentDiffEntry[] = [];
	const allPaths = new Set([
		...Object.keys(previous),
		...Object.keys(component.files),
	]);
	for (const path of [...allPaths].sort()) {
		const nextHash =
			component.files[path] === undefined
				? undefined
				: sha256(component.files[path]);
		const previousHash = previous[path];
		const diskHash = await fileHash(
			join(options.projectRoot, options.sourceRoot, folder, path),
		);
		entries.push({
			path,
			change: diffChange(previousHash, nextHash),
			local: localState(previousHash, diskHash),
		});
	}
	return {
		id,
		fromVersion: manifest.installed?.[id],
		toVersion: component.version,
		entries,
		localEdits: entries
			.filter(
				(entry) => entry.local === "modified" || entry.local === "untracked",
			)
			.map((entry) => entry.path),
	};
}

function diffChange(
	previousHash: string | undefined,
	nextHash: string | undefined,
): ComponentDiffEntry["change"] {
	if (previousHash === undefined && nextHash !== undefined) return "added";
	if (previousHash !== undefined && nextHash === undefined) return "removed";
	if (previousHash === nextHash) return "unchanged";
	return "changed";
}

function localState(
	previousHash: string | undefined,
	diskHash: string | undefined,
): ComponentDiffEntry["local"] {
	if (diskHash === undefined) return "missing";
	if (previousHash === undefined) return "untracked";
	return diskHash === previousHash ? "clean" : "modified";
}

async function assertInstallWritesAreSafe(
	toWrite: Map<string, RegistryComponent>,
	installedFiles: Record<string, Record<string, string>>,
	options: InstallOptions,
	force: boolean,
): Promise<void> {
	if (force) return;
	const errors: string[] = [];
	for (const component of toWrite.values()) {
		const folder = componentFolderName(component.id);
		const previous = installedFiles[component.id] ?? {};
		for (const [relativePath, contents] of Object.entries(component.files)) {
			const full = join(
				options.projectRoot,
				options.sourceRoot,
				folder,
				relativePath,
			);
			const diskHash = await fileHash(full);
			const previousHash = previous[relativePath];
			if (diskHash === undefined) continue;
			if (previousHash === undefined) {
				errors.push(
					`${join(options.sourceRoot, folder, relativePath)} exists but is not tracked by Nazare; refusing to overwrite`,
				);
				continue;
			}
			if (diskHash !== previousHash) {
				errors.push(
					`${join(options.sourceRoot, folder, relativePath)} has local edits; refusing to overwrite`,
				);
				continue;
			}
			void contents;
		}
		for (const relativePath of staleInstalledPaths(component, installedFiles)) {
			const full = join(
				options.projectRoot,
				options.sourceRoot,
				folder,
				relativePath,
			);
			const diskHash = await fileHash(full);
			if (diskHash !== undefined && diskHash !== previous[relativePath]) {
				errors.push(
					`${join(options.sourceRoot, folder, relativePath)} has local edits; refusing to delete`,
				);
			}
		}
	}
	if (errors.length > 0) {
		throw new Error(
			`Refuse update: local registry component edits detected.\n${errors.join("\n")}\nUse \`nazare diff @scope/name\` to inspect or \`nazare update --force @scope/name\` to overwrite.`,
		);
	}
}

function staleInstalledPaths(
	component: RegistryComponent,
	installedFiles: Record<string, Record<string, string>>,
): string[] {
	const next = new Set(Object.keys(component.files));
	return Object.keys(installedFiles[component.id] ?? {}).filter(
		(path) => !next.has(path),
	);
}

// A component installs into <sourceRoot>/<last-id-segment>/, so two ids that
// differ only in scope would land in the same folder. v1 is flat-by-name and
// cannot represent that; it is a hard error, caught before any file is written.
function assertNoFolderCollisions(
	installedRecord: Record<string, string>,
	toWrite: Map<string, RegistryComponent>,
	sourceRoot: string,
): void {
	const ownerByFolder = new Map<string, string>();
	for (const existingId of Object.keys(installedRecord)) {
		ownerByFolder.set(componentFolderName(existingId), existingId);
	}
	for (const component of toWrite.values()) {
		const folder = componentFolderName(component.id);
		const owner = ownerByFolder.get(folder);
		if (owner && owner !== component.id) {
			throw new Error(
				`Folder name collision: ${component.id} and ${owner} both install into ${sourceRoot}/${folder}`,
			);
		}
		ownerByFolder.set(folder, component.id);
	}
}

async function readThemeManifest(projectRoot: string): Promise<ThemeManifest> {
	const raw = await readFile(join(projectRoot, THEME_MANIFEST), "utf8").catch(
		() => undefined,
	);
	if (raw === undefined) return {};
	return JSON.parse(raw) as ThemeManifest;
}

async function writeThemeManifest(
	projectRoot: string,
	manifest: ThemeManifest,
): Promise<void> {
	await writeFile(
		join(projectRoot, THEME_MANIFEST),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
}

async function fileHash(path: string): Promise<string | undefined> {
	const contents = await readFile(path, "utf8").catch(() => undefined);
	return contents === undefined ? undefined : sha256(contents);
}

function sha256(contents: string): string {
	return `sha256-${createHash("sha256").update(contents).digest("hex")}`;
}

function cloneInstalledFiles(
	record: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
	const cloned: Record<string, Record<string, string>> = {};
	for (const [id, files] of Object.entries(record)) cloned[id] = { ...files };
	return cloned;
}

function sortInstalledFiles(
	record: Record<string, Record<string, string>>,
): Record<string, Record<string, string>> {
	const sorted: Record<string, Record<string, string>> = {};
	for (const id of Object.keys(record).sort()) {
		sorted[id] = sortRecord(record[id]);
	}
	return sorted;
}

function sortRecord(record: Record<string, string>): Record<string, string> {
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(record).sort()) {
		sorted[key] = record[key];
	}
	return sorted;
}
