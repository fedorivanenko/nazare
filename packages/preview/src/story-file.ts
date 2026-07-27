// The story file: `product-card.stories.json` beside `product-card.liquid`.
//
// A story file owns cases, never interface. Prop names, types, ranges, enum
// members, requiredness and defaults are declared in the Liquid — `{% doc %}`,
// `{% schema %}`, `{% props %}` — and a story is a set of named value bundles
// addressed by names the template already declared. Two places to declare an
// interface means they disagree, so there is exactly one.
//
// Parsing is strict. The file is four keys deep; a typo'd `prop` for `props`
// should stop rather than render a story that silently sets nothing, and
// permissive parsing is how a config format grows a shadow API.
import type { NazareManifestStory } from "@nazare/core";

/**
 * Where authored stories come from. A published component carries them in its
 * `nazare.json`, so they travel with the install and are versioned with it. A
 * theme has no manifests — plain `.liquid` under `snippets/` is the whole
 * component — so its stories live in a sidecar beside the template. Both
 * sources share this shape.
 */
export type StoryDeclaration = {
	stories: NazareManifestStory[];
};

const STORY_KEYS = new Set(["name", "props", "note"]);

class StoryFileError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

function unknownKeys(value: Record<string, unknown>, known: Set<string>) {
	return Object.keys(value).filter((key) => !known.has(key));
}

/**
 * A story file's contents, checked. Throws with the offending path rather than
 * returning a partial declaration: a story file that does not parse is a file
 * the author is mid-edit on, and rendering half of it is worse than saying so.
 */
export function parseStoryFile(
	value: unknown,
	where = "story file",
): StoryDeclaration {
	if (!isRecord(value)) {
		throw new StoryFileError(`${where}: expected an object`);
	}
	const extra = unknownKeys(value, new Set(["stories"]));
	if (extra.length > 0) {
		throw new StoryFileError(
			`${where}: unknown key ${extra.map((key) => `"${key}"`).join(", ")} — a story file declares only "stories"`,
		);
	}
	if (!Array.isArray(value.stories)) {
		throw new StoryFileError(`${where}: "stories" must be an array`);
	}

	const names = new Set<string>();
	const stories: NazareManifestStory[] = value.stories.map((entry, index) => {
		const at = `${where}: stories[${index}]`;
		if (!isRecord(entry)) throw new StoryFileError(`${at} must be an object`);

		const extraStoryKeys = unknownKeys(entry, STORY_KEYS);
		if (extraStoryKeys.length > 0) {
			throw new StoryFileError(
				`${at}: unknown key ${extraStoryKeys
					.map((key) => `"${key}"`)
					.join(
						", ",
					)} — a story declares only name, props, and note. Types and defaults belong in the Liquid.`,
			);
		}
		if (typeof entry.name !== "string" || entry.name.trim() === "") {
			throw new StoryFileError(`${at}: "name" must be a non-empty string`);
		}
		// Names are the story's identity — its id, its document, its deep link —
		// so two stories cannot claim the same one.
		if (names.has(entry.name)) {
			throw new StoryFileError(`${at}: duplicate story name "${entry.name}"`);
		}
		names.add(entry.name);

		if (entry.props !== undefined && !isRecord(entry.props)) {
			throw new StoryFileError(`${at}: "props" must be an object`);
		}
		if (entry.note !== undefined && typeof entry.note !== "string") {
			throw new StoryFileError(`${at}: "note" must be a string`);
		}

		return {
			name: entry.name,
			...(entry.props ? { props: entry.props as Record<string, unknown> } : {}),
			...(entry.note ? { note: entry.note } : {}),
		};
	});

	return { stories };
}
