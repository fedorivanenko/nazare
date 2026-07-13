// `nazare-dev publish`: turn a component folder into a RegistryComponent and
// upload it. The honesty guard lives here (not the compiler, not the registry):
// a component's declared nazare.json dependencies must match the ../<folder>/
// imports in its source, so the published dependency graph can never drift from
// what the code actually imports. See REGISTRY.md.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	NazareManifest,
	PublishResult,
	RegistryClient,
	RegistryComponent,
} from "@nazare/core";
import { componentFolderName } from "@nazare/registry";

const MANIFEST = "nazare.json";

// The only way one component references another: `from "../<folder>/..."`,
// which covers both Liquid ({% import X from "../cn/cn.ts" %}) and TS/JS
// (import ... from "../cn/format.ts"). Same-folder ("./") imports are not deps.
const IMPORT_PATTERN = /from\s+["']\.\.\/([A-Za-z0-9._-]+)\//g;

/**
 * Reads a component folder, verifies its dependency declarations against its
 * imports, and assembles the RegistryComponent. Throws on any mismatch or a
 * missing declared file — nothing broken gets published.
 */
export async function buildRegistryComponent(
	dir: string,
): Promise<RegistryComponent> {
	const manifestRaw = await readFile(join(dir, MANIFEST), "utf8").catch(
		() => undefined,
	);
	if (manifestRaw === undefined) {
		throw new Error(`No ${MANIFEST} found in ${dir}`);
	}
	const manifest = JSON.parse(manifestRaw) as NazareManifest;
	if (!manifest.id || !manifest.version) {
		throw new Error(`${MANIFEST} must declare both "id" and "version"`);
	}

	const files: Record<string, string> = { [MANIFEST]: manifestRaw };
	for (const relativePath of manifest.files ?? []) {
		const contents = await readFile(join(dir, relativePath), "utf8").catch(
			() => undefined,
		);
		if (contents === undefined) {
			throw new Error(
				`${manifest.id}: declared file "${relativePath}" is missing from ${dir}`,
			);
		}
		files[relativePath] = contents;
	}
	if (manifest.entry && !files[manifest.entry]) {
		throw new Error(
			`${manifest.id}: entry "${manifest.entry}" is not listed in ${MANIFEST} files[]`,
		);
	}

	const dependencies = manifest.dependencies ?? {};
	verifyDependencies(manifest.id, dependencies, files);

	return { id: manifest.id, version: manifest.version, dependencies, files };
}

export async function publishComponent(
	dir: string,
	options: { client: RegistryClient; token: string },
): Promise<{ component: RegistryComponent; result: PublishResult }> {
	const component = await buildRegistryComponent(dir);
	const result = await options.client.publish(component, options.token);
	return { component, result };
}

// The honesty guard: declared dependencies and imported folders must be the
// same set. A declared dep never imported, or an import never declared, refuses
// the publish so drift is impossible.
function verifyDependencies(
	id: string,
	dependencies: Record<string, string>,
	files: Record<string, string>,
): void {
	const declaredByFolder = new Map<string, string>();
	for (const dependencyId of Object.keys(dependencies)) {
		const folder = componentFolderName(dependencyId);
		const existing = declaredByFolder.get(folder);
		if (existing) {
			throw new Error(
				`${id}: dependencies ${existing} and ${dependencyId} both install into ../${folder}/`,
			);
		}
		declaredByFolder.set(folder, dependencyId);
	}

	const imported = scanImportedFolders(files);
	const problems: string[] = [];
	for (const folder of imported) {
		if (!declaredByFolder.has(folder)) {
			problems.push(
				`imports ../${folder}/ but no dependency for it is declared in ${MANIFEST}`,
			);
		}
	}
	for (const [folder, dependencyId] of declaredByFolder) {
		if (!imported.has(folder)) {
			problems.push(
				`declares dependency ${dependencyId} but never imports ../${folder}/`,
			);
		}
	}
	if (problems.length > 0) {
		throw new Error(
			`${id}: dependency mismatch\n  - ${problems.join("\n  - ")}`,
		);
	}
}

function scanImportedFolders(files: Record<string, string>): Set<string> {
	const folders = new Set<string>();
	for (const [path, contents] of Object.entries(files)) {
		if (path === MANIFEST) continue;
		for (const match of contents.matchAll(IMPORT_PATTERN)) {
			folders.add(match[1]);
		}
	}
	return folders;
}
