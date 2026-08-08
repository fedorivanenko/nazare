import type { ComputationGraph } from "./graph.js";
import { type ComputationRegistrar, registrarIdentity } from "./registrar.js";

const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;
declare const CAPABILITY_VALUE: unique symbol;

export type Capability<Value> = {
	id: string;
	readonly [CAPABILITY_VALUE]?: (value: Value) => Value;
};

export type CapabilityProvider<Value> = ComputationRegistrar & {
	capability: Capability<Value>;
	value: Value;
};

type AnyCapabilityProvider = ComputationRegistrar & {
	capability: { id: string };
	value: unknown;
};

export type CapabilityRegistry = {
	has<Value>(capability: Capability<Value>): boolean;
	require<Value>(capability: Capability<Value>): Value;
	registerComputations(graph: ComputationGraph): void;
	identities(): readonly string[];
};

export function defineCapability<Value>(id: string): Capability<Value> {
	if (!CAPABILITY_ID_PATTERN.test(id)) {
		throw new TypeError(
			`Capability id must match ${CAPABILITY_ID_PATTERN.source}`,
		);
	}
	return Object.freeze({ id });
}

export function defineCapabilityProvider<Value>(input: {
	capability: Capability<Value>;
	id: string;
	version: number;
	value: Value;
	registerComputations?(graph: ComputationGraph): void;
}): CapabilityProvider<Value> {
	const provider: CapabilityProvider<Value> = {
		capability: input.capability,
		id: input.id,
		version: input.version,
		value: input.value,
		registerComputations: input.registerComputations ?? (() => {}),
	};
	registrarIdentity(provider);
	return Object.freeze(provider);
}

export function createCapabilityRegistry(
	providers: readonly AnyCapabilityProvider[],
): CapabilityRegistry {
	const byCapability = new Map<string, AnyCapabilityProvider>();
	const providerIdentities = new Set<string>();

	for (const provider of providers) {
		if (byCapability.has(provider.capability.id)) {
			throw new Error(`Capability already provided: ${provider.capability.id}`);
		}
		const identity = registrarIdentity(provider);
		if (providerIdentities.has(identity)) {
			throw new Error(`Capability provider already registered: ${identity}`);
		}
		byCapability.set(provider.capability.id, provider);
		providerIdentities.add(identity);
	}

	const ordered = [...byCapability.values()].sort((left, right) =>
		registrarIdentity(left).localeCompare(registrarIdentity(right)),
	);

	return Object.freeze({
		has<Value>(capability: Capability<Value>): boolean {
			return byCapability.has(capability.id);
		},
		require<Value>(capability: Capability<Value>): Value {
			const provider = byCapability.get(capability.id);
			if (!provider) {
				throw new Error(`Target does not provide capability: ${capability.id}`);
			}
			return provider.value as Value;
		},
		registerComputations(graph) {
			for (const provider of ordered) provider.registerComputations(graph);
		},
		identities() {
			return ordered.map(registrarIdentity);
		},
	});
}
