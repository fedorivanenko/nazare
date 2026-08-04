import type { ProductKey } from "../computation/canonical-key.js";
import type { InputChange, InputProvider } from "./input-provider.js";

export type ProjectHost<Key extends ProductKey, Value> = {
	files: InputProvider<Key, Value>;
	discover(): Promise<readonly Key[]>;
	watch?(): AsyncIterable<readonly InputChange<Key>[]>;
};

export function defineProjectHost<Key extends ProductKey, Value>(
	host: ProjectHost<Key, Value>,
): ProjectHost<Key, Value> {
	return Object.freeze(host);
}
