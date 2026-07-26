// Contract → controls. A Storybook story has to hand-write its argTypes; a
// Nazare component already declares them. `scheme: string.enum("solid",
// "outline", "ghost")` is a select, `number.min(0).max(10).step(1)` is a range,
// and `.setting({ label, default })` supplies the label and initial value. This
// pass reads only the contract, so it works for any component the compiler can
// compile — nothing here is component-specific.
import type {
	ArtifactContract,
	ArtifactContractProp,
	NumberConstraints,
	SemanticType,
} from "@nazare/core";

export type PreviewControl = {
	name: string;
	/** Setting label when declared, else the prop name. */
	label: string;
	kind: "select" | "text" | "url" | "color" | "richtext" | "number" | "boolean";
	required: boolean;
	/** Present for select controls: the string literals the type admits. */
	options?: string[];
	/** Present for number controls, straight from the type constraints. */
	range?: NumberConstraints;
	/** Initial value: the setting default when declared, else a type-shaped one. */
	value: unknown;
	/** The authored type expression, shown as the control's tooltip/source. */
	typeExpression: string;
};

/** Members of a union that are string literals, in declaration order. */
function stringLiteralMembers(type: SemanticType): string[] | undefined {
	if (type.kind === "string-literal") return [type.value];
	if (type.kind !== "union") return undefined;
	const values: string[] = [];
	for (const member of type.members) {
		// nil is how `.optional()` widens a type; it is not a choice to offer.
		if (member.kind === "nil") continue;
		if (member.kind !== "string-literal") return undefined;
		values.push(member.value);
	}
	return values.length > 0 ? values : undefined;
}

/** The non-nil member of an optional type, so `string.optional()` reads as text. */
function withoutNil(type: SemanticType): SemanticType {
	if (type.kind !== "union") return type;
	const members = type.members.filter((member) => member.kind !== "nil");
	if (members.length === 1) return members[0] as SemanticType;
	return { kind: "union", members };
}

function controlKind(type: SemanticType): PreviewControl["kind"] {
	switch (type.kind) {
		case "boolean":
			return "boolean";
		case "number":
		case "number-literal":
		// Money is minor units: a number to the viewer, currency on render.
		case "money":
			return "number";
		case "color":
			return "color";
		case "url":
			return "url";
		case "richtext":
			return "richtext";
		default:
			return "text";
	}
}

/**
 * A value to render with before the viewer touches anything. Declared setting
 * defaults win; otherwise the first enum member, or a value shaped like the
 * type — a story that renders nothing by default teaches nothing.
 */
function initialValue(
	prop: ArtifactContractProp,
	type: SemanticType,
	options: string[] | undefined,
): unknown {
	const declared = prop.typeInfo.defaultValue ?? prop.typeInfo.setting?.default;
	if (declared !== undefined) return declared;
	if (options) return options[0];
	switch (type.kind) {
		case "boolean":
			return false;
		case "money":
			// Minor units, like a storefront: the money filter turns this into
			// $24.00. The prop name would render as the word "price".
			return 2400;
		case "number":
			return type.constraints?.min ?? 0;
		case "number-literal":
			return type.value;
		case "string-literal":
			return type.value;
		case "url":
			return "#";
		case "color":
			return "#111111";
		case "nil":
			return undefined;
		default:
			return prop.name;
	}
}

export function controlsFromContract(
	contract: ArtifactContract,
): PreviewControl[] {
	const controls: PreviewControl[] = [];
	for (const prop of contract.props) {
		const type = withoutNil(prop.typeInfo.valueType);
		const options = stringLiteralMembers(type);
		controls.push({
			name: prop.name,
			label: prop.typeInfo.setting?.label ?? prop.name,
			kind: options ? "select" : controlKind(type),
			required: prop.required && !prop.hasDefault,
			...(options ? { options } : {}),
			...(type.kind === "number" && type.constraints
				? { range: type.constraints }
				: {}),
			value: initialValue(prop, type, options),
			typeExpression: prop.typeExpression,
		});
	}
	return controls;
}

/** The props a story starts from: every control at its initial value. */
export function defaultProps(
	controls: PreviewControl[],
): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const control of controls) {
		if (control.value !== undefined) props[control.name] = control.value;
	}
	return props;
}
