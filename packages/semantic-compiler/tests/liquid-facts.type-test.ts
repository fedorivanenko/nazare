import type { Frontend } from "../src/frontends/frontend.js";
import {
	LIQUID_MECHANICAL_FACT_KINDS,
	type LiquidFact,
} from "../src/frontends/liquid/facts.js";
import type { ParsedDocument } from "../src/parsers/parser.js";

const anchor = {
	path: "snippets/product-card.liquid",
	range: { start: 497, end: 529 },
} as const;

const renderArgument = {
	kind: "liquid.render-argument",
	evidence: anchor,
	renderSiteEvidence: anchor,
	argument: {
		kind: "named",
		name: "product",
		nameEvidence: anchor,
		value: { text: "product", evidence: anchor },
	},
} as const satisfies LiquidFact;

const frontend = {
	id: "liquid-type-test",
	version: 1,
	languages: ["liquid"],
	ontology: { namespace: "liquid", version: 1 },
	factKinds: LIQUID_MECHANICAL_FACT_KINDS,
	extract({ document }) {
		return {
			path: document.path,
			language: document.language,
			frontend: { id: "liquid-type-test", version: 1 },
			facts: [renderArgument],
			diagnostics: [],
			boundaries: [],
			coverage: [],
			work: { visited: 1, emitted: 1 },
		};
	},
} satisfies Frontend<ParsedDocument<unknown>, LiquidFact>;

function assertExhaustive(fact: LiquidFact): void {
	switch (fact.kind) {
		case "liquid.access-path":
		case "liquid.binding":
		case "liquid.filter":
		case "liquid.predicate":
		case "liquid.condition":
		case "liquid.guard":
		case "liquid.render-site":
		case "liquid.render-argument":
		case "liquid.schema-region":
		case "liquid.asset-reference":
		case "liquid.locale-reference":
		case "liquid.markup-attribute":
			return;
		default:
			assertNever(fact);
	}
}

function assertNever(value: never): never {
	throw new Error(`Unexpected Liquid fact: ${JSON.stringify(value)}`);
}

assertExhaustive(renderArgument);
void frontend;
