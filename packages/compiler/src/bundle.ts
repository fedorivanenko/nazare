// Project-scoped JavaScript bundler. Modules resolve only through readFile and
// are lowered from ESM to the small CommonJS-compatible Nazare runtime loader.
import type { Diagnostic } from "@nazare/core";
import type { Program } from "acorn";
import {
	scriptImportBare,
	scriptImportCycle,
	scriptImportInvalid,
	scriptImportNotFound,
	scriptJavaScriptParseError,
} from "./diagnostics.js";
import {
	type JavaScriptNode,
	parseJavaScript,
	walkJavaScript,
} from "./javascript-ast.js";
import { isRelativeSpecifier, resolveImportPath } from "./paths.js";
import type { ReadFile } from "./read-file.js";
import { spanFromOffsets } from "./source.js";

export type BundleResult =
	| { ok: true; code: string; issues: Diagnostic[] }
	| { ok: false; issues: Diagnostic[] };

type Module = {
	id: string;
	loweredSource: string;
	exportsBinding: string;
	requireBinding: string;
	resolutions: Record<string, string>;
};

type Edit = { start: number; end: number; replacement: string };

export function bundleScript(
	entrySource: string,
	entryFile: string,
	readFile: ReadFile | undefined,
): BundleResult {
	const issues: Diagnostic[] = [];
	const modules = new Map<string, Module>();
	const loading = new Set<string>();
	const authoredIdentifiers = new Set<string>();

	const load = (id: string, source: string): void => {
		loading.add(id);
		const parsed = parseJavaScript(source);
		if (!parsed.ok) {
			issues.push(
				scriptJavaScriptParseError(
					parsed.error.message,
					spanFromOffsets(source, id, parsed.error),
				),
			);
			loading.delete(id);
			return;
		}
		const program = parsed.program;
		for (const name of collectJavaScriptIdentifiers(program)) {
			authoredIdentifiers.add(name);
		}
		const resolutions: Record<string, string> = {};
		for (const specifier of importSpecifiersFromProgram(program)) {
			if (!isRelativeSpecifier(specifier)) {
				issues.push(scriptImportBare(specifier, id));
				continue;
			}
			if (!specifier.endsWith(".js")) {
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
		const bindings = moduleRuntimeBindings(program);
		modules.set(id, {
			id,
			loweredSource: lowerJavaScriptModule(source, program, bindings),
			...bindings,
			resolutions,
		});
		loading.delete(id);
	};

	load(entryFile, entrySource);
	if (issues.some((issue) => issue.severity === "error")) {
		return { ok: false, issues };
	}
	const moduleEntries = Array.from(modules.values());
	const entryModule = modules.get(entryFile);
	if (!entryModule) {
		throw new Error(`JavaScript bundler lost entry module ${entryFile}`);
	}
	const singleModule =
		moduleEntries.length === 1 &&
		Object.keys(entryModule.resolutions).length === 0;

	if (singleModule) {
		return {
			ok: true,
			code: [
				"(function () {",
				`      var ${entryModule.exportsBinding} = {};`,
				indent(entryModule.loweredSource.trim(), "      "),
				`      return ${entryModule.exportsBinding}.default;`,
				"    })()",
			].join("\n"),
			issues,
		};
	}

	const generatedIdentifiers = new Set(authoredIdentifiers);
	const moduleTableBinding = allocateIdentifier(
		generatedIdentifiers,
		"__nazareModules",
	);
	const moduleCacheBinding = allocateIdentifier(
		generatedIdentifiers,
		"__nazareModuleCache",
	);
	const loadModuleBinding = allocateIdentifier(
		generatedIdentifiers,
		"__nazareLoadModule",
	);
	const moduleMap = moduleEntries
		.map(
			(module) =>
				`      ${JSON.stringify(module.id)}: [function (${module.exportsBinding}, ${module.requireBinding}) {\n${indent(module.loweredSource.trim(), "        ")}\n      }, ${JSON.stringify(module.resolutions)}],`,
		)
		.join("\n");
	return {
		ok: true,
		code: [
			"(function () {",
			`      var ${moduleTableBinding} = {`,
			moduleMap,
			"      };",
			`      var ${moduleCacheBinding} = {};`,
			`      function ${loadModuleBinding}(id) {`,
			`        if (${moduleCacheBinding}[id]) return ${moduleCacheBinding}[id].exports;`,
			"        var module = { exports: {} };",
			`        ${moduleCacheBinding}[id] = module;`,
			`        var definition = ${moduleTableBinding}[id];`,
			"        definition[0](module.exports, function (specifier) {",
			`          return ${loadModuleBinding}(definition[1][specifier]);`,
			"        }, module);",
			"        return module.exports;",
			"      }",
			`      return ${loadModuleBinding}(${JSON.stringify(entryFile)}).default;`,
			"    })()",
		].join("\n"),
		issues,
	};
}

export function importSpecifiers(source: string): string[] {
	const parsed = parseJavaScript(source);
	if (!parsed.ok) {
		throw new SyntaxError(
			`Cannot read JavaScript imports: ${parsed.error.message}`,
		);
	}
	return importSpecifiersFromProgram(parsed.program);
}

function importSpecifiersFromProgram(program: Program): string[] {
	const specifiers: string[] = [];
	for (const statement of nodes(program.body)) {
		if (
			statement.type === "ImportDeclaration" ||
			statement.type === "ExportAllDeclaration"
		) {
			specifiers.push(
				requiredLiteralString(
					statement.source,
					`${statement.type} module source`,
				),
			);
		}
		if (statement.type === "ExportNamedDeclaration" && statement.source) {
			specifiers.push(
				requiredLiteralString(
					statement.source,
					"ExportNamedDeclaration module source",
				),
			);
		}
	}
	return specifiers;
}

function moduleRuntimeBindings(program: Program): {
	exportsBinding: string;
	requireBinding: string;
} {
	const used = collectJavaScriptIdentifiers(program);
	return {
		exportsBinding: allocateIdentifier(used, "__nazareExports"),
		requireBinding: allocateIdentifier(used, "__nazareRequire"),
	};
}

function collectJavaScriptIdentifiers(program: Program): Set<string> {
	const names = new Set<string>();
	walkJavaScript(program, (node) => {
		const name = identifierName(node);
		if (name !== undefined) names.add(name);
	});
	return names;
}

function allocateIdentifier(used: Set<string>, base: string): string {
	let candidate = base;
	let suffix = 2;
	while (used.has(candidate)) {
		candidate = `${base}${suffix}`;
		suffix += 1;
	}
	used.add(candidate);
	return candidate;
}

function lowerJavaScriptModule(
	source: string,
	program: Program,
	runtime: { exportsBinding: string; requireBinding: string },
): string {
	const edits: Edit[] = [];
	for (const statement of nodes(program.body)) {
		if (statement.type === "ImportDeclaration") {
			const specifier = requiredLiteralString(
				statement.source,
				"import module source",
			);
			const bindings = nodes(statement.specifiers);
			if (bindings.length === 0) {
				edits.push(
					replace(
						statement,
						`${runtime.requireBinding}(${JSON.stringify(specifier)});`,
					),
				);
				continue;
			}
			const requiredModule = `${runtime.requireBinding}(${JSON.stringify(specifier)})`;
			const lines: string[] = [];
			for (const binding of bindings) {
				const local = requiredIdentifier(
					binding.local,
					`${binding.type} local binding`,
				);
				if (binding.type === "ImportDefaultSpecifier") {
					lines.push(`const ${local} = ${requiredModule}.default;`);
				} else if (binding.type === "ImportNamespaceSpecifier") {
					lines.push(`const ${local} = ${requiredModule};`);
				} else if (binding.type === "ImportSpecifier") {
					const imported = requiredModuleName(binding.imported, "named import");
					lines.push(
						`const ${local} = ${requiredModule}[${JSON.stringify(imported)}];`,
					);
				} else {
					throw new Error(`Unsupported import binding ${binding.type}`);
				}
			}
			edits.push(replace(statement, lines.join("\n")));
			continue;
		}
		if (statement.type === "ExportDefaultDeclaration") {
			const declaration = requiredNode(
				statement.declaration,
				"default export declaration",
			);
			edits.push({
				start: statement.start,
				end: declaration.start,
				replacement: `${runtime.exportsBinding}.default = `,
			});
			continue;
		}
		if (statement.type === "ExportAllDeclaration") {
			const specifier = requiredLiteralString(
				statement.source,
				"export-all module source",
			);
			const exported = statement.exported
				? requiredModuleName(statement.exported, "namespace export name")
				: undefined;
			edits.push(
				replace(
					statement,
					exported
						? `${runtime.exportsBinding}[${JSON.stringify(exported)}] = ${runtime.requireBinding}(${JSON.stringify(specifier)});`
						: `Object.assign(${runtime.exportsBinding}, ${runtime.requireBinding}(${JSON.stringify(specifier)}));`,
				),
			);
			continue;
		}
		if (statement.type !== "ExportNamedDeclaration") continue;
		const declaration = asNode(statement.declaration);
		if (declaration) {
			const names = declaredNames(declaration);
			edits.push({
				start: statement.start,
				end: declaration.start,
				replacement: "",
			});
			edits.push({
				start: declaration.end,
				end: declaration.end,
				replacement: names
					.map((name) => `\n${runtime.exportsBinding}.${name} = ${name};`)
					.join(""),
			});
			continue;
		}
		const sourceSpecifier = statement.source
			? requiredLiteralString(statement.source, "named-export module source")
			: undefined;
		const requiredModule = sourceSpecifier
			? `${runtime.requireBinding}(${JSON.stringify(sourceSpecifier)})`
			: undefined;
		const lines: string[] = [];
		for (const specifier of nodes(statement.specifiers)) {
			const local = requiredModuleName(specifier.local, "export local name");
			const exported = requiredModuleName(specifier.exported, "exported name");
			lines.push(
				`${runtime.exportsBinding}[${JSON.stringify(exported)}] = ${requiredModule ? `${requiredModule}[${JSON.stringify(local)}]` : local};`,
			);
		}
		edits.push(replace(statement, lines.join("\n")));
	}
	return applyEdits(source, edits);
}

function declaredNames(declaration: JavaScriptNode): string[] {
	if (
		declaration.type === "FunctionDeclaration" ||
		declaration.type === "ClassDeclaration"
	) {
		const name = identifierName(declaration.id);
		return name ? [name] : [];
	}
	if (declaration.type === "VariableDeclaration") {
		return nodes(declaration.declarations).flatMap((item) =>
			bindingNames(asNode(item.id)),
		);
	}
	throw new Error(`Unsupported exported declaration ${declaration.type}`);
}

function bindingNames(node: JavaScriptNode | undefined): string[] {
	if (!node) return [];
	const name = identifierName(node);
	if (name) return [name];
	if (node.type === "ObjectPattern")
		return nodes(node.properties).flatMap((property) =>
			bindingNames(asNode(property.value ?? property.argument)),
		);
	if (node.type === "ArrayPattern")
		return nodes(node.elements).flatMap((element) => bindingNames(element));
	if (node.type === "RestElement") return bindingNames(asNode(node.argument));
	if (node.type === "AssignmentPattern") return bindingNames(asNode(node.left));
	throw new Error(`Unsupported exported binding pattern ${node.type}`);
}

function replace(node: JavaScriptNode, replacement: string): Edit {
	return { start: node.start, end: node.end, replacement };
}

function applyEdits(source: string, edits: Edit[]): string {
	const ordered = [...edits].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	for (const [index, edit] of ordered.entries()) {
		if (edit.start < 0 || edit.end < edit.start || edit.end > source.length) {
			throw new Error(
				`Invalid JavaScript module edit ${edit.start}-${edit.end} for source length ${source.length}`,
			);
		}
		const previous = ordered[index - 1];
		if (previous && edit.start < previous.end) {
			throw new Error(
				`Overlapping JavaScript module edits ${previous.start}-${previous.end} and ${edit.start}-${edit.end}`,
			);
		}
	}
	let output = source;
	for (const edit of ordered.reverse()) {
		output =
			output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
	}
	return output;
}

function requiredNode(value: unknown, subject: string): JavaScriptNode {
	const node = asNode(value);
	if (!node) throw new Error(`JavaScript AST missing ${subject}`);
	return node;
}

function requiredIdentifier(value: unknown, subject: string): string {
	const name = identifierName(value);
	if (name === undefined)
		throw new Error(`JavaScript AST has invalid ${subject}`);
	return name;
}

function requiredLiteralString(value: unknown, subject: string): string {
	const string = literalString(asNode(value));
	if (string === undefined)
		throw new Error(`JavaScript AST has invalid ${subject}`);
	return string;
}

function requiredModuleName(value: unknown, subject: string): string {
	return identifierName(value) ?? requiredLiteralString(value, subject);
}

function literalString(node: JavaScriptNode | undefined): string | undefined {
	return node?.type === "Literal" && typeof node.value === "string"
		? node.value
		: undefined;
}

function identifierName(value: unknown): string | undefined {
	const node = asNode(value);
	return node?.type === "Identifier" && typeof node.name === "string"
		? node.name
		: undefined;
}

function asNode(value: unknown): JavaScriptNode | undefined {
	return value && typeof value === "object" && "type" in value
		? (value as JavaScriptNode)
		: undefined;
}

function nodes(value: unknown): JavaScriptNode[] {
	if (!Array.isArray(value)) {
		throw new Error("JavaScript AST expected a child-node array");
	}
	return value.map(asNode).filter((node): node is JavaScriptNode => !!node);
}

export function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) =>
			line
				? prefix + line.replace(/^\t+/, (tabs) => "  ".repeat(tabs.length))
				: line,
		)
		.join("\n");
}
