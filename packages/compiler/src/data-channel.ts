// The typed data channel: data-* attributes on ref'd elements, bound to
// prop expressions, become a per-ref contract the script reads as
// data.<ref>.<property>. This module resolves bindings against prop
// declarations once; the script checker, the emitter (runtime parse
// descriptor), and the check pass all consume the same resolution.
import type { ArtifactIR, SemanticType } from "@nazare/core";

export type DataBindingKind = "string" | "number" | "boolean";

export type ResolvedDataBinding = {
	property: string;
	kind: DataBindingKind;
	optional: boolean;
};

export type DataBindingResolution = ResolvedDataBinding & {
	/** True when the semantic type maps to exactly one runtime parse kind. */
	checked: boolean;
};

export type DataChannel = Map<string, Map<string, ResolvedDataBinding>>;

export function dataChannelFromIR(ir: ArtifactIR): DataChannel {
	const propTypes = new Map<string, SemanticType>();
	for (const node of ir.syntax) {
		if (node.kind === "prop-declaration") {
			propTypes.set(`props.${node.name}`, node.typeInfo.valueType);
		}
	}

	const channel: DataChannel = new Map();
	for (const node of ir.syntax) {
		if (node.kind !== "element-ref") continue;
		for (const binding of node.dataBindings ?? []) {
			const type = propTypes.get(binding.expression.trim());
			const resolution = resolveDataBinding(binding.property, type);
			const resolved: ResolvedDataBinding = {
				property: resolution.property,
				kind: resolution.kind,
				optional: resolution.optional,
			};
			let refEntry = channel.get(node.name);
			if (!refEntry) {
				refEntry = new Map();
				channel.set(node.name, refEntry);
			}
			refEntry.set(binding.property, resolved);
		}
	}

	return channel;
}

export function resolveDataBinding(
	property: string,
	type: SemanticType | undefined,
): DataBindingResolution {
	if (!type) {
		return { property, kind: "string", optional: false, checked: false };
	}

	if (type.kind === "union") {
		const valueMembers = type.members.filter((member) => member.kind !== "nil");
		const optional = valueMembers.length !== type.members.length;
		const kinds = valueMembers.map(parseKindForType);
		const [firstKind] = kinds;
		const checked =
			firstKind !== undefined &&
			isDataBindingKind(firstKind) &&
			kinds.every((kind) => kind === firstKind);
		return {
			property,
			kind: checked ? firstKind : "string",
			optional,
			checked,
		};
	}

	const kind = parseKindForType(type);
	return {
		property,
		kind: isDataBindingKind(kind) ? kind : "string",
		optional: false,
		checked: isDataBindingKind(kind),
	};
}

function parseKindForType(
	type: SemanticType,
): DataBindingKind | "unknown" | "unsupported" {
	if (type.kind === "number" || type.kind === "number-literal") return "number";
	if (type.kind === "boolean") return "boolean";
	if (
		type.kind === "string" ||
		type.kind === "string-literal" ||
		type.kind === "url" ||
		type.kind === "color" ||
		type.kind === "richtext" ||
		type.kind === "handle" ||
		type.kind === "money"
	) {
		return "string";
	}
	if (type.kind === "literal") return parseKindForLiteralValue(type.value);
	if (type.kind === "unknown") return "unknown";
	return "unsupported";
}

function parseKindForLiteralValue(
	value: unknown,
): DataBindingKind | "unsupported" {
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	if (typeof value === "boolean") return "boolean";
	return "unsupported";
}

function isDataBindingKind(kind: string | undefined): kind is DataBindingKind {
	return kind === "string" || kind === "number" || kind === "boolean";
}
