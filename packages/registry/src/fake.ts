// A filesystem-backed registry: one JSON file per published version at
// <root>/<scope>/<name>/<version>.json. It honors the same contract as the
// HTTP registry, so add/update/publish are fully testable offline and the
// registry-api can be developed against the same fixtures.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	ComponentMetadata,
	PublishResult,
	RegistryClient,
	RegistryComponent,
} from "@nazare/core";
import { compareVersions, parseComponentId } from "./id.js";
import { validateBasicRegistryComponent } from "./validation.js";

export class FileSystemRegistry implements RegistryClient {
	constructor(private readonly root: string) {}

	private componentDir(id: string): string {
		const { scope, name } = parseComponentId(id);
		return join(this.root, scope, name);
	}

	async fetchMetadata(id: string): Promise<ComponentMetadata | undefined> {
		const versions = await this.listVersions(id);
		if (!versions) return undefined;
		return { id, latest: versions[versions.length - 1], versions };
	}

	async fetchComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined> {
		let resolved = version;
		if (version === "latest") {
			const metadata = await this.fetchMetadata(id);
			if (!metadata) return undefined;
			resolved = metadata.latest;
		}
		const file = join(this.componentDir(id), `${resolved}.json`);
		const raw = await readFile(file, "utf8").catch(() => undefined);
		if (raw === undefined) return undefined;
		return JSON.parse(raw) as RegistryComponent;
	}

	async publish(
		component: RegistryComponent,
		_token: string,
	): Promise<PublishResult> {
		const invalid = validateBasicRegistryComponent(component);
		if (invalid) {
			return { ok: false, code: "MALFORMED_COMPONENT", message: invalid };
		}
		const dir = this.componentDir(component.id);
		const file = join(dir, `${component.version}.json`);
		const exists = await readFile(file, "utf8").then(
			() => true,
			() => false,
		);
		if (exists) {
			return {
				ok: false,
				code: "VERSION_EXISTS",
				message: `${component.id}@${component.version} is already published`,
			};
		}
		await mkdir(dir, { recursive: true });
		await writeFile(file, `${JSON.stringify(component, null, 2)}\n`);
		return { ok: true, id: component.id, version: component.version };
	}

	private async listVersions(id: string): Promise<string[] | undefined> {
		const entries = await readdir(this.componentDir(id)).catch(() => undefined);
		if (!entries) return undefined;
		const versions = entries
			.filter((entry) => entry.endsWith(".json"))
			.map((entry) => entry.slice(0, -".json".length));
		if (versions.length === 0) return undefined;
		return versions.sort(compareVersions);
	}
}
