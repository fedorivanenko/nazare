import { defineMechanicalOntology } from "../mechanical-ontology.js";
import { CSS_MECHANICAL_FACT_KINDS } from "./facts.js";

export const cssMechanicalOntology = defineMechanicalOntology({
	namespace: "css",
	version: 1,
	factKinds: CSS_MECHANICAL_FACT_KINDS.map((kind) => ({
		kind,
		description: "CSS or SCSS class selector",
	})),
	coverageFamilies: [
		{
			kind: "css.class-selectors",
			description: "CSS and SCSS class selector names",
		},
	],
});
