import type { OntologyKind, OntologyReference } from "../ontology/core.js";

/** Versioned source-local vocabulary consumed before semantic projection. */
export type MechanicalOntologyModule = OntologyReference & {
	factKinds: readonly MechanicalFactKindDefinition[];
	coverageFamilies: readonly MechanicalCoverageFamilyDefinition[];
};

export type MechanicalFactKindDefinition = {
	kind: OntologyKind;
	description: string;
};

export type MechanicalCoverageFamilyDefinition = {
	kind: OntologyKind;
	description: string;
};

export type MechanicalOntologyIssue = {
	code: string;
	path: string;
	message: string;
};

export class InvalidMechanicalOntologyError extends Error {
	readonly issues: readonly MechanicalOntologyIssue[];

	constructor(issues: readonly MechanicalOntologyIssue[]) {
		super(`Invalid mechanical ontology: ${issues.length} contract issue(s)`);
		this.name = "InvalidMechanicalOntologyError";
		this.issues = issues;
	}
}

/** Validates one frontend vocabulary while preserving literal TypeScript types. */
export function defineMechanicalOntology<
	const Module extends MechanicalOntologyModule,
>(module: Module): Module {
	const issues: MechanicalOntologyIssue[] = [];
	if (!module.namespace || module.namespace.includes(".")) {
		issues.push({
			code: "INVALID_MECHANICAL_ONTOLOGY_NAMESPACE",
			path: "namespace",
			message: "Mechanical ontology namespace must be one non-empty segment",
		});
	}
	if (!Number.isInteger(module.version) || module.version < 1) {
		issues.push({
			code: "INVALID_MECHANICAL_ONTOLOGY_VERSION",
			path: "version",
			message: "Mechanical ontology version must be a positive integer",
		});
	}
	const kinds = new Set<string>();
	validateDefinitions(module.factKinds, "factKinds");
	validateDefinitions(module.coverageFamilies, "coverageFamilies");
	if (issues.length > 0) throw new InvalidMechanicalOntologyError(issues);
	return module;

	function validateDefinitions(
		definitions: readonly { kind: OntologyKind; description: string }[],
		path: string,
	): void {
		for (const [index, definition] of definitions.entries()) {
			const itemPath = `${path}[${index}]`;
			if (
				!definition.kind.startsWith(`${module.namespace}.`) ||
				definition.kind.length === module.namespace.length + 1
			) {
				issues.push({
					code: "MECHANICAL_ONTOLOGY_KIND_NAMESPACE_MISMATCH",
					path: `${itemPath}.kind`,
					message: `Kind ${definition.kind} must belong to namespace ${module.namespace}`,
				});
			}
			if (kinds.has(definition.kind)) {
				issues.push({
					code: "DUPLICATE_MECHANICAL_ONTOLOGY_KIND",
					path: `${itemPath}.kind`,
					message: `Mechanical ontology kind ${definition.kind} is duplicated`,
				});
			}
			kinds.add(definition.kind);
			if (!definition.description.trim()) {
				issues.push({
					code: "EMPTY_MECHANICAL_ONTOLOGY_DESCRIPTION",
					path: `${itemPath}.description`,
					message: `Mechanical ontology kind ${definition.kind} needs a description`,
				});
			}
		}
	}
}
