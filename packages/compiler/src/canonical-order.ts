/** Locale-independent ordering for canonical paths, IDs, keys, and diagnostics. */
export function compareCanonicalStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}
