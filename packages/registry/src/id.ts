// Component ids are scoped: @scope/name. The last segment is the folder name
// on disk after install; the scope namespaces it in the registry.

export type ComponentId = { scope: string; name: string };

const ID_PATTERN = /^@([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)$/;

export function parseComponentId(id: string): ComponentId {
	const match = ID_PATTERN.exec(id);
	if (!match) {
		throw new Error(`Invalid component id "${id}" (expected @scope/name)`);
	}
	return { scope: match[1], name: match[2] };
}

/** The folder name a component installs into: the id's last segment. */
export function componentFolderName(id: string): string {
	return parseComponentId(id).name;
}

/**
 * Orders x.y.z versions ascending. Non-numeric or missing parts sort as 0; this
 * is not full semver (no prerelease tags) — versions here are plain releases.
 */
export function compareVersions(a: string, b: string): number {
	const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
	const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}
