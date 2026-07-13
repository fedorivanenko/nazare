// The production registry: HTTP against the three routes in REGISTRY.md. A
// clean 404 becomes undefined; any other non-2xx throws so transport failures
// are never mistaken for absence.
import type {
	ComponentMetadata,
	PublishResult,
	RegistryClient,
	RegistryComponent,
	RegistryErrorCode,
} from "@nazare/core";
import { parseComponentId } from "./id.js";

type RegistryErrorBody = { error?: { code?: string; message?: string } };

export class HttpRegistry implements RegistryClient {
	private readonly base: string;

	constructor(baseUrl: string) {
		this.base = baseUrl.replace(/\/$/, "");
	}

	private path(id: string, version?: string): string {
		const { scope, name } = parseComponentId(id);
		const base = `${this.base}/components/${scope}/${name}`;
		return version ? `${base}/${version}` : base;
	}

	async fetchMetadata(id: string): Promise<ComponentMetadata | undefined> {
		const response = await fetch(this.path(id));
		if (response.status === 404) return undefined;
		await assertOk(response, id);
		return (await response.json()) as ComponentMetadata;
	}

	async fetchComponent(
		id: string,
		version: string,
	): Promise<RegistryComponent | undefined> {
		const response = await fetch(this.path(id, version));
		if (response.status === 404) return undefined;
		await assertOk(response, `${id}@${version}`);
		return (await response.json()) as RegistryComponent;
	}

	async publish(
		component: RegistryComponent,
		token: string,
	): Promise<PublishResult> {
		const response = await fetch(this.path(component.id, component.version), {
			method: "PUT",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${token}`,
			},
			body: JSON.stringify(component),
		});
		if (response.ok) {
			return { ok: true, id: component.id, version: component.version };
		}
		const body = (await response.json().catch(() => undefined)) as
			| RegistryErrorBody
			| undefined;
		return {
			ok: false,
			code: (body?.error?.code as RegistryErrorCode) ?? "MALFORMED_COMPONENT",
			message: body?.error?.message ?? response.statusText,
		};
	}
}

async function assertOk(response: Response, target: string): Promise<void> {
	if (response.ok) return;
	const body = (await response.json().catch(() => undefined)) as
		| RegistryErrorBody
		| undefined;
	const detail = body?.error?.message ?? response.statusText;
	throw new Error(`Registry request for ${target} failed: ${detail}`);
}
