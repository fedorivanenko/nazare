// Install orchestration for `nazare add` / `nazare update`. Given a
// RegistryClient (HTTP in production, a filesystem fake in tests), it fetches a
// component and its transitive dependencies, writes each as a sibling folder
// under the source root — so relative ../<dep>/ imports survive untouched — and
// records exact installed versions in nazare.theme.json. All registry access is
// through the injected client; this module never touches the network.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RegistryClient, RegistryComponent } from "@nazare/core";
import {
	componentFolderName,
	validateBasicRegistryComponent,
} from "@nazare/registry";

const THEME_MANIFEST = "nazare.theme.json";

/** add keeps an already-installed copy; update overwrites it. */
export type InstallMode = "add" | "update";

export type InstallOptions = {
	client: RegistryClient;
	projectRoot: string;
	sourceRoot: string;
};

export type InstallOutcome = {
	installed: { id: string; version: string }[];
	skipped: { id: string; version: string }[];
	warnings: string[];
	written: string[];
};

type ThemeManifest = {
	dependencies?: Record<string, string>;
	installed?: Record<string, string>;
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

	const written: string[] = [];
	for (const component of toWrite.values()) {
		const folder = componentFolderName(component.id);
		for (const [relativePath, contents] of Object.entries(component.files)) {
			const outputPath = join(projectRoot, sourceRoot, folder, relativePath);
			await mkdir(dirname(outputPath), { recursive: true });
			await writeFile(outputPath, contents);
			written.push(join(sourceRoot, folder, relativePath));
		}
		installedRecord[component.id] = component.version;
	}

	await writeThemeManifest(projectRoot, {
		...manifest,
		installed: sortRecord(installedRecord),
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

function sortRecord(record: Record<string, string>): Record<string, string> {
	const sorted: Record<string, string> = {};
	for (const key of Object.keys(record).sort()) {
		sorted[key] = record[key];
	}
	return sorted;
}
