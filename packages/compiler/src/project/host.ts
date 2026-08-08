import type { ProductKey } from "../computation/canonical-key.js";
import type { InputChange, InputProvider } from "./input-provider.js";

export type ExternalProjectInputProvider = {
	provider: InputProvider<string, ProductKey>;
	discover(): Promise<readonly string[]>;
};

export type ProjectHost<Key extends ProductKey, Value> = {
	files: InputProvider<Key, Value>;
	discover(): Promise<readonly Key[]>;
	watchFiles?(): AsyncIterable<readonly InputChange<Key>[]>;
	externalInputs?: readonly ExternalProjectInputProvider[];
};

export function defineProjectHost<Key extends ProductKey, Value>(
	host: ProjectHost<Key, Value>,
): ProjectHost<Key, Value> {
	const externalInputs = [...(host.externalInputs ?? [])];
	const providerIds = new Set<string>();
	for (const input of externalInputs) {
		if (providerIds.has(input.provider.id)) {
			throw new Error(
				`Duplicate external input provider: ${input.provider.id}`,
			);
		}
		providerIds.add(input.provider.id);
	}
	return Object.freeze({
		...host,
		externalInputs: Object.freeze(externalInputs),
	});
}
