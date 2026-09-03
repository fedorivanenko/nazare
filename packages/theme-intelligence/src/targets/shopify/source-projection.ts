import type { SemanticContribution } from "../../compiler/semantic-contribution.js";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticDiagnostic,
	SemanticEntity,
} from "../../outputs/semantic-graph-snapshot.js";
import type { ParserDiagnostic } from "../../parsers/parser.js";
import type { AssertionMetadata } from "../../semantic/assertion.js";
import type { SourceAnchor } from "../../semantic/evidence.js";

const SOURCE_SEMANTIC_FAMILIES = [
	"shopify.reads",
	"shopify.bindings",
	"shopify.filters",
	"shopify.value-flow",
	"shopify.conditions",
	"shopify.renders",
	"shopify.schema-regions",
	"shopify.asset-references",
	"shopify.locale-references",
	"shopify.markup-attributes",
	"shopify.markup-classes",
	"shopify.class-selectors",
	"shopify.class-list-operations",
] as const;

export type ShopifySourceProjectionInput = {
	path: string;
	source: string;
	language: string;
	parserDiagnostics?: readonly ParserDiagnostic[];
	semanticSupport?: "source-only" | "projected";
};

/** Projects source existence when no language semantic frontend is available. */
export function projectSourceToShopify({
	path,
	source,
	language,
	parserDiagnostics = [],
	semanticSupport = "source-only",
}: ShopifySourceProjectionInput): SemanticContribution {
	const evidence: SourceAnchor = {
		path,
		range: { start: 0, end: source.length },
	};
	const fileId = id("entity", "shopify.source-file", path);
	const entity: SemanticEntity = {
		id: fileId,
		kind: "shopify.source-file",
		identity: {
			scheme: "shopify.source-file",
			components: { path },
		},
		name: basename(path),
		path,
		attributes: { language, role: sourceRole(path) },
		assertion: assertion(evidence),
	};
	const diagnostics: SemanticDiagnostic[] = parserDiagnostics.map(
		(diagnostic) => ({
			severity: "warning",
			code: diagnostic.code,
			message: diagnostic.message,
			evidence: [{ path, range: diagnostic.range }],
		}),
	);
	const boundaries: SemanticBoundary[] = [];
	const coverage: SemanticCoverage[] = [
		{
			id: id("coverage", "shopify.source-files", path),
			family: "shopify.source-files",
			scope: { paths: [path], languages: [language] },
			status: "complete",
			boundaryIds: [],
		},
	];
	if (semanticSupport === "source-only") {
		const boundaryId = id("boundary", "semantic-frontend", path);
		boundaries.push({
			id: boundaryId,
			kind: "unsupported",
			message: `No semantic frontend configured for ${language}`,
			subjectIds: [fileId],
			evidence: [evidence],
			attributes: { language },
		});
		for (const family of SOURCE_SEMANTIC_FAMILIES) {
			coverage.push({
				id: id("coverage", family, path),
				family,
				scope: { paths: [path], languages: [language] },
				status: "unsupported",
				boundaryIds: [boundaryId],
			});
		}
		diagnostics.push({
			severity: "information",
			code: "SEMANTIC_FRONTEND_UNAVAILABLE",
			message: `No semantic frontend configured for ${language}`,
			evidence: [evidence],
		});
	}
	return {
		scope: { paths: [path], languages: [language] },
		entities: [entity],
		occurrences: [],
		relations: [],
		values: [],
		predicates: [],
		boundaries,
		coverage,
		diagnostics,
	};
}

function assertion(evidence: SourceAnchor): AssertionMetadata {
	return {
		epistemic: { status: "proven", basis: "syntax" },
		availability: "static",
		provenance: { authorities: ["authored-source"], sourceIds: [] },
		evidence: [evidence],
		boundaryIds: [],
	};
}

function sourceRole(path: string): string {
	const directory = path.split("/", 1)[0];
	return directory && path.includes("/")
		? directory.replace(/s$/u, "")
		: "other";
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

function id(...parts: readonly string[]): string {
	return parts.map((part) => encodeURIComponent(part)).join(":");
}
