// Stories. A component's contract already says what varies about it, so the
// baseline set is derivable: one story at the defaults, then one per member of
// each enum prop. Authors add hand-written stories for the cases a type cannot
// express (an empty label, a deliberately invalid value), but they never have
// to enumerate the obvious ones.
import type { NazareManifest } from "@nazare/core";
import type { PreviewComponent } from "./component.js";
import { defaultProps, type PreviewControl } from "./controls.js";
import { resolveFixtures, usesFixtures } from "./fixtures.js";

export type PreviewStory = {
	name: string;
	props: Record<string, unknown>;
	/** Shown under the story; why this case is worth looking at. */
	note?: string;
	/** True when the story's props drew on shared storefront stand-in data. */
	fixtures?: boolean;
};

export function defaultStory(component: PreviewComponent): PreviewStory {
	return { name: "default", props: defaultProps(component.controls) };
}

/** One story per member of every select control, holding the rest at default. */
export function variantStories(component: PreviewComponent): PreviewStory[] {
	const base = defaultProps(component.controls);
	const stories: PreviewStory[] = [];
	for (const control of component.controls) {
		if (!control.options || control.options.length < 2) continue;
		for (const option of control.options) {
			// The default story already covers the value the control starts on.
			if (option === base[control.name]) continue;
			stories.push({
				name: `${control.name}: ${option}`,
				props: { ...base, [control.name]: option },
			});
		}
	}
	return stories;
}

export function generatedStories(component: PreviewComponent): PreviewStory[] {
	return [defaultStory(component), ...variantStories(component)];
}

/**
 * The stories a manifest declares, with fixture references resolved. Authored
 * stories replace the generated set rather than adding to it: an author who
 * writes them has said what is worth showing, and the derived permutations
 * would otherwise bury it.
 */
export function manifestStories(manifest: NazareManifest): PreviewStory[] {
	return (manifest.preview?.stories ?? []).map((story) => ({
		name: story.name,
		note: story.note,
		props: resolveFixtures(story.props),
		fixtures: usesFixtures(story.props),
	}));
}

/** Authored stories when the manifest has any, else the derived baseline. */
export function storiesFor(
	component: PreviewComponent,
	manifest?: NazareManifest,
): PreviewStory[] {
	const authored = manifest ? manifestStories(manifest) : [];
	return authored.length > 0 ? authored : generatedStories(component);
}

/** Controls a story overrides, for showing which knob a case turned. */
export function changedProps(
	story: PreviewStory,
	controls: PreviewControl[],
): string[] {
	const base = defaultProps(controls);
	return Object.keys(story.props).filter(
		(name) => story.props[name] !== base[name],
	);
}
