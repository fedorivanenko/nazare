// The reference RegistryStore: Postgres. Immutability is a DB constraint — the
// (id, version) primary key — so a concurrent duplicate publish fails
// atomically at the database, never via a read-then-write race. Works with any
// Postgres, including Neon's pooled endpoint on Vercel (DATABASE_URL). See
// migrations/001_components.sql for the schema.
import type { ComponentMetadata, RegistryComponent } from "@nazare/core";
import { compareVersions } from "@nazare/registry";
import postgres from "postgres";
import type { PutOutcome, RegistryStore } from "./store.js";

type ComponentRow = {
	id: string;
	version: string;
	dependencies: Record<string, string>;
	files: Record<string, string>;
};

export class PostgresStore implements RegistryStore {
	private readonly sql: ReturnType<typeof postgres>;

	constructor(connectionString: string) {
		this.sql = postgres(connectionString);
	}

	async getMetadata(id: string): Promise<ComponentMetadata | undefined> {
		const rows = await this.sql<{ version: string }[]>`
			select version from components where id = ${id}
		`;
		if (rows.length === 0) return undefined;
		const versions = rows.map((row) => row.version).sort(compareVersions);
		return { id, latest: versions[versions.length - 1], versions };
	}

	async getComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined> {
		const rows = await this.sql<ComponentRow[]>`
			select id, version, dependencies, files
			from components where id = ${id} and version = ${version}
		`;
		const row = rows[0];
		if (!row) return undefined;
		return {
			id: row.id,
			version: row.version,
			dependencies: row.dependencies,
			files: row.files,
		};
	}

	async putComponent(component: RegistryComponent): Promise<PutOutcome> {
		// ON CONFLICT DO NOTHING + RETURNING: a row comes back only when the
		// insert actually happened, so the (id, version) key decides created vs
		// exists atomically.
		const inserted = await this.sql`
			insert into components (id, version, dependencies, files)
			values (
				${component.id},
				${component.version},
				${this.sql.json(component.dependencies)},
				${this.sql.json(component.files)}
			)
			on conflict (id, version) do nothing
			returning id
		`;
		return inserted.length > 0 ? "created" : "exists";
	}

	async close(): Promise<void> {
		await this.sql.end();
	}
}
