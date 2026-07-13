// Selects a registry from NAZARE_REGISTRY.
// The tooling bakes in no default: the variable must be set, so the choice of
// registry is always explicit and never a silent fallback to a blessed host.
// See REGISTRY.md (decentralized-first).
import type { RegistryClient } from "@nazare/core";
import { FileSystemRegistry } from "./fake.js";
import { HttpRegistry } from "./http.js";

export function registryFromEnv(
	env: Record<string, string | undefined> = process.env,
): RegistryClient {
	const url = env.NAZARE_REGISTRY;
	if (!url) {
		throw new Error(
			"NAZARE_REGISTRY is not set (a registry base URL, or file:<dir> for a local registry)",
		);
	}
	if (url.startsWith("file:")) {
		return new FileSystemRegistry(url.slice("file:".length));
	}
	return new HttpRegistry(url);
}
