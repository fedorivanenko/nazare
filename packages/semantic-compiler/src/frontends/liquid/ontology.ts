import { defineMechanicalOntology } from "../mechanical-ontology.js";
import { LIQUID_MECHANICAL_FACT_KINDS } from "./facts.js";

const liquidFactDescriptions = {
	"liquid.access-path": "Liquid variable or property read",
	"liquid.binding": "Liquid local binding",
	"liquid.filter": "Liquid filter invocation",
	"liquid.predicate": "Liquid predicate expression",
	"liquid.condition": "Liquid conditional construct",
	"liquid.guard": "Liquid branch guard scope",
	"liquid.render-site": "Liquid render statement",
	"liquid.render-argument": "Liquid render statement argument",
	"liquid.schema-region": "Liquid schema tag body",
	"liquid.asset-reference": "Liquid asset filter reference",
	"liquid.locale-reference": "Liquid translation filter reference",
} as const;

export const liquidMechanicalOntology = defineMechanicalOntology({
	namespace: "liquid",
	version: 1,
	factKinds: LIQUID_MECHANICAL_FACT_KINDS.map((kind) => ({
		kind,
		description: liquidFactDescriptions[kind],
	})),
	coverageFamilies: [
		{
			kind: "liquid.access-paths",
			description: "Liquid variable and property reads",
		},
		{
			kind: "liquid.bindings",
			description: "Liquid local bindings",
		},
		{
			kind: "liquid.filters",
			description: "Liquid filter invocations",
		},
		{
			kind: "liquid.predicates",
			description: "Liquid predicate expressions",
		},
		{
			kind: "liquid.conditions",
			description: "Liquid conditional constructs",
		},
		{
			kind: "liquid.guards",
			description: "Liquid branch guard scopes",
		},
		{
			kind: "liquid.render-sites",
			description: "Liquid render statements",
		},
		{
			kind: "liquid.render-arguments",
			description: "Liquid render arguments",
		},
		{
			kind: "liquid.schema-regions",
			description: "Liquid schema tag bodies",
		},
		{
			kind: "liquid.asset-references",
			description: "Liquid asset filter references",
		},
		{
			kind: "liquid.locale-references",
			description: "Liquid translation filter references",
		},
	],
});
