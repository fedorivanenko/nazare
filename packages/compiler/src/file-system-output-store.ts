import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
	type AtomicOutputCommit,
	type AtomicOutputStore,
	type ExistingOutputState,
	hashOutput,
	OUTPUT_OWNERSHIP_MANIFEST_PATH,
	type OutputOwnershipManifest,
} from "./output-transaction.js";

export async function readExistingOutputState(
	outputRoot: string,
): Promise<ExistingOutputState> {
	const manifest = await readOwnershipManifest(outputRoot);
	const hashes: Record<string, string> = {};
	async function walk(
		directory: string,
		relativeDirectory: string,
	): Promise<void> {
		const entries = await readdir(directory, { withFileTypes: true }).catch(
			(error: unknown) => {
				if (isMissing(error)) return [];
				throw error;
			},
		);
		for (const entry of entries) {
			const path = relativeDirectory
				? `${relativeDirectory}/${entry.name}`
				: entry.name;
			const absolutePath = join(directory, entry.name);
			if (entry.isDirectory()) await walk(absolutePath, path);
			else if (entry.isFile() && path !== OUTPUT_OWNERSHIP_MANIFEST_PATH) {
				hashes[path] = hashOutput(await readFile(absolutePath, "utf8"));
			}
		}
	}
	await walk(outputRoot, "");
	return { hashes, ownership: manifest };
}

async function readOwnershipManifest(
	outputRoot: string,
): Promise<OutputOwnershipManifest> {
	try {
		const parsed = JSON.parse(
			await readFile(join(outputRoot, OUTPUT_OWNERSHIP_MANIFEST_PATH), "utf8"),
		) as Partial<OutputOwnershipManifest>;
		if (
			parsed.version === 1 &&
			parsed.files &&
			typeof parsed.files === "object"
		) {
			return { version: 1, files: parsed.files };
		}
	} catch (error) {
		if (!isMissing(error) && !(error instanceof SyntaxError)) throw error;
	}
	return { version: 1, files: {} };
}

/**
 * Filesystem transaction using same-filesystem staging plus rollback backups.
 * Only paths named by OwnedOutputPlan can be replaced or deleted.
 */
export class FileSystemAtomicOutputStore implements AtomicOutputStore {
	readonly outputRoot: string;

	constructor(outputRoot: string) {
		this.outputRoot = outputRoot;
	}

	async atomicCommit(commit: AtomicOutputCommit): Promise<boolean> {
		const parent = dirname(this.outputRoot);
		await mkdir(parent, { recursive: true });
		const transactionRoot = await mkdtemp(
			join(parent, `.nazare-${basename(this.outputRoot)}-`),
		);
		const stagedRoot = join(transactionRoot, "staged");
		const backupRoot = join(transactionRoot, "backup");
		const affectedPaths = [
			...new Set([
				...commit.plan.deletes,
				...commit.plan.writes.map((file) => file.path),
			]),
		].sort();
		const backedUp: string[] = [];
		const published: string[] = [];
		try {
			for (const file of commit.plan.writes) {
				const stagedPath = join(stagedRoot, file.path);
				await mkdir(dirname(stagedPath), { recursive: true });
				await writeFile(stagedPath, file.contents);
			}
			if (!commit.isCurrentRevision()) return false;

			await mkdir(this.outputRoot, { recursive: true });
			for (const path of affectedPaths) {
				await assertSafeOutputPath(this.outputRoot, path);
			}
			for (const path of affectedPaths) {
				const destination = join(this.outputRoot, path);
				const status = await optionalStatus(destination);
				if (!status) continue;
				if (!status.isFile()) {
					throw new Error(`Output path is not a regular file: ${path}`);
				}
				const backup = join(backupRoot, path);
				await mkdir(dirname(backup), { recursive: true });
				await rename(destination, backup);
				backedUp.push(path);
			}
			for (const file of commit.plan.writes) {
				const destination = join(this.outputRoot, file.path);
				await mkdir(dirname(destination), { recursive: true });
				await rename(join(stagedRoot, file.path), destination);
				published.push(file.path);
			}
			return true;
		} catch (error) {
			await rollback({
				outputRoot: this.outputRoot,
				backupRoot,
				published,
				backedUp,
			});
			throw error;
		} finally {
			await rm(transactionRoot, { recursive: true, force: true });
		}
	}
}

async function rollback(input: {
	outputRoot: string;
	backupRoot: string;
	published: readonly string[];
	backedUp: readonly string[];
}): Promise<void> {
	for (const path of [...input.published].reverse()) {
		await rm(join(input.outputRoot, path), { recursive: true, force: true });
	}
	for (const path of [...input.backedUp].reverse()) {
		const destination = join(input.outputRoot, path);
		await mkdir(dirname(destination), { recursive: true });
		await rename(join(input.backupRoot, path), destination);
	}
}

async function assertSafeOutputPath(root: string, path: string): Promise<void> {
	const rootStatus = await optionalStatus(root);
	if (rootStatus?.isSymbolicLink()) {
		throw new Error(`Output root is a symbolic link: ${root}`);
	}
	const segments = path.split("/");
	let current = root;
	for (const segment of segments) {
		current = join(current, segment);
		const status = await optionalStatus(current);
		if (status?.isSymbolicLink()) {
			throw new Error(`Output path traverses a symbolic link: ${path}`);
		}
	}
}

function isMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function optionalStatus(
	path: string,
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		)
			return undefined;
		throw error;
	}
}
