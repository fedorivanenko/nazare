import type { RegistryComponent } from "@nazare/core";
import { parseComponentId } from "./id.js";

export const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export function isValidVersion(version: string): boolean {
	return VERSION_PATTERN.test(version);
}

export function validateBasicRegistryComponent(
	component: RegistryComponent,
): string | undefined {
	try {
		parseComponentId(component.id);
	} catch {
		return `Invalid component id ${component.id}`;
	}
	if (!isValidVersion(component.version)) {
		return `Invalid version ${component.version}`;
	}
	for (const [dependencyId, dependencyVersion] of Object.entries(
		component.dependencies,
	)) {
		try {
			parseComponentId(dependencyId);
		} catch {
			return `Invalid dependency id ${dependencyId}`;
		}
		if (!isValidVersion(dependencyVersion)) {
			return `Invalid dependency version ${dependencyId}@${dependencyVersion}`;
		}
	}
	if (Object.keys(component.files).length === 0)
		return "files must not be empty";
	const normalizedPaths = new Map<string, string>();
	for (const path of Object.keys(component.files)) {
		if (!isSafeRelativePath(path)) return `unsafe file path "${path}"`;
		const normalized = path.split(/[\\/]/).join("/");
		const collidingPath = normalizedPaths.get(normalized);
		if (collidingPath !== undefined) {
			return `file paths "${collidingPath}" and "${path}" collide`;
		}
		normalizedPaths.set(normalized, path);
	}
	for (const [normalized, path] of normalizedPaths) {
		const segments = normalized.split("/");
		for (let index = 1; index < segments.length; index += 1) {
			const parentPath = segments.slice(0, index).join("/");
			const parentFile = normalizedPaths.get(parentPath);
			if (parentFile !== undefined) {
				return `file path "${parentFile}" conflicts with child path "${path}"`;
			}
		}
	}
	return undefined;
}

// A file path that is safe to write under a component folder on the consumer's
// machine: relative, no absolute root, no `..`/`.` segments, no null byte.
export function isSafeRelativePath(path: string): boolean {
	if (path.length === 0 || path.includes("\0")) return false;
	if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
	return path
		.split(/[\\/]/)
		.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
