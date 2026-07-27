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
	/**
	 * The default the declaration states, and nothing else. Absent means the
	 * declaration states none — which is a fact worth being able to tell, since
	 * it is what `required` means, what a props table should print as "—", and
	 * what decides whether a story that says nothing about this prop renders
	 * with a value or with nil.
	 *
	 * This field used to hold "the default, or a value shaped like the type if
	 * there is none", with a boolean beside it saying which. One field meaning
	 * two things is how `class="… class"` and a bare `attributes` reached the
	 * markup of every button in the registry. Inventing a value is a job for
	 * `scaffold`, which writes a file a person then reads.
	 */
	defaultValue?: unknown;
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

export function controlsFromContract(
	contract: ArtifactContract,
): PreviewControl[] {
	const controls: PreviewControl[] = [];
	for (const prop of contract.props) {
		const type = withoutNil(prop.typeInfo.valueType);
		const options = stringLiteralMembers(type);
		const declared =
			prop.typeInfo.defaultValue ?? prop.typeInfo.setting?.default;
		controls.push({
			name: prop.name,
			label: prop.typeInfo.setting?.label ?? prop.name,
			kind: options ? "select" : controlKind(type),
			required: prop.required && !prop.hasDefault,
			...(options ? { options } : {}),
			...(type.kind === "number" && type.constraints
				? { range: type.constraints }
				: {}),
			// Only `.default(v)` and a setting's `default` are the declaration
			// speaking. The first member of an enum is a guess like any other.
			...(declared !== undefined ? { defaultValue: declared } : {}),
			typeExpression: prop.typeExpression,
		});
	}
	return controls;
}

/**
 * The props the declaration itself supplies — what a partial story falls
 * through to, and what it renders with when it says nothing.
 *
 * A prop the declaration gives no default for is absent here, so it arrives nil
 * on render, exactly as it would on a storefront.
 */
export function declaredDefaults(
	controls: PreviewControl[],
): Record<string, unknown> {
	const props: Record<string, unknown> = {};
	for (const control of controls) {
		if (control.defaultValue !== undefined) {
			props[control.name] = control.defaultValue;
		}
	}
	return props;
}
