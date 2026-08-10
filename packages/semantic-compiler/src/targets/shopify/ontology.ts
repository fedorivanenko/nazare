import type { OntologyModule } from "../../ontology/module.js";

const sourceFileOwners = ["shopify.source-file"] as const;
const expressionOwners = [
	"shopify.source-file",
	"shopify.binding-site",
	"shopify.filter-site",
	"shopify.condition-site",
	"shopify.render-site",
	"shopify.render-argument-site",
] as const;

export const shopifyOntology = {
	namespace: "shopify",
	version: 2,
	entityKinds: [
		{
			kind: "shopify.source-file",
			identity: [
				{
					name: "path",
					type: "string",
					required: true,
					normalization: "path",
				},
			],
			attributes: [
				{ name: "language", type: "string", required: true },
				{ name: "role", type: "string", required: true },
			],
		},
		{
			kind: "shopify.snippet",
			identity: [
				{
					name: "handle",
					type: "string",
					required: true,
					normalization: "none",
				},
			],
			attributes: [
				{ name: "path", type: "string", required: true },
				{
					name: "defined",
					type: "boolean",
					required: true,
					merge: "boolean-or",
				},
			],
		},
	],
	occurrenceKinds: [
		{
			kind: "shopify.expression-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "expression", type: "string", required: true },
				{ name: "context", type: "string", required: true },
				{ name: "root", type: "string", required: true },
				{ name: "segments", type: "array", required: true },
			],
		},
		{
			kind: "shopify.binding-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "name", type: "string", required: true },
				{ name: "binding", type: "string", required: true },
				{ name: "scopeStart", type: "number", required: true },
				{ name: "scopeEnd", type: "number", required: true },
			],
		},
		{
			kind: "shopify.filter-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "name", type: "string", required: true },
				{ name: "input", type: "string", required: true },
				{ name: "arguments", type: "array", required: true },
			],
		},
		{
			kind: "shopify.condition-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "construct", type: "string", required: true },
				{ name: "bodyStart", type: "number", required: true },
				{ name: "bodyEnd", type: "number", required: true },
			],
		},
		{
			kind: "shopify.render-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "targetKind", type: "string", required: true },
				{ name: "target", type: "string", required: true },
			],
		},
		{
			kind: "shopify.render-argument-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "argumentKind", type: "string", required: true },
				{ name: "name", type: "string", required: false },
				{ name: "expression", type: "string", required: true },
			],
		},
		{
			kind: "shopify.schema-region",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "contentStart", type: "number", required: true },
				{ name: "contentEnd", type: "number", required: true },
			],
		},
		{
			kind: "shopify.asset-reference-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "syntax", type: "string", required: true },
				{ name: "referenceKind", type: "string", required: true },
				{ name: "reference", type: "string", required: true },
			],
		},
		{
			kind: "shopify.locale-reference-site",
			ownerKinds: sourceFileOwners,
			attributes: [
				{ name: "referenceKind", type: "string", required: true },
				{ name: "key", type: "string", required: true },
			],
		},
	],
	relationKinds: [
		{
			kind: "shopify.defines",
			from: { categories: ["entity"], kinds: ["shopify.source-file"] },
			to: { categories: ["entity"], kinds: ["shopify.snippet"] },
			attributes: [],
			allowsGuards: false,
		},
		{
			kind: "shopify.invokes",
			from: { categories: ["occurrence"], kinds: ["shopify.render-site"] },
			to: { categories: ["entity"], kinds: ["shopify.snippet"] },
			attributes: [{ name: "resolution", type: "string", required: true }],
			allowsGuards: true,
		},
		{
			kind: "shopify.passes-argument",
			from: { categories: ["occurrence"], kinds: ["shopify.render-site"] },
			to: {
				categories: ["occurrence"],
				kinds: ["shopify.render-argument-site"],
			},
			attributes: [],
			allowsGuards: false,
		},
	],
	valueSlots: [
		{
			kind: "shopify.read-value",
			ownerKinds: ["shopify.expression-site", "shopify.condition-site"],
			attributes: [],
		},
		{
			kind: "shopify.binding-value",
			ownerKinds: ["shopify.binding-site"],
			attributes: [],
		},
		{
			kind: "shopify.filter-input",
			ownerKinds: ["shopify.filter-site"],
			attributes: [],
		},
		{
			kind: "shopify.filter-argument",
			ownerKinds: ["shopify.filter-site"],
			attributes: [{ name: "position", type: "number", required: true }],
		},
		{
			kind: "shopify.filter-result",
			ownerKinds: ["shopify.filter-site"],
			attributes: [{ name: "filter", type: "string", required: true }],
		},
		{
			kind: "shopify.render-target",
			ownerKinds: ["shopify.render-site"],
			attributes: [],
		},
		{
			kind: "shopify.render-argument-value",
			ownerKinds: ["shopify.render-argument-site"],
			attributes: [],
		},
		{
			kind: "shopify.condition-operand",
			ownerKinds: expressionOwners,
			attributes: [],
		},
	],
	predicateKinds: [
		{
			kind: "shopify.liquid-predicate",
			operators: [
				"truthy",
				"falsy",
				"blank",
				"not-blank",
				"not",
				"equal",
				"not-equal",
				"contains",
				"greater-than",
				"greater-than-or-equal",
				"less-than",
				"less-than-or-equal",
				"and",
				"or",
			],
			attributes: [{ name: "expression", type: "string", required: true }],
		},
	],
	boundaryKinds: [
		"dynamic-target",
		"runtime-condition",
		"merchant-configuration",
		"shopify-runtime",
		"browser-runtime",
		"external-data",
		"generated-source",
		"unsupported",
		"budget",
		"ambiguous-join",
		"unresolved-reference",
	],
	coverageFamilies: [
		{
			kind: "shopify.source-files",
			description: "Projected Shopify source files",
		},
		{
			kind: "shopify.snippets",
			description: "Projected Shopify snippet identities",
		},
		{ kind: "shopify.reads", description: "Projected Liquid reads" },
		{ kind: "shopify.bindings", description: "Projected Liquid bindings" },
		{ kind: "shopify.filters", description: "Projected Liquid filters" },
		{
			kind: "shopify.value-flow",
			description: "Bounded Liquid value provenance",
		},
		{ kind: "shopify.conditions", description: "Projected Liquid conditions" },
		{ kind: "shopify.renders", description: "Projected Liquid renders" },
		{ kind: "shopify.schema-regions", description: "Projected schema regions" },
		{
			kind: "shopify.asset-references",
			description: "Projected asset references",
		},
		{
			kind: "shopify.locale-references",
			description: "Projected locale references",
		},
	],
} as const satisfies OntologyModule;
