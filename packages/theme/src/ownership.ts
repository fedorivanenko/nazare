import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const OUTPUT_OWNERSHIP_MANIFEST = ".nazare/build-manifest.json";

export type OutputOwnershipEntry = { hash: string; source: string };
export type OutputOwnershipManifest = {
	version: 1;
	files: Record<string, OutputOwnershipEntry>;
};

export async function readOutputOwnershipManifest(
	outputRoot: string,
): Promise<OutputOwnershipManifest> {
	const raw = await readFile(
		join(outputRoot, OUTPUT_OWNERSHIP_MANIFEST),
		"utf8",
	).catch(() => undefined);
	if (raw !== undefined) {
		try {
			const parsed = JSON.parse(raw) as Partial<OutputOwnershipManifest>;
			if (
				parsed.version === 1 &&
				parsed.files &&
				typeof parsed.files === "object"
			) {
				return { version: 1, files: parsed.files };
			}
		} catch {
			// malformed manifest means nothing is trusted as owned
		}
	}
	return { version: 1, files: {} };
}

export async function writeOutputOwnershipManifest(
	outputRoot: string,
	manifest: OutputOwnershipManifest,
): Promise<void> {
	const path = join(outputRoot, OUTPUT_OWNERSHIP_MANIFEST);
	await mkdir(dirname(path), { recursive: true });
	await writeFile(
		path,
		`${JSON.stringify(sortOwnershipManifest(manifest), null, 2)}\n`,
	);
}

function sortOwnershipManifest(
	manifest: OutputOwnershipManifest,
): OutputOwnershipManifest {
	const files: Record<string, OutputOwnershipEntry> = {};
	for (const key of Object.keys(manifest.files).sort()) {
		files[key] = manifest.files[key];
	}
	return { version: manifest.version, files };
}

export async function readOutputFileHashes(
	outputRoot: string,
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const walk = async (dir: string, base: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const dirent of entries) {
			const full = join(dir, dirent.name);
			const rel = base ? `${base}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				await walk(full, rel);
			} else if (dirent.isFile() && rel !== OUTPUT_OWNERSHIP_MANIFEST) {
				found.set(rel, sha256(await readFile(full, "utf8")));
			}
		}
	};
	await walk(outputRoot, "");
	return found;
}

export function checkOutputOwnership(
	planned: Map<string, { from: string }>,
	existing: Map<string, string>,
	manifest: OutputOwnershipManifest,
	isGeneratedOwnedPath: (path: string) => boolean,
): { conflicts: string[]; staleOwned: string[] } {
	const conflicts: string[] = [];
	const staleOwned: string[] = [];
	for (const [path, plannedFile] of planned) {
		if (!isGeneratedOwnedPath(path) || !existing.has(path)) continue;
		const owned = manifest.files[path];
		if (!owned) {
			conflicts.push(
				`${path}: exists in output but is not owned by Nazare; refusing to overwrite with ${plannedFile.from}`,
			);
			continue;
		}
		if (existing.get(path) !== owned.hash) {
			conflicts.push(
				`${path}: owned by Nazare but modified in output; refusing to overwrite`,
			);
		}
	}

	for (const [path, owned] of Object.entries(manifest.files)) {
		if (
			!isGeneratedOwnedPath(path) ||
			planned.has(path) ||
			!existing.has(path)
		) {
			continue;
		}
		if (existing.get(path) !== owned.hash) {
			conflicts.push(
				`${path}: stale Nazare-owned file was modified in output; refusing to delete`,
			);
			continue;
		}
		staleOwned.push(path);
	}
	return { conflicts, staleOwned };
}

export function sha256(contents: string): string {
	return `sha256-${createHash("sha256").update(contents).digest("hex")}`;
}
