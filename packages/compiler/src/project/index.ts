export {
	type CoalescedInputChange,
	coalesceInputChanges,
} from "./change-batch.js";
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
export {
	defineProjectHost,
	type ExternalProjectInputProvider,
	type ProjectHost,
} from "./host.js";
export {
	defineInputProvider,
	type InputChange,
	type InputProvider,
	type InputSnapshot,
} from "./input-provider.js";
export { mergeAsyncIterables } from "./merged-watcher.js";
export {
	createProjectMetadataInputProvider,
	PROJECT_METADATA_KEYS,
	type ProjectMetadataInputProvider,
	type ProjectMetadataInputs,
	type ProjectMetadataKey,
} from "./metadata-input-provider.js";
export {
	createProjectSession,
	type ExternalProjectInputId,
	type ExternalProjectInputSnapshot,
	externalProjectInput,
	type ProjectChangeBatch,
	type ProjectSession,
	type ProjectSessionUpdate,
	ProjectSessionValidationError,
	type ProjectSessionValidator,
	type ProjectSnapshot,
	projectFileCatalogFingerprint,
	projectFileCatalogInput,
	projectFileRevisionInput,
} from "./session.js";
