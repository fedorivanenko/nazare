import { posix } from "node:path";
import type { Diagnostic } from "@nazare/core";
import type { Program } from "acorn";
import selectorParser from "postcss-selector-parser";
import {
	type JavaScriptNode,
	parseJavaScript,
	walkJavaScript,
} from "../javascript-ast.js";
import { spanFromOffsets } from "../source.js";
import type { ThemeFact, ThemeJavaScriptOwner } from "../theme-facts.js";
import { analyzeThemeScriptNetwork } from "../theme-script-network.js";
import type { ThemeSourceUncertainty } from "../theme-source-frontend.js";

export type ThemeScriptAnalysis = {
	facts: ThemeFact[];
	issues: Diagnostic[];
	uncertainty: ThemeSourceUncertainty[];
};

export function analyzeThemeScript(
	path: string,
	source: string,
): ThemeScriptAnalysis {
	const parsed = parseJavaScript(source);
	if (!parsed.ok) {
		return {
			facts: [],
			uncertainty: [],
			issues: [
				{
					severity: "error",
					code: "THEME_SCRIPT_PARSE_ERROR",
					message: `Invalid JavaScript in ${path}: ${parsed.error.message}`,
					phase: "parse",
					span: spanFromOffsets(source, path, {
						start: parsed.error.start,
						end: parsed.error.end,
					}),
				},
			],
		};
	}
	const program = parsed.program;
	const exportsByBinding = collectExportKinds(program);
	const network = analyzeThemeScriptNetwork(path, source, program);

	const facts: ThemeFact[] = [...network.facts];
	const issues: Diagnostic[] = [];
	const uncertainty: ThemeSourceUncertainty[] = [...network.uncertainty];
	walkJavaScript(program, (node, parent, ancestors) => {
		if (
			(node.type === "ImportDeclaration" ||
				node.type === "ExportNamedDeclaration" ||
				node.type === "ExportAllDeclaration") &&
			node.source
		) {
			analyzeModuleSpecifier(asNode(node.source));
		}
		if (node.type === "ImportExpression") {
			const specifier = asNode(node.source);
			if (staticString(specifier) === undefined) {
				pushUncertainty(
					"THEME_DYNAMIC_SCRIPT_IMPORT",
					"Dynamic import path prevents complete module dependency analysis",
					node,
				);
			} else analyzeModuleSpecifier(specifier);
		}
		if (node.type === "MemberExpression")
			analyzeDatasetAccess(node, parent, ownerFor(ancestors));
		if (node.type === "CallExpression") analyzeCall(node, ownerFor(ancestors));
	});
	return { facts, issues, uncertainty };

	function analyzeCall(
		call: JavaScriptNode,
		owner: ThemeJavaScriptOwner,
	): void {
		const callee = asNode(call.callee);
		if (!callee || callee.type !== "MemberExpression") return;
		const method = memberName(callee);
		if (!method) return;
		const args = nodes(call.arguments);
		if (
			["querySelector", "querySelectorAll", "matches", "closest"].includes(
				method,
			)
		) {
			const selector = staticString(args[0]);
			if (selector === undefined) {
				pushUncertainty(
					"THEME_DYNAMIC_SCRIPT_SELECTOR",
					`Dynamic ${method} selector prevents complete DOM hook analysis`,
					call,
				);
				return;
			}
			try {
				const root = selectorParser().astSync(selector);
				root.walkClasses((hook) =>
					pushDom("class", hook.value, "queries", call, owner),
				);
				root.walkIds((hook) =>
					pushDom("id", hook.value, "queries", call, owner),
				);
				root.walkAttributes((hook) => {
					if (hook.attribute)
						pushDom("attribute", hook.attribute, "queries", call, owner);
				});
			} catch (error) {
				issues.push({
					severity: "error",
					code: "THEME_SCRIPT_INVALID_SELECTOR",
					message: `Invalid selector passed to ${method} in ${path}: ${error instanceof Error ? error.message : String(error)}`,
					phase: "check",
					span: nodeSpan(call),
				});
			}
			return;
		}
		if (
			[
				"getAttribute",
				"hasAttribute",
				"setAttribute",
				"removeAttribute",
				"toggleAttribute",
			].includes(method)
		) {
			const attribute = staticString(args[0]);
			if (attribute === undefined) {
				pushUncertainty(
					"THEME_DYNAMIC_ATTRIBUTE_ACCESS",
					`Dynamic ${method} attribute prevents complete DOM hook analysis`,
					call,
				);
			} else if (attribute.toLowerCase().startsWith("data-")) {
				pushDom(
					"attribute",
					attribute.toLowerCase(),
					method === "getAttribute" || method === "hasAttribute"
						? "queries"
						: "mutates",
					call,
					owner,
				);
			}
			return;
		}
		if (method === "getElementById") {
			const id = staticString(args[0]);
			if (id === undefined) {
				pushUncertainty(
					"THEME_DYNAMIC_ELEMENT_ID",
					"Dynamic getElementById argument prevents complete DOM hook analysis",
					call,
				);
			} else pushDom("id", id, "queries", call, owner);
			return;
		}
		const target = asNode(callee.object);
		if (
			["add", "remove", "toggle", "replace"].includes(method) &&
			target?.type === "MemberExpression" &&
			memberName(target) === "classList"
		) {
			for (const argument of args) {
				const className = staticString(argument);
				if (className === undefined) {
					pushUncertainty(
						"THEME_DYNAMIC_CLASS_MUTATION",
						`Dynamic classList.${method} argument prevents complete DOM hook analysis`,
						argument,
					);
				} else pushDom("class", className, "mutates", argument, owner);
			}
			return;
		}
		if (method === "addEventListener") {
			pushEvent("listens", staticString(args[0]), call, owner);
			return;
		}
		if (method === "dispatchEvent") {
			const argument = args[0];
			const eventName =
				argument?.type === "NewExpression"
					? staticString(nodes(argument.arguments)[0])
					: undefined;
			pushEvent("dispatches", eventName, call, owner);
			return;
		}
		if (method === "define" && identifierName(target) === "customElements") {
			pushCustomElement(staticString(args[0]), call, owner);
		}
	}

	function analyzeDatasetAccess(
		access: JavaScriptNode,
		parent: JavaScriptNode | undefined,
		owner: ThemeJavaScriptOwner,
	): void {
		const target = asNode(access.object);
		if (target?.type !== "MemberExpression" || memberName(target) !== "dataset")
			return;
		const key = memberName(access);
		if (key === undefined) {
			pushUncertainty(
				"THEME_DYNAMIC_DATASET_ACCESS",
				"Dynamic dataset key prevents complete DOM hook analysis",
				access,
			);
			return;
		}
		pushDom(
			"attribute",
			datasetAttributeName(key),
			isWriteAccess(access, parent) ? "mutates" : "queries",
			access,
			owner,
		);
	}

	function analyzeModuleSpecifier(specifier: JavaScriptNode | undefined): void {
		if (!specifier) return;
		const moduleName = staticString(specifier);
		if (moduleName === undefined) return;
		const targetPath = localModulePath(path, moduleName);
		if (!targetPath) return;
		facts.push({
			kind: "referencesAsset",
			fromPath: path,
			targetName: targetPath,
			static: true,
			span: nodeSpan(specifier),
		});
	}

	function pushDom(
		hookKind: "class" | "id" | "attribute",
		name: string,
		operation: "queries" | "mutates",
		node: JavaScriptNode,
		javaScriptOwner: ThemeJavaScriptOwner,
	): void {
		facts.push({
			kind: "behavior",
			fromPath: path,
			subjectKind: "domHook",
			hookKind,
			operation,
			name,
			span: nodeSpan(node),
			extractor: "javascript-ast",
			javaScriptOwner,
		});
	}

	function pushEvent(
		operation: "dispatches" | "listens",
		name: string | undefined,
		node: JavaScriptNode,
		javaScriptOwner: ThemeJavaScriptOwner,
	): void {
		if (name === undefined) {
			pushUncertainty(
				"THEME_DYNAMIC_EVENT_NAME",
				"Dynamic custom event name prevents complete behavior analysis",
				node,
			);
			return;
		}
		facts.push({
			kind: "behavior",
			fromPath: path,
			subjectKind: "customEvent",
			operation,
			name,
			span: nodeSpan(node),
			extractor: "javascript-ast",
			javaScriptOwner,
		});
	}

	function pushCustomElement(
		name: string | undefined,
		node: JavaScriptNode,
		javaScriptOwner: ThemeJavaScriptOwner,
	): void {
		if (name === undefined) {
			pushUncertainty(
				"THEME_DYNAMIC_CUSTOM_ELEMENT_NAME",
				"Dynamic custom element name prevents complete behavior analysis",
				node,
			);
			return;
		}
		facts.push({
			kind: "behavior",
			fromPath: path,
			subjectKind: "customElement",
			operation: "defines",
			name,
			span: nodeSpan(node),
			extractor: "javascript-ast",
			javaScriptOwner,
		});
	}

	function ownerFor(ancestors: JavaScriptNode[]): ThemeJavaScriptOwner {
		for (let index = ancestors.length - 1; index >= 0; index -= 1) {
			const node = ancestors[index];
			if (!isFunctionNode(node)) continue;
			const parent = ancestors[index - 1];
			const named = functionOwnerName(node, parent);
			return {
				kind: named.kind,
				name: named.name,
				exports: ownerExports(node, ancestors, named.name, exportsByBinding),
				id: javaScriptOwnerId(path, node, named.name),
				span: nodeSpan(node),
			};
		}
		return {
			kind: "module",
			name: path,
			exports: [],
			id: javaScriptModuleOwnerId(path),
		};
	}

	function pushUncertainty(
		code: string,
		message: string,
		node: JavaScriptNode,
	): void {
		uncertainty.push({ code, message, span: nodeSpan(node) });
	}

	function nodeSpan(node: JavaScriptNode) {
		return spanFromOffsets(source, path, { start: node.start, end: node.end });
	}
}

type JavaScriptExportKind = ThemeJavaScriptOwner["exports"][number];

function javaScriptOwnerId(
	path: string,
	node: JavaScriptNode,
	name: string | undefined,
): string {
	const encodedPath = encodeURIComponent(path);
	const encodedName = encodeURIComponent(name ?? "anonymous");
	return `javascript-owner:${encodedPath}:${node.start}:${node.end}:${encodedName}`;
}

function javaScriptModuleOwnerId(path: string): string {
	return `javascript-owner:${encodeURIComponent(path)}:module`;
}

function collectExportKinds(
	program: Program,
): Map<string, Set<JavaScriptExportKind>> {
	const exportsByBinding = new Map<string, Set<JavaScriptExportKind>>();
	const add = (name: string | undefined, kind: JavaScriptExportKind): void => {
		if (!name) return;
		const kinds = exportsByBinding.get(name) ?? new Set();
		kinds.add(kind);
		exportsByBinding.set(name, kinds);
	};
	walkJavaScript(program, (node) => {
		if (node.type === "ExportNamedDeclaration") {
			for (const name of declarationBindingNames(asNode(node.declaration)))
				add(name, "named");
			if (!node.source) {
				for (const specifier of nodes(node.specifiers)) {
					const exportedName = propertyName(asNode(specifier.exported));
					add(
						propertyName(asNode(specifier.local)),
						exportedName === "default" ? "default" : "named",
					);
				}
			}
		}
		if (node.type === "ExportDefaultDeclaration") {
			const declaration = asNode(node.declaration);
			for (const name of declarationBindingNames(declaration))
				add(name, "default");
			if (declaration?.type === "Identifier")
				add(identifierName(declaration), "default");
		}
	});
	return exportsByBinding;
}

function declarationBindingNames(
	declaration: JavaScriptNode | undefined,
): string[] {
	if (!declaration) return [];
	if (
		declaration.type === "FunctionDeclaration" ||
		declaration.type === "ClassDeclaration"
	) {
		const name = identifierName(asNode(declaration.id));
		return name ? [name] : [];
	}
	if (declaration.type !== "VariableDeclaration") return [];
	return nodes(declaration.declarations).flatMap((declarator) =>
		bindingNames(asNode(declarator.id)),
	);
}

function bindingNames(pattern: JavaScriptNode | undefined): string[] {
	if (!pattern) return [];
	switch (pattern.type) {
		case "Identifier":
			if (typeof pattern.name !== "string") {
				throw new Error("JavaScript identifier binding is missing its name");
			}
			return [pattern.name];
		case "RestElement":
			return bindingNames(asNode(pattern.argument));
		case "AssignmentPattern":
			return bindingNames(asNode(pattern.left));
		case "ArrayPattern":
			return nodes(pattern.elements).flatMap(bindingNames);
		case "ObjectPattern":
			return nodes(pattern.properties).flatMap((property) =>
				property.type === "RestElement"
					? bindingNames(asNode(property.argument))
					: bindingNames(asNode(property.value)),
			);
		default:
			throw new Error(
				`Unsupported JavaScript binding pattern: ${pattern.type}`,
			);
	}
}

function ownerExports(
	ownerNode: JavaScriptNode,
	ancestors: JavaScriptNode[],
	ownerName: string | undefined,
	exportsByBinding: ReadonlyMap<string, ReadonlySet<JavaScriptExportKind>>,
): JavaScriptExportKind[] {
	const kinds = new Set(ownerName ? exportsByBinding.get(ownerName) : []);
	for (const ancestor of ancestors) {
		if (
			ancestor.type === "ExportDefaultDeclaration" &&
			asNode(ancestor.declaration) === ownerNode
		) {
			kinds.add("default");
		}
	}
	return [...kinds].sort(compareExportKinds);
}

function compareExportKinds(
	left: JavaScriptExportKind,
	right: JavaScriptExportKind,
): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function isFunctionNode(node: JavaScriptNode): boolean {
	return (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	);
}

function functionOwnerName(
	node: JavaScriptNode,
	parent: JavaScriptNode | undefined,
): {
	kind: "function" | "method" | "anonymousFunction";
	name?: string;
} {
	const declaredName = identifierName(asNode(node.id));
	if (declaredName) return { kind: "function", name: declaredName };
	if (parent?.type === "VariableDeclarator") {
		const name = identifierName(asNode(parent.id));
		if (name) return { kind: "function", name };
	}
	if (parent?.type === "MethodDefinition" || parent?.type === "Property") {
		return { kind: "method", name: propertyName(asNode(parent.key)) };
	}
	if (parent?.type === "AssignmentExpression") {
		const left = asNode(parent.left);
		const name = identifierName(left) ?? (left ? memberName(left) : undefined);
		if (name) return { kind: "function", name };
	}
	return { kind: "anonymousFunction" };
}

function propertyName(node: JavaScriptNode | undefined): string | undefined {
	return identifierName(node) ?? staticString(node);
}

function staticString(node: JavaScriptNode | undefined): string | undefined {
	if (!node) return undefined;
	if (node.type === "Literal" && typeof node.value === "string")
		return node.value;
	if (node.type === "TemplateLiteral" && nodes(node.expressions).length === 0) {
		const quasi = nodes(node.quasis)[0];
		const cooked = quasi?.value;
		if (
			cooked &&
			typeof cooked === "object" &&
			"cooked" in cooked &&
			typeof cooked.cooked === "string"
		)
			return cooked.cooked;
	}
	return undefined;
}

function memberName(node: JavaScriptNode): string | undefined {
	if (node.type !== "MemberExpression") return undefined;
	return node.computed
		? staticString(asNode(node.property))
		: identifierName(node.property);
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

function datasetAttributeName(key: string): string {
	return `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function isWriteAccess(
	node: JavaScriptNode,
	parent: JavaScriptNode | undefined,
): boolean {
	if (!parent) return false;
	if (parent.type === "AssignmentExpression" && asNode(parent.left) === node)
		return true;
	if (parent.type === "UpdateExpression" && asNode(parent.argument) === node)
		return true;
	return parent.type === "UnaryExpression" && parent.operator === "delete";
}

function localModulePath(
	fromPath: string,
	moduleName: string,
): string | undefined {
	const withoutQuery = moduleName.split(/[?#]/, 1)[0];
	if (!withoutQuery) return undefined;
	const target = moduleName.startsWith("/assets/")
		? withoutQuery.slice(1)
		: moduleName.startsWith(".")
			? posix.normalize(posix.join(posix.dirname(fromPath), withoutQuery))
			: undefined;
	return target?.startsWith("assets/") ? target : undefined;
}
