import { posix } from "node:path";
import type { Diagnostic } from "@nazare/core";
import selectorParser from "postcss-selector-parser";
import ts from "typescript";
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
	language: "javascript" | "typescript",
): ThemeScriptAnalysis {
	const sourceFile = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		language === "typescript" ? ts.ScriptKind.TS : ts.ScriptKind.JS,
	);
	const parseDiagnostics = (
		sourceFile as ts.SourceFile & {
			parseDiagnostics: readonly ts.DiagnosticWithLocation[];
		}
	).parseDiagnostics;
	const issues = parseDiagnostics.map(
		(diagnostic): Diagnostic => ({
			severity: "error",
			code: "THEME_SCRIPT_PARSE_ERROR",
			message: `Invalid ${language === "typescript" ? "TypeScript" : "JavaScript"} in ${path}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
			phase: "parse",
			span: spanFromOffsets(source, path, {
				start: diagnostic.start,
				end: diagnostic.start + diagnostic.length,
			}),
		}),
	);
	if (issues.length > 0) return { facts: [], issues, uncertainty: [] };

	const facts: ThemeFact[] = [];
	const uncertainty: ThemeSourceUncertainty[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isImportDeclaration(node)) {
			analyzeModuleSpecifier(node.moduleSpecifier);
		} else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
			analyzeModuleSpecifier(node.moduleSpecifier);
		} else if (
			ts.isPropertyAccessExpression(node) ||
			ts.isElementAccessExpression(node)
		) {
			analyzeDatasetAccess(node);
		}
		if (ts.isCallExpression(node)) analyzeCall(node);
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return { facts, issues, uncertainty };

	function analyzeCall(call: ts.CallExpression): void {
		if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
			const specifier = call.arguments[0];
			if (staticString(specifier) === undefined) {
				pushUncertainty(
					"THEME_DYNAMIC_SCRIPT_IMPORT",
					"Dynamic import path prevents complete module dependency analysis",
					call,
				);
			} else if (specifier) {
				analyzeModuleSpecifier(specifier);
			}
			return;
		}
		const access = ts.isPropertyAccessExpression(call.expression)
			? call.expression
			: undefined;
		if (!access) return;
		const method = access.name.text;
		if (
			["querySelector", "querySelectorAll", "matches", "closest"].includes(
				method,
			)
		) {
			const selector = staticString(call.arguments[0]);
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
			const attribute = staticString(call.arguments[0]);
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
			const id = staticString(call.arguments[0]);
			if (id === undefined) {
				pushUncertainty(
					"THEME_DYNAMIC_ELEMENT_ID",
					"Dynamic getElementById argument prevents complete DOM hook analysis",
					call,
				);
			} else {
				pushDom("id", id, "queries", call);
			}
			return;
		}
		if (
			["add", "remove", "toggle", "replace"].includes(method) &&
			ts.isPropertyAccessExpression(access.expression) &&
			access.expression.name.text === "classList"
		) {
			for (const argument of call.arguments) {
				const className = staticString(argument);
				if (className === undefined) {
					pushUncertainty(
						"THEME_DYNAMIC_CLASS_MUTATION",
						`Dynamic classList.${method} argument prevents complete DOM hook analysis`,
						argument,
					);
				} else {
					pushDom("class", className, "mutates", argument);
				}
			}
			return;
		}
		if (method === "addEventListener") {
			pushEvent("listens", staticString(call.arguments[0]), call);
			return;
		}
		if (method === "dispatchEvent") {
			const argument = call.arguments[0];
			const eventName =
				argument && ts.isNewExpression(argument)
					? staticString(argument.arguments?.[0])
					: undefined;
			pushEvent("dispatches", eventName, call);
			return;
		}
		if (
			method === "define" &&
			access.expression.getText(sourceFile) === "customElements"
		) {
			pushCustomElement(staticString(call.arguments[0]), call);
		}
	}

	function analyzeDatasetAccess(
		access: ts.PropertyAccessExpression | ts.ElementAccessExpression,
	): void {
		const target = access.expression;
		if (
			!ts.isPropertyAccessExpression(target) ||
			target.name.text !== "dataset"
		) {
			return;
		}
		const key = ts.isPropertyAccessExpression(access)
			? access.name.text
			: staticString(access.argumentExpression);
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
			isWriteAccess(access) ? "mutates" : "queries",
			access,
		);
	}

	function analyzeModuleSpecifier(specifier: ts.Expression): void {
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
		node: ts.Node,
	): void {
		facts.push({
			kind: "behavior",
			fromPath: path,
			subjectKind: "domHook",
			hookKind,
			operation,
			name,
			span: nodeSpan(node),
			extractor: "typescript-ast",
		});
	}

	function pushEvent(
		operation: "dispatches" | "listens",
		name: string | undefined,
		node: ts.Node,
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
			extractor: "typescript-ast",
		});
	}

	function pushCustomElement(name: string | undefined, node: ts.Node): void {
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
			extractor: "typescript-ast",
		});
	}

	function pushUncertainty(code: string, message: string, node: ts.Node): void {
		uncertainty.push({ code, message, span: nodeSpan(node) });
	}

	function nodeSpan(node: ts.Node) {
		return spanFromOffsets(source, path, {
			start: node.getStart(sourceFile),
			end: node.getEnd(),
		});
	}
}

function staticString(node: ts.Expression | undefined): string | undefined {
	if (!node) return undefined;
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
		return node.text;
	}
	return undefined;
}

function datasetAttributeName(key: string): string {
	return `data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
}

function isWriteAccess(node: ts.Node): boolean {
	const parent = node.parent;
	if (
		ts.isBinaryExpression(parent) &&
		parent.left === node &&
		parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
		parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
	) {
		return true;
	}
	if (ts.isDeleteExpression(parent)) return true;
	return (
		(ts.isPrefixUnaryExpression(parent) ||
			ts.isPostfixUnaryExpression(parent)) &&
		(parent.operator === ts.SyntaxKind.PlusPlusToken ||
			parent.operator === ts.SyntaxKind.MinusMinusToken)
	);
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
