// Stories, checked against the interface the component declares.
//
// A story is a call. Liquid does not complain about a call that passes a prop
// the template never reads, or omits one it does — the value is simply nil, the
// markup is simply missing, and the story looks plausible. That is the failure
// this catches: not a render that threw, which is already reported, but one
// that rendered something wrong and said nothing.
//
// The interface belongs to the Liquid and the story owns only values, so a
// mismatch is unambiguous: the story is asserting something the declaration
// denies, and there is no reading where that was meant. These are errors, and
// they are checkable in both directions — a story that misspells a prop fails,
// and a template that renames one breaks its stories loudly instead of quietly
// rendering nil.
//
// Only what the component declares is checked. A plain snippet with no
// `{% doc %}` block declares nothing, so nothing here can be said about it —
// silence, rather than inventing an interface from the template's body.
import type { PreviewComponent } from "./component.js";
import type { PreviewControl } from "./controls.js";
import type { PreviewStory } from "./stories.js";

export type StoryIssue = {
	/**
	 * Every check here is an error: the story contradicts the declaration. The
	 * union stays because the shells style both, and a check that is genuinely
	 * advisory would belong under "warning" rather than under a new mechanism.
	 */
	severity: "error" | "warning";
	/** The prop this is about, when it is about one. */
	prop?: string;
	message: string;
};

/** A `{ $file: "…" }` that resolveFixtures left alone: the path did not read. */
const isUnresolvedFixture = (value: unknown): boolean =>
	typeof value === "object" &&
	value !== null &&
	"$file" in (value as Record<string, unknown>);

/**
 * Whether a value could be what the control asks for. Deliberately loose:
 * Liquid is loosely typed and a story that passes "3" where a number is
 * declared works fine on a storefront, so only a value that cannot be the
 * declared thing is worth a word.
 */
function typeMismatch(
	control: PreviewControl,
	value: unknown,
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (control.options && !control.options.includes(String(value))) {
		return `is "${String(value)}", which the type does not admit: ${control.options
			.map((option) => `"${option}"`)
			.join(", ")}`;
	}
	if (control.kind === "boolean" && typeof value !== "boolean") {
		return `is ${JSON.stringify(value)}, and the prop is a boolean`;
	}
	if (
		control.kind === "number" &&
		typeof value !== "number" &&
		Number.isNaN(Number(value))
	) {
		return `is ${JSON.stringify(value)}, and the prop is a number`;
	}
	if (control.kind === "number" && typeof value === "number" && control.range) {
		const { min, max } = control.range;
		if (
			(min !== undefined && value < min) ||
			(max !== undefined && value > max)
		) {
			return `is ${value}, outside the declared range ${min ?? "−∞"}–${max ?? "∞"}`;
		}
	}
	return undefined;
}

/**
 * What is wrong with this story, given what the component declares. Reported,
 * not thrown: a story that trips one still renders, and seeing what it renders
 * is how you judge how much the mismatch matters.
 */
export function validateStory(
	component: PreviewComponent,
	story: PreviewStory,
): StoryIssue[] {
	// Nothing declared, nothing to check — see the note at the top.
	if (component.controls.length === 0) return [];
	const byName = new Map(
		component.controls.map((control) => [control.name, control]),
	);
	const issues: StoryIssue[] = [];

	for (const [name, value] of Object.entries(story.props)) {
		if (isUnresolvedFixture(value)) {
			issues.push({
				severity: "error",
				prop: name,
				message: `${name} points at a file that does not read: ${
					(value as { $file?: unknown }).$file
				}`,
			});
			continue;
		}
		const control = byName.get(name);
		if (!control) {
			issues.push({
				severity: "error",
				prop: name,
				// The likeliest cause is a typo, and a typo'd prop is nil on render.
				message: `${name} is not a declared prop, so the template never reads it`,
			});
			continue;
		}
		const mismatch = typeMismatch(control, value);
		if (mismatch) {
			issues.push({
				severity: "error",
				prop: name,
				message: `${name} ${mismatch}`,
			});
		}
	}

	// Required is checked against what the story itself states, not against the
	// merged props: a control is only `required` when the declaration gives it no
	// default, so the value it would otherwise merge in is the preview's
	// type-shaped placeholder — a button whose label reads "label". An explicit
	// null is the story declining to pass it.
	for (const control of component.controls) {
		if (!control.required) continue;
		if (control.name in story.props && story.props[control.name] !== null) {
			continue;
		}
		issues.push({
			severity: "error",
			prop: control.name,
			message: `${control.name} is required and this story does not pass it`,
		});
	}

	return issues;
}
