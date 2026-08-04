export { coalesceInputChanges } from "./change-batch.js";
export {
	compareProjectFileIds,
	normalizeProjectPath,
	type ProjectFileId,
	projectFileId,
	sameProjectFileId,
	serializeProjectFileId,
} from "./file-id.js";
export {
	createFileSystemProjectHost,
	diffProjectFileSnapshots,
	discoverProjectFiles,
	type ProjectFileFingerprint,
} from "./file-system-host.js";
export {
	createFileSystemInputProvider,
	type ProjectFile,
} from "./file-system-provider.js";
export { defineProjectHost, type ProjectHost } from "./host.js";
export {
	defineInputProvider,
	type InputChange,
	type InputProvider,
	type InputSnapshot,
} from "./input-provider.js";
export {
	createProjectSession,
	type ProjectSession,
	type ProjectSessionUpdate,
	type ProjectSnapshot,
	projectFileRevisionInput,
} from "./session.js";
