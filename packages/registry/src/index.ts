// @nazare/registry — registry wire contracts and runtime implementations.

export type {
	ComponentMetadata,
	PublishResult,
	RegistryClient,
	RegistryComponent,
	RegistryErrorCode,
} from "./contracts.js";
export { registryFromEnv } from "./env.js";
export { FileSystemRegistry } from "./fake.js";
export { HttpRegistry } from "./http.js";
export {
	type ComponentId,
	compareVersions,
	componentFolderName,
	parseComponentId,
} from "./id.js";
export {
	isSafeRelativePath,
	isValidVersion,
	VERSION_PATTERN,
	validateBasicRegistryComponent,
} from "./validation.js";
