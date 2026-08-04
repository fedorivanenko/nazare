import type { ComputationGraph } from "./graph.js";

const REGISTRAR_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]*$/;

export type ComputationRegistrar = {
	id: string;
	version: number;
	registerComputations(graph: ComputationGraph): void;
};

export function defineComputationRegistrar(
	identity: { id: string; version: number },
	registerComputations: ComputationRegistrar["registerComputations"],
): ComputationRegistrar {
	validateRegistrarIdentity(identity);
	return Object.freeze({ ...identity, registerComputations });
}

export function registrarIdentity(
	registrar: Pick<ComputationRegistrar, "id" | "version">,
): string {
	validateRegistrarIdentity(registrar);
	return `${registrar.id}@${registrar.version}`;
}

function validateRegistrarIdentity(identity: {
	id: string;
	version: number;
}): void {
	if (!REGISTRAR_ID_PATTERN.test(identity.id)) {
		throw new TypeError(
			`Computation registrar id must match ${REGISTRAR_ID_PATTERN.source}`,
		);
	}
	if (!Number.isSafeInteger(identity.version) || identity.version < 1) {
		throw new TypeError(
			"Computation registrar version must be a positive safe integer",
		);
	}
}
