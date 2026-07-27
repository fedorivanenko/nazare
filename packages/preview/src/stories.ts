// Stories. A story is a named case a person chose to show, read from a story
// file — never derived at render time. The preview does not invent cases: a
// component appears in the workbench because somebody wrote stories for it, and
// what those stories claim is checkable against what the Liquid declares.
//
// The derivation that used to be the fallback still exists, as `scaffoldStories`
// — but it writes a file the author reads, edits, and commits, rather than an
// assertion the tool makes on every render. When a guess is wrong there is now
// something to fix.
import type { NazareManifest, NazareManifestStory } from "@nazare/core";
import type { PreviewComponent } from "./component.js";
import { defaultProps, type PreviewControl } from "./controls.js";
import { resolveFixtures, usesFixtures } from "./fixtures.js";
import type { StoryDeclaration } from "./story-file.js";

export type PreviewStory = {
	name: string;
	/**
	 * What this case changes, not the whole prop set. Anything unstated falls
	 * through to the default the declaration itself gives, so a story stays about
	 * its delta — which is also what makes the workbench's grouping by changed
	 * prop mean something. `null` is an explicit unset, distinct from absent.
	 */
	props: Record<string, unknown>;
	/** Shown under the story; why this case is worth looking at. */
	note?: string;
	/** True when the story's props drew on shared storefront stand-in data. */
	fixtures?: boolean;
};

/**
 * The props a story actually renders with: the declaration's defaults, with the
 * story's own values over the top.
 *
 * Merging here rather than at authoring time is what lets a story be partial,
 * and it is also load-bearing for correctness — emit does not materialize a
 * snippet prop's default, so a value the story omits would otherwise arrive nil
 * on render even though the component declares one.
 */
export function storyProps(
	story: PreviewStory,
	controls: PreviewControl[],
): Record<string, unknown> {
	const props: Record<string, unknown> = {
		...defaultProps(controls),
		...story.props,
	};
	// An explicit null is the story saying "without this one" — the prop is
	// absent on render, not the string "null".
	for (const [name, value] of Object.entries(props)) {
		if (value === null) delete props[name];
	}
	return props;
}

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
				props: { [control.name]: option },
			});
		}
	}
	return stories;
}

/**
 * A first draft of a story file, for `scaffold` to write: the defaults, then one
 * case per enum member. Not a runtime fallback — nothing renders from this until
 * an author has read it and committed the file.
 */
export function scaffoldStories(component: PreviewComponent): PreviewStory[] {
	return [defaultStory(component), ...variantStories(component)];
}

/**
 * A declaration's stories, with fixture references resolved. Takes the loose
 * shape so a hand-written `nazare.json` and a parsed sidecar both fit.
 */
export function declaredStories(
	declaration: { stories?: NazareManifestStory[] } | undefined,
): PreviewStory[] {
	return (declaration?.stories ?? []).map((story) => ({
		name: story.name,
		note: story.note,
		props: resolveFixtures(story.props ?? {}),
		fixtures: usesFixtures(story.props ?? {}),
	}));
}

/** The stories a manifest declares. */
export function manifestStories(manifest: NazareManifest): PreviewStory[] {
	return declaredStories(manifest.preview);
}

/**
 * A component's stories, or none.
 *
 * None means the component does not appear: a story file is what publishes a
 * template to the workbench, so a theme's 130 helper snippets stay out of the
 * sidebar until somebody decides one is worth showing.
 *
 * A sidecar outranks the manifest: the file beside the template is the more
 * local statement, and it is the only one a theme can write.
 */
export function storiesFor(sources: {
	manifest?: NazareManifest;
	sidecar?: StoryDeclaration;
}): PreviewStory[] {
	const declaration = sources.sidecar?.stories?.length
		? sources.sidecar
		: sources.manifest?.preview;
	return declaredStories(declaration);
}

/** Props this story states, for showing which knob a case turned. */
export function changedProps(
	story: PreviewStory,
	controls: PreviewControl[],
): string[] {
	const base = defaultProps(controls);
	return Object.keys(story.props).filter(
		(name) => story.props[name] !== base[name],
	);
}
