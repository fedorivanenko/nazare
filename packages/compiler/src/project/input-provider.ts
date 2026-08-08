import type { ProductKey } from "../computation/canonical-key.js";
import { registrarIdentity } from "../computation/registrar.js";

export type InputSnapshot<Value> = {
	value: Value;
	fingerprint: string;
};

export type InputChange<Key extends ProductKey> =
	| { kind: "added"; key: Key; fingerprint: string }
	| { kind: "changed"; key: Key; fingerprint: string }
	| { kind: "removed"; key: Key }
	| { kind: "moved"; from: Key; key: Key; fingerprint: string };

export type InputProvider<Key extends ProductKey, Value> = {
	id: string;
	version: number;
	read(key: Key): Promise<InputSnapshot<Value>>;
	watch?(): AsyncIterable<readonly InputChange<Key>[]>;
};

export function defineInputProvider<Key extends ProductKey, Value>(
	provider: InputProvider<Key, Value>,
): InputProvider<Key, Value> {
	registrarIdentity(provider);
	return Object.freeze(provider);
}
