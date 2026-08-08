import type { ProductKey } from "../computation/canonical-key.js";
import { canonicalProductKey } from "../computation/canonical-key.js";
import type { InputChange } from "./input-provider.js";

export type CoalescedInputChange<Key extends ProductKey> = Exclude<
	InputChange<Key>,
	{ kind: "moved" }
>;

export function coalesceInputChanges<Key extends ProductKey>(
	changes: readonly InputChange<Key>[],
): readonly CoalescedInputChange<Key>[] {
	const byKey = new Map<string, CoalescedInputChange<Key>>();

	const expanded = changes.flatMap(
		(change): readonly CoalescedInputChange<Key>[] =>
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
