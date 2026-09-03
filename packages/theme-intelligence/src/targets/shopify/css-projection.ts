import type { SemanticContribution } from "../../compiler/semantic-contribution.js";
import type { CssFact } from "../../frontends/css/facts.js";
import type { FrontendResult } from "../../frontends/frontend.js";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticOccurrence,
	SemanticRelation,
} from "../../outputs/semantic-graph-snapshot.js";
import type { CssDocument } from "../../parsers/css/parser.js";
import type { AssertionMetadata } from "../../semantic/assertion.js";
import type { SourceAnchor } from "../../semantic/evidence.js";

export type CssShopifyProjectionInput = {
	document: CssDocument;
	frontend: FrontendResult<CssFact>;
};

/** Projects source-local CSS selector facts without cross-artifact joins. */
export function projectCssToShopify({
	document,
	frontend,
}: CssShopifyProjectionInput): SemanticContribution {
	if (
		frontend.path !== document.path ||
		frontend.language !== document.language
	) {
		throw new Error(
			"CSS projection document and frontend result must share scope",
		);
	}
	const fileEvidence = anchor(0, document.source.length);
	const fileId = id("entity", "shopify.source-file", document.path);
	const entities = new Map<string, SemanticEntity>();
	const occurrences: SemanticOccurrence[] = [];
	const relations: SemanticRelation[] = [];
	const boundaries: SemanticBoundary[] = [];
	const boundaryIds = new Map<string, string>();
	entities.set(fileId, {
		id: fileId,
		kind: "shopify.source-file",
		identity: {
			scheme: "shopify.source-file",
			components: { path: document.path },
		},
		name: basename(document.path),
		path: document.path,
		attributes: {
			language: document.language,
			role: sourceRole(document.path),
		},
		assertion: assertion([fileEvidence], [fileId]),
	});

	for (const boundary of frontend.boundaries) {
		const semanticId = id(
			"boundary",
			"css-frontend",
			document.path,
			boundary.id,
		);
		boundaryIds.set(boundary.id, semanticId);
		boundaries.push({
			id: semanticId,
			kind: boundary.kind === "budget" ? "budget" : "unsupported",
			message: boundary.message,
			subjectIds: [fileId],
			evidence: [
				boundary.range
					? { path: document.path, range: boundary.range }
					: fileEvidence,
			],
			attributes: { frontendBoundaryKind: boundary.kind },
		});
	}

	for (const fact of frontend.facts) {
		const occurrenceId = id(
			"occurrence",
			"shopify.class-selector-site",
			document.path,
			String(fact.evidence.range.start),
			String(fact.evidence.range.end),
		);
		const classId = id("entity", "shopify.css-class", document.path, fact.name);
		const occurrence: SemanticOccurrence = {
			id: occurrenceId,
			kind: "shopify.class-selector-site",
			ownerId: fileId,
			name: fact.name,
			attributes: {
				name: fact.name,
				selector: document.source.slice(
					fact.selectorEvidence.range.start,
					fact.selectorEvidence.range.end,
				),
			},
			assertion: assertion([fact.evidence], [fileId]),
		};
		const symbol: SemanticEntity = {
			id: classId,
			kind: "shopify.css-class",
			identity: {
				scheme: "shopify.css-class",
				components: { path: document.path, name: fact.name },
			},
			name: fact.name,
			attributes: {},
			assertion: assertion([fact.nameEvidence], [fileId]),
		};
		const relation: SemanticRelation = {
			id: id("relation", "shopify.selects-class", occurrenceId, classId),
			kind: "shopify.selects-class",
			from: occurrenceId,
			to: classId,
			guards: [],
			attributes: {},
			assertion: assertion([fact.nameEvidence], [occurrenceId, classId]),
		};
		occurrences.push(occurrence);
		entities.set(classId, symbol);
		relations.push(relation);
	}

	const coverage: SemanticCoverage[] = [
		coverageRecord("shopify.source-files", "complete", []),
		...frontend.coverage.map((item) =>
			coverageRecord(
				"shopify.class-selectors",
				item.status,
				item.boundaryIds.flatMap((boundaryId) => {
					const projected = boundaryIds.get(boundaryId);
					return projected ? [projected] : [];
				}),
			),
		),
	];

	return {
		scope: { paths: [document.path], languages: [document.language] },
		entities: sorted(entities.values()),
		occurrences: sorted(occurrences),
		relations: sorted(relations),
		values: [],
		predicates: [],
		boundaries: sorted(boundaries),
		coverage: sorted(coverage),
		diagnostics: frontend.diagnostics.map((diagnostic) => ({
			severity: diagnostic.severity,
			code: diagnostic.code,
			message: diagnostic.message,
			evidence: diagnostic.range
				? [{ path: document.path, range: diagnostic.range }]
				: [fileEvidence],
		})),
	};

	function coverageRecord(
		family: SemanticCoverage["family"],
		status: SemanticCoverage["status"],
		projectedBoundaryIds: readonly string[],
	): SemanticCoverage {
		return {
			id: id("coverage", family, document.path),
			family,
			scope: { paths: [document.path], languages: [document.language] },
			status,
			boundaryIds: [...projectedBoundaryIds].sort(),
		};
	}

	function anchor(start: number, end: number): SourceAnchor {
		return { path: document.path, range: { start, end } };
	}
}

function assertion(
	evidence: readonly SourceAnchor[],
	sourceIds: readonly string[],
): AssertionMetadata {
	return {
		epistemic: { status: "proven", basis: "syntax" },
		availability: "static",
		provenance: { authorities: ["authored-source"], sourceIds: [...sourceIds] },
		evidence: [...evidence],
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

function sorted<T extends { id: string }>(records: Iterable<T>): T[] {
	return [...records].sort((left, right) => left.id.localeCompare(right.id));
}
