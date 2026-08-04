import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { fingerprintProductKey } from "../computation/canonical-key.js";
import {
	normalizeProjectPath,
	type ProjectFileId,
	projectFileId,
} from "./file-id.js";
import { defineInputProvider, type InputProvider } from "./input-provider.js";

export type ProjectFile = {
	id: ProjectFileId;
	contents: string;
};

export function createFileSystemInputProvider(options: {
	id?: string;
	root: string;
	workspace: string;
	package: string;
}): InputProvider<ProjectFileId, ProjectFile> {
	if (!options.root)
		throw new TypeError("Filesystem provider root is required");
	const configuredRoot = resolve(options.root);

	return defineInputProvider({
		id: options.id ?? "nazare.filesystem",
		version: 1,
		async read(inputId) {
			const id = projectFileId(inputId);
			if (
				id.workspace !== options.workspace ||
				id.package !== options.package
			) {
				throw new Error(
					`Project file ${id.path} does not belong to ${options.workspace}/${options.package}`,
				);
			}

			const root = await realpath(configuredRoot);
			const candidate = resolve(root, normalizeProjectPath(id.path));
			assertContained(root, candidate, id.path);
			const filePath = await realpath(candidate);
			assertContained(root, filePath, id.path);
			const contents = await readFile(filePath, "utf8");
			const value = { id, contents };
			return {
				value,
				fingerprint: fingerprintProductKey(value),
			};
		},
	});
}

function assertContained(root: string, candidate: string, path: string): void {
	const fromRoot = relative(root, candidate);
	if (
		fromRoot === "" ||
		(!fromRoot.startsWith("..") && !isAbsolute(fromRoot))
	) {
		return;
	}
	throw new Error(`Project file path escapes provider root: ${path}`);
}
