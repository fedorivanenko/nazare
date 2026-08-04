import {
	fingerprintProductKey,
	type ProductKey,
} from "../computation/canonical-key.js";
import {
	defineInputProvider,
	type InputChange,
	type InputProvider,
} from "./input-provider.js";

export const PROJECT_METADATA_KEYS = {
	config: "project.config",
	themeCheck: "shopify.theme-check",
	metafields: "shopify.metafields",
	remoteData: "project.remote-data",
} as const;

export type ProjectMetadataKey =
	(typeof PROJECT_METADATA_KEYS)[keyof typeof PROJECT_METADATA_KEYS];

export type ProjectMetadataInputs = Partial<
	Readonly<Record<ProjectMetadataKey, ProductKey>>
>;

export type ProjectMetadataInputProvider = {
	provider: InputProvider<string, ProductKey>;
	discover(): Promise<readonly string[]>;
	set(key: ProjectMetadataKey, value: ProductKey): InputChange<string>;
	remove(key: ProjectMetadataKey): InputChange<string> | undefined;
	close(): void;
};

export function createProjectMetadataInputProvider(
	initial: ProjectMetadataInputs = {},
): ProjectMetadataInputProvider {
	const values = new Map<string, ProductKey>(
		Object.entries(initial).filter(
			(entry): entry is [string, ProductKey] => entry[1] !== undefined,
		),
	);
	const batches: Array<readonly InputChange<string>[]> = [];
	const waiters: Array<
		(value: IteratorResult<readonly InputChange<string>[]>) => void
	> = [];
	let closed = false;

	const emit = (change: InputChange<string>): void => {
		if (closed) throw new Error("Project metadata input provider is closed");
		const waiter = waiters.shift();
		if (waiter) waiter({ done: false, value: [change] });
		else batches.push([change]);
	};

	const provider = defineInputProvider<string, ProductKey>({
		id: "nazare.project-metadata",
		version: 1,
		async read(key) {
			const value = values.get(key);
			if (value === undefined)
				throw new Error(`Missing project metadata: ${key}`);
			return { value, fingerprint: fingerprintProductKey(value) };
		},
		watch() {
			return {
				[Symbol.asyncIterator]() {
					return {
						next(): Promise<IteratorResult<readonly InputChange<string>[]>> {
							const batch = batches.shift();
							if (batch) return Promise.resolve({ done: false, value: batch });
							if (closed)
								return Promise.resolve({ done: true, value: undefined });
							return new Promise((resolve) => waiters.push(resolve));
						},
						return(): Promise<IteratorResult<readonly InputChange<string>[]>> {
							return Promise.resolve({ done: true, value: undefined });
						},
					};
				},
			};
		},
	});

	return {
		provider,
		async discover() {
			return [...values.keys()].sort();
		},
		set(key, value) {
			const kind = values.has(key) ? "changed" : "added";
			values.set(key, value);
			const change: InputChange<string> = {
				kind,
				key,
				fingerprint: fingerprintProductKey(value),
			};
			emit(change);
			return change;
		},
		remove(key) {
			if (!values.delete(key)) return undefined;
			const change = { kind: "removed" as const, key };
			emit(change);
			return change;
		},
		close() {
			if (closed) return;
			closed = true;
			for (const waiter of waiters.splice(0)) {
				waiter({ done: true, value: undefined });
			}
		},
	};
}
