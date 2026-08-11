import { defineMechanicalOntology } from "../mechanical-ontology.js";
import { JAVASCRIPT_MECHANICAL_FACT_KINDS } from "./facts.js";

export const javaScriptMechanicalOntology = defineMechanicalOntology({
	namespace: "javascript",
	version: 1,
	factKinds: JAVASCRIPT_MECHANICAL_FACT_KINDS.map((kind) => ({
		kind,
		description: "Direct JavaScript DOMTokenList class operation",
	})),
	coverageFamilies: [
		{
			kind: "javascript.class-list-operations",
			description:
				"Direct classList add, remove, toggle, contains, and replace calls",
		},
	],
});
