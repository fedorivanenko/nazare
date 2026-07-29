import { posix } from "node:path";
import type { Diagnostic } from "@nazare/core";
import selectorParser from "postcss-selector-parser";
import {
	type JavaScriptNode,
	parseJavaScript,
	walkJavaScript,
} from "../javascript-ast.js";
import { spanFromOffsets } from "../source.js";
import type { ThemeFact } from "../theme-facts.js";
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

	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = [];
	const uncertainty: ThemeSourceUncertainty[] = [];
	walkJavaScript(program, (node, parent) => {
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
		if (node.type === "MemberExpression") analyzeDatasetAccess(node, parent);
		if (node.type === "CallExpression") analyzeCall(node);
	});
	return { facts, issues, uncertainty };

	function analyzeCall(call: JavaScriptNode): void {
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
					pushDom("class", hook.value, "queries", call),
				);
				root.walkIds((hook) => pushDom("id", hook.value, "queries", call));
				root.walkAttributes((hook) => {
					if (hook.attribute)
						pushDom("attribute", hook.attribute, "queries", call);
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
			} else pushDom("id", id, "queries", call);
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
				} else pushDom("class", className, "mutates", argument);
			}
			return;
		}
		if (method === "addEventListener") {
			pushEvent("listens", staticString(args[0]), call);
			return;
		}
		if (method === "dispatchEvent") {
			const argument = args[0];
			const eventName =
				argument?.type === "NewExpression"
					? staticString(nodes(argument.arguments)[0])
					: undefined;
			pushEvent("dispatches", eventName, call);
			return;
		}
		if (method === "define" && identifierName(target) === "customElements") {
			pushCustomElement(staticString(args[0]), call);
		}
	}

	function analyzeDatasetAccess(
		access: JavaScriptNode,
		parent: JavaScriptNode | undefined,
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
		});
	}

	function pushEvent(
		operation: "dispatches" | "listens",
		name: string | undefined,
		node: JavaScriptNode,
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
		});
	}

	function pushCustomElement(
		name: string | undefined,
		node: JavaScriptNode,
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
		});
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
