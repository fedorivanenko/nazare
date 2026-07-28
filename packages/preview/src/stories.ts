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
import { declaredDefaults, type PreviewControl } from "./controls.js";
import { resolveFixtures, usesFixtures } from "./fixtures.js";
import { parseStoryFile, type StoryDeclaration } from "./story-file.js";

export type PreviewStory = {
	name: string;
	/**
	 * What this case changes, not the whole prop set. Anything unstated falls
	 * through to the runtime default the declaration itself gives, so a story
	 * stays about its delta — which is also what makes the workbench's grouping
	 * by changed prop mean something. `null` explicitly omits a render argument.
	 */
	props: Record<string, unknown>;
	/**
	 * Props as authored, before `{ "$file": "fixtures/product.json" }` became
	 * product data. Kept so an editor can write story file back without inlining
	 * fixture contents where a readable path used to be.
	 */
	source?: Record<string, unknown>;
	/** Shown under the story; why this case is worth looking at. */
	note?: string;
	/** True when the story's props drew on shared storefront stand-in data. */
	fixtures?: boolean;
};

/**
 * Props supplied by preview's runtime boundary. Snippet defaults are absent
 * here because emitted Liquid owns them. Section and block defaults merge here
 * because Shopify normally materializes schema defaults before rendering, and
 * preview must model that boundary explicitly.
 *
 * Optional props without defaults remain absent. Preview never injects control
 * placeholders into rendered props.
 */
export function storyProps(
	story: PreviewStory,
	controls: PreviewControl[],
	componentKind: PreviewComponent["componentKind"],
): Record<string, unknown> {
	const props: Record<string, unknown> = {
		...(componentKind === "snippet" ? {} : declaredDefaults(controls)),
		...story.props,
	};
	// Null means omit the argument. Emitted snippet defaults may then apply; this
	// is distinct from passing the string "null".
	for (const [name, value] of Object.entries(props)) {
		if (value === null) delete props[name];
	}
	return props;
}

export function defaultStory(component: PreviewComponent): PreviewStory {
	return { name: "default", props: declaredDefaults(component.controls) };
}

/** One story per member of every select control, holding the rest at default. */
export function variantStories(component: PreviewComponent): PreviewStory[] {
	const base = declaredDefaults(component.controls);
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
	readFixture?: (path: string) => unknown,
): PreviewStory[] {
	return (declaration?.stories ?? []).map((story) => ({
		name: story.name,
		note: story.note,
		props: resolveFixtures(story.props ?? {}, readFixture),
		source: story.props ?? {},
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
	/**
	 * Reads the file a `{ "$file": "…" }` names, relative to the project. The
	 * caller supplies it because this package reads nothing — and the reference
	 * is a path rather than a name, so there is no registry to consult and the
	 * answer to "what is this?" is a file you can open.
	 */
	readFixture?: (path: string) => unknown;
}): PreviewStory[] {
	const declaration =
		sources.sidecar ??
		(sources.manifest?.preview === undefined
			? undefined
			: parseStoryFile(
					sources.manifest.preview,
					`${sources.manifest.id} nazare.json preview`,
				));
	return declaredStories(declaration, sources.readFixture);
}

/** Props this story states, for showing which knob a case turned. */
export function changedProps(
	story: PreviewStory,
	controls: PreviewControl[],
): string[] {
	const base = declaredDefaults(controls);
	return Object.keys(story.props).filter(
		(name) => story.props[name] !== base[name],
	);
}
