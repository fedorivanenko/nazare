// Project-scoped bundler for behavior scripts. Modules are identified by
// project-relative paths and resolve through readFile — the same boundary
// every import uses — so a module graph can reach any file the author owns
// but never leaves the project root. Each module transpiles to CommonJS and
// is wrapped in a ~10-line loader; specifier→module resolution happens here
// at bundle time, the runtime only looks ids up. Bare (package) specifiers
// are illegal: Nazare has no packages at build time.
import type { Diagnostic } from "@nazare/core";
import ts from "typescript";
import {
	scriptImportBare,
	scriptImportCycle,
	scriptImportInvalid,
	scriptImportNotFound,
} from "./diagnostics.js";
import { isRelativeSpecifier, resolveImportPath } from "./paths.js";
import type { ReadFile } from "./read-file.js";

export type BundleResult = {
	/** Self-contained expression evaluating to the entry's exports.default. */
	code: string;
	issues: Diagnostic[];
};



type Module = {
	id: string;
	transpiled: string;
	/** specifier as written -> resolved module id */
	resolutions: Record<string, string>;
};

export function bundleScript(
	entrySource: string,
	entryFile: string,
	readFile: ReadFile | undefined,
): BundleResult {
	const issues: Diagnostic[] = [];
	const modules = new Map<string, Module>();
	const loading = new Set<string>();

	const load = (id: string, source: string): void => {
		loading.add(id);
		const resolutions: Record<string, string> = {};

		for (const specifier of importSpecifiers(source)) {
			if (!isRelativeSpecifier(specifier)) {
				issues.push(scriptImportBare(specifier, id));
				continue;
			}
			if (!/\.(ts|js)$/.test(specifier)) {
				issues.push(scriptImportInvalid(specifier, id));
				continue;
			}
			const resolvedId = resolveImportPath(id, specifier);
			if (resolvedId === undefined) {
				issues.push(scriptImportInvalid(specifier, id));
				continue;
			}
			resolutions[specifier] = resolvedId;
			if (modules.has(resolvedId)) continue;
			if (loading.has(resolvedId)) {
				issues.push(scriptImportCycle(resolvedId, id));
				continue;
			}
			const contents = readFile?.(resolvedId);
			if (contents === undefined) {
				issues.push(scriptImportNotFound(specifier, id));
				continue;
			}
			load(resolvedId, contents);
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

	load(entryFile, entrySource);

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
		`      return __load(${JSON.stringify(entryFile)}).default;`,
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

/** Prefixes every non-empty line; shared with emit's script wrapping. */
export function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => (line ? prefix + line : line))
		.join("\n");
}
