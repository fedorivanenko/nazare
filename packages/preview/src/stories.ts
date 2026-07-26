// Stories. A component's contract already says what varies about it, so the
// baseline set is derivable: one story at the defaults, then one per member of
// each enum prop. Authors add hand-written stories for the cases a type cannot
// express (an empty label, a deliberately invalid value), but they never have
// to enumerate the obvious ones.
import type { NazareManifest, NazareManifestStory } from "@nazare/core";
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
 * Where authored stories come from. A published component carries them in its
 * `nazare.json`, so they travel with the install. A theme has no manifests —
 * plain `.liquid` under `snippets/` is the whole component — so its stories live
 * in a sidecar beside the template, and both sources share this shape.
 */
export type StoryDeclaration = {
	stories?: NazareManifestStory[];
	/** Drop the derived stories and show only these. */
	replace?: boolean;
};

/** A declaration's stories, with fixture references resolved. */
export function declaredStories(
	declaration: StoryDeclaration | undefined,
): PreviewStory[] {
	return (declaration?.stories ?? []).map((story) => ({
		name: story.name,
		note: story.note,
		props: resolveFixtures(story.props),
		fixtures: usesFixtures(story.props),
	}));
}

/** The stories a manifest declares. */
export function manifestStories(manifest: NazareManifest): PreviewStory[] {
	return declaredStories(manifest.preview);
}

/** Later wins: an authored story replaces the derived one of the same name. */
function dedupeByName(stories: PreviewStory[]): PreviewStory[] {
	const byName = new Map<string, PreviewStory>();
	for (const story of stories) byName.set(story.name, story);
	return [...byName.values()];
}

/**
 * The derived stories plus the authored ones.
 *
 * Authored stories add rather than replace: writing one edge case should not
 * silently delete the enum coverage the contract already gave you. One whose
 * name matches a derived story overrides it — which is how a component states a
 * better default than the type-shaped one — and since names are unique in the
 * result, no two stories can claim the same document.
 *
 * A sidecar outranks the manifest: the file beside the template is the more
 * local statement, and it is the only one a theme can write.
 */
export function storiesFor(
	component: PreviewComponent,
	manifest?: NazareManifest,
	sidecar?: StoryDeclaration,
): PreviewStory[] {
	const declaration = sidecar?.stories?.length ? sidecar : manifest?.preview;
	const authored = declaredStories(declaration);
	if (authored.length === 0) return generatedStories(component);
	if (declaration?.replace) return dedupeByName(authored);
	return dedupeByName([...generatedStories(component), ...authored]);
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
