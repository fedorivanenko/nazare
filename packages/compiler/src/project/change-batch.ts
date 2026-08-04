import type { ProductKey } from "../computation/canonical-key.js";
import { canonicalProductKey } from "../computation/canonical-key.js";
import type { InputChange } from "./input-provider.js";

export function coalesceInputChanges<Key extends ProductKey>(
	changes: readonly InputChange<Key>[],
): readonly InputChange<Key>[] {
	const byKey = new Map<string, InputChange<Key>>();

	const expanded = changes.flatMap((change): readonly InputChange<Key>[] =>
		change.kind === "moved"
			? [
					{ kind: "removed", key: change.from },
					{
						kind: "added",
						key: change.key,
						fingerprint: change.fingerprint,
					},
				]
			: [change],
	);

	for (const change of expanded) {
		const identity = canonicalProductKey(change.key);
		const previous = byKey.get(identity);
		if (previous?.kind === "added" && change.kind === "removed") {
			byKey.delete(identity);
			continue;
		}
		if (previous?.kind === "removed" && change.kind === "added") {
			byKey.set(identity, { ...change, kind: "changed" });
			continue;
		}
		if (previous?.kind === "added" && change.kind === "changed") {
			byKey.set(identity, { ...change, kind: "added" });
			continue;
		}
		byKey.set(identity, change);
	}

	return [...byKey.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([, change]) => change);
}
