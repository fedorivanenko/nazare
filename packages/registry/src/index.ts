// @nazare/registry — the runtime implementations of the RegistryClient
// contract (the types live in @nazare/core) plus id/version helpers.

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
