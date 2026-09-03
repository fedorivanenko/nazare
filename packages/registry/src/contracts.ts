/** Published component metadata and files transported by registry implementations. */
export type RegistryComponent = {
	id: string;
	version: string;
	dependencies: Record<string, string>;
	files: Record<string, string>;
};

/** Registry metadata without component file contents. */
export type ComponentMetadata = {
	id: string;
	latest: string;
	versions: string[];
};

export type RegistryErrorCode =
	| "COMPONENT_NOT_FOUND"
	| "VERSION_NOT_FOUND"
	| "VERSION_EXISTS"
	| "UNAUTHORIZED"
	| "MALFORMED_COMPONENT";

export type PublishResult =
	| { ok: true; id: string; version: string }
	| { ok: false; code: RegistryErrorCode; message: string };

export type RegistryClient = {
	fetchMetadata(id: string): Promise<ComponentMetadata | undefined>;
	fetchComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined>;
	publish(component: RegistryComponent, token: string): Promise<PublishResult>;
};
