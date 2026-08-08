import { posix } from "node:path";
import { canonicalProductKey } from "../computation/canonical-key.js";

const canonicalFileIds = new WeakSet<object>();
const serializedFileIds = new WeakMap<object, string>();

export type ProjectFileId = {
	workspace: string;
	package: string;
	path: string;
};

export function projectFileId(input: ProjectFileId): ProjectFileId {
	const id = Object.freeze({
		workspace: validateIdentityPart("workspace", input.workspace),
		package: validateIdentityPart("package", input.package),
		path: normalizeProjectPath(input.path),
	});
	canonicalFileIds.add(id);
	return id;
}

export function normalizeProjectPath(path: string): string {
	if (!path || path.includes("\0")) {
		throw new TypeError("Project file path must be a non-empty safe path");
	}
	const portable = path.replaceAll("\\", "/");
	if (portable.startsWith("/") || /^[a-zA-Z]:\//.test(portable)) {
		throw new TypeError(`Project file path must be relative: ${path}`);
	}
	const normalized = posix.normalize(portable).replace(/^\.\//, "");
	if (
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../")
	) {
		throw new TypeError(`Project file path escapes its package: ${path}`);
	}
	return normalized;
}

export function serializeProjectFileId(id: ProjectFileId): string {
	if (typeof id === "object" && id !== null) {
		const cached = serializedFileIds.get(id);
		if (cached !== undefined) return cached;
	}
	const normalized = projectFileId(id);
	const serialized = canonicalProductKey(normalized);
	if (typeof id === "object" && id !== null && canonicalFileIds.has(id)) {
		serializedFileIds.set(id, serialized);
	}
	serializedFileIds.set(normalized, serialized);
	return serialized;
}

export function compareProjectFileIds(
	left: ProjectFileId,
	right: ProjectFileId,
): number {
	return serializeProjectFileId(left).localeCompare(
		serializeProjectFileId(right),
	);
}

export function sameProjectFileId(
	left: ProjectFileId,
	right: ProjectFileId,
): boolean {
	return serializeProjectFileId(left) === serializeProjectFileId(right);
}

function validateIdentityPart(
	field: "workspace" | "package",
	value: string,
): string {
	const hasControlCharacter = [...value].some(
		(character) => character.charCodeAt(0) < 32,
	);
	if (!value || value.trim() !== value || hasControlCharacter) {
		throw new TypeError(`Project file ${field} must be a non-empty stable ID`);
	}
	return value;
}
