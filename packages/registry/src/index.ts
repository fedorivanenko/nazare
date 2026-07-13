// @nazare/registry — the runtime implementations of the RegistryClient
// contract (the types live in @nazare/core) plus id/version helpers.

export { FileSystemRegistry } from "./fake.js";
export { HttpRegistry } from "./http.js";
export {
	type ComponentId,
	compareVersions,
	componentFolderName,
	parseComponentId,
} from "./id.js";
