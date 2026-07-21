// The assignability relation between SemanticTypes, plus value-level
// validation of known literals (ranges, url/color/handle shapes). check.ts
// consumes this; nothing else defines type compatibility.
import type { SemanticType } from "@nazare/core";
import { cssColorKeywords } from "./css-color-keywords.js";

export function isAssignable(
	from: SemanticType | undefined,
	to: SemanticType | undefined,
): boolean {
	if (!from || !to) return true;
	if (from.kind === "unknown" || to.kind === "unknown") return true;
	if (to.kind === "union") {
		return to.members.some((member) => isAssignable(from, member));
	}
	if (from.kind === "union") {
		return from.members.every((member) => isAssignable(member, to));
	}
	if (from.kind === "string-literal" && to.kind === "string-literal") {
		return from.value === to.value;
	}
	if (from.kind === "number-literal" && to.kind === "number-literal") {
		return from.value === to.value;
	}
	if (from.kind === "string-literal" && to.kind === "string") return true;
	if (from.kind === "string-literal" && acceptsValidatedStringLiteral(to))
		return true;
	if (from.kind === "number-literal" && to.kind === "number") return true;
	if (from.kind === "array" && to.kind === "array") {
		return isAssignable(from.element, to.element);
	}
	if (from.kind === "function" && to.kind === "function") {
		return isAssignable(from.returns, to.returns);
	}
	if (from.kind === "object" && to.kind === "object") {
		return isObjectAssignable(from, to);
	}
	return from.kind === to.kind;
}

function acceptsValidatedStringLiteral(type: SemanticType): boolean {
	return type.kind === "url" || type.kind === "color" || type.kind === "handle";
}

/**
 * Object assignability is nominal when both sides are named (names must match,
 * fields are not compared — a name is a claim about identity, not shape) and
 * structural otherwise: a field-less target accepts any object, a field-less
 * source satisfies no fielded target, and fielded pairs compare field-wise.
 */
function isObjectAssignable(
	from: Extract<SemanticType, { kind: "object" }>,
	to: Extract<SemanticType, { kind: "object" }>,
): boolean {
	if (from.name && to.name) return from.name === to.name;
	if (!to.fields) return true;
	if (!from.fields) return false;
	return Object.entries(to.fields).every(([fieldName, fieldType]) =>
		isAssignable(from.fields?.[fieldName], fieldType),
	);
}

/**
 * Checks a known literal value against the constraints of the target type.
 * Returns the reason the value is rejected, or undefined when the value is
 * accepted by at least one (possibly unconstrained) member.
 */
export function literalValueViolation(
	literal: SemanticType | undefined,
	target: SemanticType,
): string | undefined {
	if (!literal) return undefined;
	if (target.kind === "union") {
		let firstViolation: string | undefined;
		for (const member of target.members) {
			if (!isAssignable(literal, member)) continue;
			const violation = literalValueViolation(literal, member);
			if (violation === undefined) return undefined;
			firstViolation ??= violation;
		}
		return firstViolation;
	}
	if (literal.kind === "number-literal") {
		return rangeViolation(literal.value, target);
	}
	if (literal.kind !== "string-literal") return undefined;
	if (target.kind === "url") return validateUrlLiteral(literal.value);
	if (target.kind === "color") return validateColorLiteral(literal.value);
	if (target.kind === "handle") return validateHandleLiteral(literal.value);
	return undefined;
}

function validateUrlLiteral(value: string): string | undefined {
	return value.trim() === "" ? "expected a non-empty URL or path" : undefined;
}

function validateColorLiteral(value: string): string | undefined {
	const trimmed = value.trim();
	if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)) {
		return undefined;
	}
	if (
		/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^)]*\)$/.test(
			trimmed,
		)
	) {
		return undefined;
	}
	if (/^var\(--[A-Za-z0-9_-]+\)$/.test(trimmed)) return undefined;
	if (cssColorKeywords.has(trimmed.toLowerCase())) return undefined;
	return "expected a CSS color literal";
}

function validateHandleLiteral(value: string): string | undefined {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
		? undefined
		: "expected a Shopify handle slug like product-handle";
}

function rangeViolation(
	value: number,
	target: SemanticType,
): string | undefined {
	const numberMembers =
		target.kind === "number"
			? [target]
			: target.kind === "union"
				? target.members.filter((member) => member.kind === "number")
				: [];
	if (numberMembers.length === 0) return undefined;

	let reason: string | undefined;
	for (const member of numberMembers) {
		const constraints = member.constraints;
		if (!constraints) return undefined;
		if (constraints.min !== undefined && value < constraints.min) {
			reason ??= `below minimum ${constraints.min}`;
			continue;
		}
		if (constraints.max !== undefined && value > constraints.max) {
			reason ??= `above maximum ${constraints.max}`;
			continue;
		}
		if (constraints.step !== undefined && constraints.step > 0) {
			const offset = value - (constraints.min ?? 0);
			const remainder = Math.abs(offset % constraints.step);
			if (remainder > 1e-9 && constraints.step - remainder > 1e-9) {
				reason ??= `not aligned to step ${constraints.step}`;
				continue;
			}
		}
		return undefined;
	}

	return reason;
}
