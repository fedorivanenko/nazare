// The registry wire contract — the vocabulary shared by the CLI and the
// registry-api. Types only;
// the HTTP and filesystem implementations live in @nazare/registry. See
// REGISTRY.md for the full contract.

/** A published component: metadata plus every file's contents inline. */
export type RegistryComponent = {
	id: string;
	version: string;
	dependencies: Record<string, string>;
	/** Folder-relative path -> file contents, the whole folder verbatim. */
	files: Record<string, string>;
};

/** What a registry knows about one component id, without file contents. */
export type ComponentMetadata = {
	id: string;
	/** Highest published version by semver order. */
	latest: string;
	/** All published versions, ascending. */
	versions: string[];
};

export type RegistryErrorCode =
	| "COMPONENT_NOT_FOUND"
	| "VERSION_NOT_FOUND"
	| "VERSION_EXISTS"
	| "UNAUTHORIZED"
	| "MALFORMED_COMPONENT";

/** The outcome of a publish attempt. */
export type PublishResult =
	| { ok: true; id: string; version: string }
	| { ok: false; code: RegistryErrorCode; message: string };

/**
 * A client's only contact with a registry — HTTP in production, a filesystem
 * fake in tests. The fetch methods return undefined for a clean not-found so
 * callers can tell absence from a transport failure (which throws).
 */
export type RegistryClient = {
	fetchMetadata(id: string): Promise<ComponentMetadata | undefined>;
	fetchComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined>;
	publish(component: RegistryComponent, token: string): Promise<PublishResult>;
};
