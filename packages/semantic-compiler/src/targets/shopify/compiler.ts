import {
	SemanticCompiler,
	type SemanticSourcePipeline,
} from "../../compiler/semantic-compiler.js";
import { SemanticGraphAssembler } from "../../compiler/semantic-graph-assembler.js";
import { SemanticGraphContract } from "../../compiler/semantic-graph-contract.js";
import { liquidFrontend } from "../../frontends/liquid/frontend.js";
import type { LiquidDocument } from "../../parsers/liquid/parser.js";
import { createDefaultParserProviders } from "../../parsers/providers.js";
import { projectLiquidToShopify } from "./liquid-projection.js";
import { shopifyOntology } from "./ontology.js";
import { shopifyRepositoryResolutionPass } from "./repository-resolution.js";
import { projectSourceToShopify } from "./source-projection.js";

const shopifyLiquidPipeline: SemanticSourcePipeline = {
	id: "shopify-liquid",
	version: 1,
	accepts: (document) => document.language === "liquid",
	project: (document, limits) => {
		const liquidDocument = document as LiquidDocument;
		return projectLiquidToShopify({
			document: liquidDocument,
			frontend: liquidFrontend.extract({
				document: liquidDocument,
				limits,
			}),
		});
	},
};

/** Creates standalone Shopify compiler with all parsers and current frontends. */
export function createShopifySemanticCompiler(): SemanticCompiler {
	return new SemanticCompiler({
		assembler: new SemanticGraphAssembler(
			new SemanticGraphContract([shopifyOntology]),
			[shopifyRepositoryResolutionPass],
		),
		parserProviders: createDefaultParserProviders(),
		pipelines: [shopifyLiquidPipeline],
		fallbackProjector: {
			id: "shopify-source",
			version: 1,
			project: projectSourceToShopify,
		},
	});
}
