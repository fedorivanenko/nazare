// The server's storage seam. The handler depends only on this interface, so
// the backend stays the deployer's choice (REGISTRY.md). The reference backend
// is Postgres; the filesystem is deliberately NOT a server backend — a folder
// has no atomic check-and-write, so the immutability guarantee would race under
// concurrent publishes. (The client-side `file:` registry is a separate thing:
// a user's local folder, not a server.)
//
// InMemoryStore here is for tests only — it exercises the handler without a
// database, and is never wired into the running server.
import type { ComponentMetadata, RegistryComponent } from "@nazare/core";
import { compareVersions } from "@nazare/registry";

export type PutOutcome = "created" | "exists";

export type RegistryStore = {
	getMetadata(id: string): Promise<ComponentMetadata | undefined>;
	/** Exact version only; "latest" resolution is the handler's job. */
	getComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined>;
	/** Immutable: an existing (id, version) yields "exists", never an overwrite. */
	putComponent(component: RegistryComponent): Promise<PutOutcome>;
};

export class InMemoryStore implements RegistryStore {
	private readonly byKey = new Map<string, RegistryComponent>();
	private readonly versionsById = new Map<string, Set<string>>();

	private static key(id: string, version: string): string {
		return `${id}@${version}`;
	}

	async getMetadata(id: string): Promise<ComponentMetadata | undefined> {
		const versions = this.versionsById.get(id);
		if (!versions || versions.size === 0) return undefined;
		const sorted = [...versions].sort(compareVersions);
		return { id, latest: sorted[sorted.length - 1], versions: sorted };
	}

	async getComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined> {
		return this.byKey.get(InMemoryStore.key(id, version));
	}

	async putComponent(component: RegistryComponent): Promise<PutOutcome> {
		const key = InMemoryStore.key(component.id, component.version);
		if (this.byKey.has(key)) return "exists";
		this.byKey.set(key, component);
		const versions = this.versionsById.get(component.id) ?? new Set<string>();
		versions.add(component.version);
		this.versionsById.set(component.id, versions);
		return "created";
	}
}
