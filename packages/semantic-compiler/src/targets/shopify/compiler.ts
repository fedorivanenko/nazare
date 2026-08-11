import {
	SemanticCompiler,
	type SemanticSourcePipeline,
} from "../../compiler/semantic-compiler.js";
import { SemanticGraphAssembler } from "../../compiler/semantic-graph-assembler.js";
import { SemanticGraphContract } from "../../compiler/semantic-graph-contract.js";
import { cssFrontend } from "../../frontends/css/frontend.js";
import { liquidFrontend } from "../../frontends/liquid/frontend.js";
import type { CssDocument } from "../../parsers/css/parser.js";
import type { LiquidDocument } from "../../parsers/liquid/parser.js";
import { createDefaultParserProviders } from "../../parsers/providers.js";
import { projectCssToShopify } from "./css-projection.js";
import { projectLiquidToShopify } from "./liquid-projection.js";
import { shopifyLiquidValueFlowPass } from "./liquid-value-flow.js";
import { shopifyOntology } from "./ontology.js";
import { shopifyRepositoryResolutionPass } from "./repository-resolution.js";
import { projectSourceToShopify } from "./source-projection.js";

const shopifyCssPipeline: SemanticSourcePipeline = {
	id: "shopify-css",
	version: 1,
	accepts: (document) =>
		document.language === "css" || document.language === "scss",
	project: (document, limits) => {
		const cssDocument = document as CssDocument;
		return projectCssToShopify({
			document: cssDocument,
			frontend: cssFrontend.extract({ document: cssDocument, limits }),
		});
	},
};

const shopifyLiquidPipeline: SemanticSourcePipeline = {
	id: "shopify-liquid",
	version: 4,
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
			[shopifyLiquidValueFlowPass, shopifyRepositoryResolutionPass],
		),
		parserProviders: createDefaultParserProviders(),
		pipelines: [shopifyLiquidPipeline, shopifyCssPipeline],
		fallbackProjector: {
			id: "shopify-source",
			version: 1,
			project: projectSourceToShopify,
		},
	});
}
