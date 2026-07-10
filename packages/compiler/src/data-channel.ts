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
			const resolved = resolveBinding(binding.property, type);
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

function resolveBinding(
	property: string,
	type: SemanticType | undefined,
): ResolvedDataBinding {
	// Attributes are strings; a non-prop or unknown-typed binding reads as one.
	if (!type) return { property, kind: "string", optional: false };

	const optional =
		type.kind === "union" &&
		type.members.some((member) => member.kind === "nil");
	const inner =
		type.kind === "union"
			? (type.members.find((member) => member.kind !== "nil") ?? type)
			: type;

	return { property, kind: kindFor(inner), optional };
}

function kindFor(type: SemanticType): DataBindingKind {
	if (type.kind === "number" || type.kind === "number-literal") return "number";
	if (type.kind === "boolean") return "boolean";
	return "string";
}
