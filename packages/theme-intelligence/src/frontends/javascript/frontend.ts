import type {
	JavaScriptDocument,
	JavaScriptNode,
} from "../../parsers/javascript/parser.js";
import type { SourceAnchor, SourceRange } from "../../semantic/evidence.js";
import {
	defineFrontend,
	type FrontendBoundary,
	type FrontendDiagnostic,
} from "../frontend.js";
import {
	JAVASCRIPT_MECHANICAL_FACT_KINDS,
	type JavaScriptClassListOperationFact,
	type JavaScriptFact,
} from "./facts.js";
import { javaScriptMechanicalOntology } from "./ontology.js";

const FRONTEND_ID = "acorn-class-list-operations";
const FRONTEND_VERSION = 1;
const COVERAGE_FAMILY = "javascript.class-list-operations";

export const javaScriptFrontend = defineFrontend<
	JavaScriptDocument,
	JavaScriptFact
>({
	id: FRONTEND_ID,
	version: FRONTEND_VERSION,
	languages: ["javascript"],
	ontology: {
		namespace: javaScriptMechanicalOntology.namespace,
		version: javaScriptMechanicalOntology.version,
	},
	factKinds: JAVASCRIPT_MECHANICAL_FACT_KINDS,
	extract({ document, limits }) {
		const facts: JavaScriptFact[] = [];
		const diagnostics: FrontendDiagnostic[] = [];
		const boundaries: FrontendBoundary[] = [];
		const boundaryKeys = new Set<string>();
		const stack: JavaScriptNode[] = [document.syntax as JavaScriptNode];
		let visited = 0;
		let boundarySequence = 0;
		let exhausted = false;

		while (stack.length > 0 && !exhausted) {
			const node = stack.pop();
			if (!node) break;
			if (visited >= Math.max(0, limits.maxWork)) {
				exhaust(nodeRange(node), "JavaScript frontend work budget exhausted");
				break;
			}
			visited += 1;
			if (node.type === "CallExpression") processCall(node);
			const children = childNodes(node);
			for (let index = children.length - 1; index >= 0; index -= 1) {
				const child = children[index];
				if (child) stack.push(child);
			}
		}

		return {
			path: document.path,
			language: document.language,
			frontend: { id: FRONTEND_ID, version: FRONTEND_VERSION },
			facts,
			diagnostics,
			boundaries,
			coverage: [
				{
					family: COVERAGE_FAMILY,
					status: boundaries.length === 0 ? "complete" : "partial",
					boundaryIds: boundaries.map(({ id }) => id),
				},
			],
			work: { visited, emitted: facts.length },
		};

		function processCall(call: JavaScriptNode): void {
			const callee = unwrap(call.callee);
			if (!isNode(callee) || callee.type !== "MemberExpression") return;
			const classList = unwrap(callee.object);
			if (!isClassListMember(classList)) return;
			const method = staticMemberName(callee);
			if (!method) {
				addBoundary(
					"dynamic-syntax",
					"Computed classList method cannot be resolved statically",
					nodeRange(callee),
				);
				return;
			}
			const argumentsList = Array.isArray(call.arguments)
				? call.arguments.filter(isNode)
				: [];
			const actions = operationArguments(method, argumentsList);
			if (!actions) return;
			for (const { action, argument } of actions) {
				const value = staticClassName(argument);
				if (!value) {
					addBoundary(
						"dynamic-syntax",
						`classList.${method} class name requires runtime evaluation`,
						nodeRange(argument),
					);
					continue;
				}
				if (value.name.length === 0 || /\s/u.test(value.name)) {
					addBoundary(
						"unsupported-syntax",
						`classList.${method} requires one non-empty class token`,
						value.range,
					);
					continue;
				}
				emit({
					kind: "javascript.class-list-operation",
					evidence: anchor(nodeRange(call)),
					action,
					name: value.name,
					nameEvidence: anchor(value.range),
					operationEvidence: anchor(nodeRange(call)),
				});
			}
		}

		function emit(fact: JavaScriptClassListOperationFact): void {
			if (facts.length >= Math.max(0, limits.maxFacts)) {
				exhaust(
					fact.evidence.range,
					"JavaScript frontend fact budget exhausted",
				);
				return;
			}
			facts.push(fact);
		}

		function exhaust(range: SourceRange, message: string): void {
			exhausted = true;
			addBoundary("budget", message, range);
		}

		function addBoundary(
			kind: FrontendBoundary["kind"],
			message: string,
			range: SourceRange,
		): void {
			const key = `${kind}\0${message}\0${range.start}\0${range.end}`;
			if (boundaryKeys.has(key)) return;
			boundaryKeys.add(key);
			boundarySequence += 1;
			boundaries.push({
				id: `javascript-boundary-${boundarySequence}`,
				kind,
				message,
				range,
			});
		}

		function anchor(range: SourceRange): SourceAnchor {
			return { path: document.path, range };
		}

		function staticClassName(
			node: JavaScriptNode,
		): { name: string; range: SourceRange } | undefined {
			if (node.type === "Literal" && typeof node.value === "string") {
				return {
					name: node.value,
					range: stringContentRange(node, document.source),
				};
			}
			if (
				node.type === "TemplateLiteral" &&
				Array.isArray(node.expressions) &&
				node.expressions.length === 0 &&
				Array.isArray(node.quasis) &&
				node.quasis.length === 1
			) {
				const quasi = node.quasis[0] as JavaScriptNode | undefined;
				const value = quasi?.value;
				if (
					isNode(quasi) &&
					value &&
					typeof value === "object" &&
					typeof (value as { cooked?: unknown }).cooked === "string"
				) {
					return {
						name: (value as { cooked: string }).cooked,
						range: { start: node.start + 1, end: node.end - 1 },
					};
				}
			}
			return undefined;
		}
	},
});

type ClassAction = JavaScriptClassListOperationFact["action"];

function operationArguments(
	method: string,
	argumentsList: readonly JavaScriptNode[],
): readonly { action: ClassAction; argument: JavaScriptNode }[] | undefined {
	switch (method) {
		case "add":
			return argumentsList.map((argument) => ({ action: "adds", argument }));
		case "remove":
			return argumentsList.map((argument) => ({ action: "removes", argument }));
		case "toggle":
			return argumentsList[0]
				? [{ action: "toggles", argument: argumentsList[0] }]
				: [];
		case "contains":
			return argumentsList[0]
				? [{ action: "reads", argument: argumentsList[0] }]
				: [];
		case "replace":
			return [
				...(argumentsList[0]
					? [{ action: "removes" as const, argument: argumentsList[0] }]
					: []),
				...(argumentsList[1]
					? [{ action: "adds" as const, argument: argumentsList[1] }]
					: []),
			];
		default:
			return undefined;
	}
}

function isClassListMember(value: unknown): value is JavaScriptNode {
	const node = unwrap(value);
	return (
		isNode(node) &&
		node.type === "MemberExpression" &&
		staticMemberName(node) === "classList"
	);
}

function staticMemberName(node: JavaScriptNode): string | undefined {
	if (node.type !== "MemberExpression") return undefined;
	const property = unwrap(node.property);
	if (!isNode(property)) return undefined;
	if (node.computed === false && property.type === "Identifier") {
		return typeof property.name === "string" ? property.name : undefined;
	}
	if (node.computed === true && property.type === "Literal") {
		return typeof property.value === "string" ? property.value : undefined;
	}
	return undefined;
}

function unwrap(value: unknown): unknown {
	let candidate = value;
	while (
		isNode(candidate) &&
		(candidate.type === "ChainExpression" ||
			candidate.type === "ParenthesizedExpression")
	) {
		candidate = candidate.expression;
	}
	return candidate;
}

function childNodes(node: JavaScriptNode): JavaScriptNode[] {
	const children: JavaScriptNode[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (["start", "end", "loc", "range"].includes(key)) continue;
		if (isNode(value)) children.push(value);
		else if (Array.isArray(value)) {
			for (const item of value) if (isNode(item)) children.push(item);
		}
	}
	return children.sort((left, right) => left.start - right.start);
}

function isNode(value: unknown): value is JavaScriptNode {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { type?: unknown }).type === "string" &&
		typeof (value as { start?: unknown }).start === "number" &&
		typeof (value as { end?: unknown }).end === "number"
	);
}

function nodeRange(node: JavaScriptNode): SourceRange {
	return { start: node.start, end: node.end };
}

function stringContentRange(node: JavaScriptNode, source: string): SourceRange {
	const raw = source.slice(node.start, node.end);
	const quoted =
		raw.length >= 2 &&
		((raw.startsWith('"') && raw.endsWith('"')) ||
			(raw.startsWith("'") && raw.endsWith("'")));
	return quoted
		? { start: node.start + 1, end: node.end - 1 }
		: nodeRange(node);
}
