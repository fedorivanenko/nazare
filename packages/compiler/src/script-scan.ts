// AST-based scanning of JavaScript behavior scripts. Parse-only: component
// scripts currently support JavaScript, not TypeScript or type checking.
import type { Program } from "acorn";
import { type JavaScriptNode, walkJavaScript } from "./javascript-ast.js";

export type ScannedRefAccess = {
	name: string;
	start: number;
	end: number;
};

export type ScannedDataAccess = {
	ref: string;
	property: string;
	start: number;
	end: number;
};

export type ScriptScan = {
	refAccesses: ScannedRefAccess[];
	dataAccesses: ScannedDataAccess[];
};

export type ReservedContextShadow = {
	name: "refs" | "data";
	start: number;
	end: number;
};

export function scanScript(program: Program): ScriptScan {
	const refAccesses: ScannedRefAccess[] = [];
	const dataAccesses: ScannedDataAccess[] = [];

	walkJavaScript(program, (node) => {
		if (node.type !== "MemberExpression" || node.computed) return;
		const object = asNode(node.object);
		const property = identifierName(node.property);
		if (!object || !property) return;
		if (identifierName(object) === "refs") {
			refAccesses.push({ name: property, start: node.start, end: node.end });
		}
		if (object.type !== "MemberExpression" || object.computed) return;
		const base = asNode(object.object);
		const ref = identifierName(object.property);
		if (identifierName(base) === "data" && ref) {
			dataAccesses.push({ ref, property, start: node.start, end: node.end });
		}
	});

	return { refAccesses, dataAccesses };
}

export function findReservedContextShadows(
	program: Program,
): ReservedContextShadow[] {
	const shadows: ReservedContextShadow[] = [];
	const recordBinding = (node: JavaScriptNode | undefined): void => {
		if (!node) return;
		const name = identifierName(node);
		if (name === "refs" || name === "data") {
			shadows.push({ name, start: node.start, end: node.end });
			return;
		}
		if (node.type === "ObjectPattern" || node.type === "ArrayPattern") {
			for (const child of array(
				node.type === "ObjectPattern" ? node.properties : node.elements,
			)) {
				const pattern = asNode(child);
				if (!pattern) continue;
				recordBinding(
					pattern.type === "Property" ? asNode(pattern.value) : pattern,
				);
			}
		}
		if (node.type === "AssignmentPattern") recordBinding(asNode(node.left));
		if (node.type === "RestElement") recordBinding(asNode(node.argument));
	};

	walkJavaScript(program, (node) => {
		if (node.type === "VariableDeclarator") recordBinding(asNode(node.id));
		if (
			node.type === "FunctionDeclaration" ||
			node.type === "FunctionExpression" ||
			node.type === "ArrowFunctionExpression"
		) {
			recordBinding(asNode(node.id));
		}
	});
	return shadows;
}

export function hasDefaultExport(program: Program): boolean {
	return array(program.body).some(
		(statement) => asNode(statement)?.type === "ExportDefaultDeclaration",
	);
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

function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error("JavaScript AST expected a child-node array");
	}
	return value;
}
