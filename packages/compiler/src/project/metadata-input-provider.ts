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
	type Subscriber = {
		batches: Array<readonly InputChange<string>[]>;
		waiter?: (value: IteratorResult<readonly InputChange<string>[]>) => void;
		closed: boolean;
	};
	const subscribers = new Set<Subscriber>();
	let closed = false;

	const emit = (change: InputChange<string>): void => {
		if (closed) throw new Error("Project metadata input provider is closed");
		for (const subscriber of subscribers) {
			if (subscriber.waiter) {
				const waiter = subscriber.waiter;
				subscriber.waiter = undefined;
				waiter({ done: false, value: [change] });
			} else subscriber.batches.push([change]);
		}
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
					const subscriber: Subscriber = {
						batches: [],
						closed,
					};
					subscribers.add(subscriber);
					const finish = (): IteratorResult<
						readonly InputChange<string>[]
					> => ({
						done: true,
						value: undefined,
					});
					return {
						next(): Promise<IteratorResult<readonly InputChange<string>[]>> {
							const batch = subscriber.batches.shift();
							if (batch) return Promise.resolve({ done: false, value: batch });
							if (subscriber.closed) return Promise.resolve(finish());
							return new Promise((resolve) => {
								subscriber.waiter = resolve;
							});
						},
						return(): Promise<IteratorResult<readonly InputChange<string>[]>> {
							subscriber.closed = true;
							subscribers.delete(subscriber);
							subscriber.waiter?.(finish());
							subscriber.waiter = undefined;
							return Promise.resolve(finish());
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
			for (const subscriber of subscribers) {
				subscriber.closed = true;
				subscriber.waiter?.({ done: true, value: undefined });
				subscriber.waiter = undefined;
			}
			subscribers.clear();
		},
	};
}
