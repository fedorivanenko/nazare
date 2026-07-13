// Field-level 3-way merge for Shopify storefront locale files (locales/*.json,
// excluding *.schema.json editor labels). Merchants edit translations in the
// Shopify admin, which writes them back into the live theme; developers also
// evolve the same files in source. Neither whole-file rule works — clobbering
// loses merchant edits, preserving freezes developer updates — so translations
// merge per key against a committed base (the source strings as of the last
// build), exactly like a 3-way text merge:
//
//   merchant changed a key, developer didn't  -> keep the merchant's value
//   developer changed a key, merchant didn't  -> take the developer's value
//   developer added / removed a key           -> apply it
//   both changed the same key differently     -> merchant wins, report a conflict
//
// With no base yet (adopting an existing theme) it falls back to a safe 2-way
// merge: keep the merchant's value where present, add the developer's new keys.

export type MergeResult = { value: unknown; conflicts: string[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Merges one locale tree. Leaves are compared by strict equality. */
export function mergeLocale(
	base: unknown,
	source: unknown,
	target: unknown,
): MergeResult {
	const conflicts: string[] = [];
	const value = mergeNode(base, source, target, "", conflicts);
	return { value, conflicts };
}

function mergeNode(
	base: unknown,
	source: unknown,
	target: unknown,
	path: string,
	conflicts: string[],
): unknown {
	if (isObject(source) || isObject(target)) {
		// Developer replaced a subtree with a scalar — a structural decision that
		// wins wholesale.
		if (source !== undefined && !isObject(source)) return source;

		const s = isObject(source) ? source : {};
		const t = isObject(target) ? target : {};
		const b = isObject(base) ? base : {};
		const out: Record<string, unknown> = {};
		for (const key of new Set([...Object.keys(s), ...Object.keys(t)])) {
			const merged = mergeNode(
				b[key],
				key in s ? s[key] : undefined,
				key in t ? t[key] : undefined,
				path ? `${path}.${key}` : key,
				conflicts,
			);
			if (merged !== undefined) out[key] = merged;
		}
		return out;
	}

	return mergeLeaf(base, source, target, path, conflicts);
}

function mergeLeaf(
	base: unknown,
	source: unknown,
	target: unknown,
	path: string,
	conflicts: string[],
): unknown {
	// No common ancestor: preserve the merchant's value, fall back to source.
	if (base === undefined) {
		return target !== undefined ? target : source;
	}
	// Merchant doesn't have this key: take the developer's value (or a removal).
	if (target === undefined) return source;
	// Developer removed the key.
	if (source === undefined) {
		if (target === base) return undefined; // merchant untouched — drop it
		conflicts.push(path); // merchant edited a key the developer removed
		return target;
	}
	if (target === base) return source; // merchant unchanged — propagate developer
	if (source === base) return target; // developer unchanged — keep merchant edit
	if (source === target) return source; // both agree
	conflicts.push(path); // both changed differently — merchant wins
	return target;
}
