// Component-scoped bundler for behavior scripts. Relative imports resolve
// through readAsset — the same boundary sidecar imports use — so a module
// graph can never leave the component directory and stays a portable
// artifact. Each module transpiles to CommonJS and is wrapped in a ~10-line
// loader; specifier→module resolution happens here at bundle time, the
// runtime only looks ids up. Bare (package) specifiers are not resolvable
// and are rejected earlier by the module-syntax check.
import type { Diagnostic } from "@nazare/core";
import ts from "typescript";
import {
	scriptImportCycle,
	scriptImportInvalid,
	scriptImportNotFound,
	scriptPackageImportUnresolved,
} from "./diagnostics.js";

export type BundleResult = {
	/** Self-contained expression evaluating to the entry's exports.default. */
	code: string;
	issues: Diagnostic[];
};

export type ReadAsset = (relativePath: string) => string | undefined;

/** Supplies the entry source of a function package (manifest kind "function"). */
export type ReadPackageModule = (packageId: string) => string | undefined;

type Module = {
	id: string;
	transpiled: string;
	/** specifier as written -> resolved module id */
	resolutions: Record<string, string>;
};

export function bundleScript(
	entrySource: string,
	entryId: string,
	readAsset: ReadAsset | undefined,
	readPackageModule?: ReadPackageModule,
): BundleResult {
	const issues: Diagnostic[] = [];
	const modules = new Map<string, Module>();
	const loading = new Set<string>();

	const load = (id: string, source: string, isPackage: boolean): void => {
		loading.add(id);
		const resolutions: Record<string, string> = {};

		for (const specifier of importSpecifiers(source)) {
			if (!specifier.startsWith(".")) {
				// Bare specifier: a function package, self-contained by rule.
				resolutions[specifier] = specifier;
				if (modules.has(specifier)) continue;
				if (loading.has(specifier)) {
					issues.push(scriptImportCycle(specifier, id));
					continue;
				}
				const packageSource = readPackageModule?.(specifier);
				if (packageSource === undefined) {
					issues.push(scriptPackageImportUnresolved(specifier, id));
					continue;
				}
				load(specifier, packageSource, true);
				continue;
			}

			if (isPackage) {
				// v1: function packages cannot have their own relative files —
				// readAsset only reaches the consuming component's directory.
				issues.push(scriptImportInvalid(specifier, id));
				continue;
			}

			const resolvedId = resolveSpecifier(id, specifier);
			if (!resolvedId) {
				issues.push(scriptImportInvalid(specifier, id));
				continue;
			}
			resolutions[specifier] = resolvedId;
			if (modules.has(resolvedId)) continue;
			if (loading.has(resolvedId)) {
				issues.push(scriptImportCycle(resolvedId, id));
				continue;
			}
			const contents = readAsset?.(`./${resolvedId}`);
			if (contents === undefined) {
				issues.push(scriptImportNotFound(specifier, id));
				continue;
			}
			load(resolvedId, contents, false);
		}

		modules.set(id, {
			id,
			transpiled: ts.transpileModule(source, {
				compilerOptions: {
					module: ts.ModuleKind.CommonJS,
					target: ts.ScriptTarget.ES2018,
				},
			}).outputText,
			resolutions,
		});
		loading.delete(id);
	};

	load(entryId, entrySource, false);

	const moduleEntries = Array.from(modules.values());
	const singleModule =
		moduleEntries.length === 1 &&
		Object.keys(moduleEntries[0].resolutions).length === 0;

	if (singleModule) {
		// No imports: skip the loader, evaluate the module inline.
		const code = [
			"(function () {",
			"      var exports = {};",
			indent(moduleEntries[0].transpiled.trim(), "      "),
			"      return exports.default;",
			"    })()",
		].join("\n");
		return { code, issues };
	}

	const moduleMap = moduleEntries
		.map(
			(module) =>
				`      ${JSON.stringify(module.id)}: [function (exports, require, module) {\n${indent(module.transpiled.trim(), "        ")}\n      }, ${JSON.stringify(module.resolutions)}],`,
		)
		.join("\n");

	const code = [
		"(function () {",
		`      var __modules = {`,
		moduleMap,
		"      };",
		"      var __cache = {};",
		"      function __load(id) {",
		"        if (__cache[id]) return __cache[id].exports;",
		"        var module = { exports: {} };",
		"        __cache[id] = module;",
		"        var definition = __modules[id];",
		"        definition[0](module.exports, function (specifier) {",
		"          return __load(definition[1][specifier]);",
		"        }, module);",
		"        return module.exports;",
		"      }",
		`      return __load(${JSON.stringify(entryId)}).default;`,
		"    })()",
	].join("\n");

	return { code, issues };
}

/** Non-type-only import/export-from specifiers, in source order. */
export function importSpecifiers(source: string): string[] {
	const sourceFile = ts.createSourceFile(
		"module.ts",
		source,
		ts.ScriptTarget.ES2018,
		true,
	);
	const specifiers: string[] = [];

	for (const statement of sourceFile.statements) {
		let specifier: ts.Expression | undefined;
		if (ts.isImportDeclaration(statement)) {
			if (statement.importClause?.isTypeOnly) continue;
			specifier = statement.moduleSpecifier;
		}
		if (ts.isExportDeclaration(statement)) {
			if (statement.isTypeOnly) continue;
			specifier = statement.moduleSpecifier;
		}
		if (!specifier || !ts.isStringLiteral(specifier)) continue;
		specifiers.push(specifier.text);
	}

	return specifiers;
}

/**
 * Resolves a specifier against the importing module's directory, staying
 * inside the component dir. Returns undefined when the path escapes or
 * lacks a bundleable extension.
 */
function resolveSpecifier(fromId: string, specifier: string): string | undefined {
	if (!/\.(ts|js)$/.test(specifier)) return undefined;

	const base = fromId.split("/").slice(0, -1);
	const segments = [...base];
	for (const segment of specifier.split("/")) {
		if (segment === "." || segment === "") continue;
		if (segment === "..") {
			if (segments.length === 0) return undefined;
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join("/");
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => (line ? prefix + line : line))
		.join("\n");
}
