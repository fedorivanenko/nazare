import type {
	ArtifactIR,
	Diagnostic,
	PropDeclarationSyntaxNode,
} from "@nazare/core";
import { invalidPropDefault } from "./diagnostics.js";

export type PropDefaultValue = string | number | boolean;

export type DeclaredPropDefault = {
	name: string;
	value: PropDefaultValue;
};

export function analyzePropDefaults(ir: ArtifactIR): {
	liquidDefaults: DeclaredPropDefault[];
	issues: Diagnostic[];
} {
	const liquidDefaults: DeclaredPropDefault[] = [];
	const issues: Diagnostic[] = [];
	for (const prop of ir.syntax.filter(
		(node): node is PropDeclarationSyntaxNode =>
			node.kind === "prop-declaration",
	)) {
		const value = prop.typeInfo.defaultValue;
		if (!prop.hasDefault) {
			if (value !== undefined) {
				issues.push(
					invalidPropDefault(
						prop.name,
						prop.id,
						"typeInfo.defaultValue exists while hasDefault is false",
						prop.span,
					),
				);
			}
			continue;
		}
		if (!isPropDefaultValue(value)) {
			issues.push(
				invalidPropDefault(
					prop.name,
					prop.id,
					"hasDefault is true, but typeInfo.defaultValue is not a string, finite number, or boolean",
					prop.span,
				),
			);
			continue;
		}
		if (!prop.typeInfo.setting) liquidDefaults.push({ name: prop.name, value });
	}
	return { liquidDefaults, issues };
}

export function emitLiquidPropDefaultPrologue(
	defaults: DeclaredPropDefault[],
): string {
	if (defaults.length === 0) return "";
	return `${defaults
		.map(
			({ name, value }) =>
				`{% if ${name} == nil %}\n  {% assign ${name} = ${liquidLiteral(value)} %}\n{% endif %}`,
		)
		.join("\n")}\n`;
}

function isPropDefaultValue(value: unknown): value is PropDefaultValue {
	return (
		typeof value === "string" ||
		typeof value === "boolean" ||
		(typeof value === "number" && Number.isFinite(value))
	);
}

function liquidLiteral(value: PropDefaultValue): string {
	if (typeof value !== "string") return String(value);
	const [first = "", ...rest] = value.split('"');
	const expression = [liquidDoubleQuotedString(first)];
	for (const segment of rest) {
		expression.push(`append: '"'`);
		if (segment)
			expression.push(`append: ${liquidDoubleQuotedString(segment)}`);
	}
	return expression.join(" | ");
}

function liquidDoubleQuotedString(value: string): string {
	return `"${value}"`;
}
