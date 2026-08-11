import type { SemanticContribution } from "../../compiler/semantic-contribution.js";
import type { FrontendResult } from "../../frontends/frontend.js";
import type { JavaScriptFact } from "../../frontends/javascript/facts.js";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticOccurrence,
	SemanticRelation,
} from "../../outputs/semantic-graph-snapshot.js";
import type { JavaScriptDocument } from "../../parsers/javascript/parser.js";
import type { AssertionMetadata } from "../../semantic/assertion.js";
import type { SourceAnchor } from "../../semantic/evidence.js";

export type JavaScriptShopifyProjectionInput = {
	document: JavaScriptDocument;
	frontend: FrontendResult<JavaScriptFact>;
};

/** Projects direct browser class operations without cross-artifact joins. */
export function projectJavaScriptToShopify({
	document,
	frontend,
}: JavaScriptShopifyProjectionInput): SemanticContribution {
	if (
		frontend.path !== document.path ||
		frontend.language !== document.language
	) {
		throw new Error(
			"JavaScript projection document and frontend result must share scope",
		);
	}
	const fileEvidence = anchor(0, document.source.length);
	const fileId = id("entity", "shopify.source-file", document.path);
	const browserBoundaryId = id("boundary", "browser-runtime", document.path);
	const entities = new Map<string, SemanticEntity>();
	const occurrences: SemanticOccurrence[] = [];
	const relations: SemanticRelation[] = [];
	const boundaries: SemanticBoundary[] = [];
	const frontendBoundaryIds = new Map<string, string>();
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
		assertion: staticAssertion([fileEvidence], [fileId]),
	});

	for (const boundary of frontend.boundaries) {
		const semanticId = id(
			"boundary",
			"javascript-frontend",
			document.path,
			boundary.id,
		);
		frontendBoundaryIds.set(boundary.id, semanticId);
		boundaries.push({
			id: semanticId,
			kind:
				boundary.kind === "budget"
					? "budget"
					: boundary.kind === "dynamic-syntax"
						? "browser-runtime"
						: "unsupported",
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
			"shopify.class-list-operation-site",
			document.path,
			String(fact.nameEvidence.range.start),
			String(fact.nameEvidence.range.end),
			fact.action,
		);
		const classId = id("entity", "shopify.css-class", document.path, fact.name);
		const occurrence: SemanticOccurrence = {
			id: occurrenceId,
			kind: "shopify.class-list-operation-site",
			ownerId: fileId,
			name: fact.name,
			attributes: { name: fact.name, action: fact.action },
			assertion: runtimeAssertion(
				[fact.operationEvidence],
				[fileId],
				browserBoundaryId,
			),
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
			assertion: staticAssertion([fact.nameEvidence], [fileId]),
		};
		const relation: SemanticRelation = {
			id: id("relation", "shopify.uses-class", occurrenceId, classId),
			kind: "shopify.uses-class",
			from: occurrenceId,
			to: classId,
			guards: [],
			attributes: { role: fact.action },
			assertion: runtimeAssertion(
				[fact.nameEvidence],
				[occurrenceId, classId],
				browserBoundaryId,
			),
		};
		occurrences.push(occurrence);
		entities.set(classId, symbol);
		relations.push(relation);
	}

	if (occurrences.length > 0) {
		boundaries.push({
			id: browserBoundaryId,
			kind: "browser-runtime",
			message: "JavaScript class operations execute in browser runtime",
			subjectIds: [
				...occurrences.map(({ id: occurrenceId }) => occurrenceId),
				...relations.map(({ id: relationId }) => relationId),
			].sort(),
			evidence: frontend.facts.map(
				({ operationEvidence }) => operationEvidence,
			),
			attributes: {},
		});
	}

	const coverage: SemanticCoverage[] = [
		coverageRecord("shopify.source-files", "complete", []),
		...frontend.coverage.map((item) =>
			coverageRecord(
				"shopify.class-list-operations",
				item.status,
				item.boundaryIds.flatMap((boundaryId) => {
					const projected = frontendBoundaryIds.get(boundaryId);
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

function staticAssertion(
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

function runtimeAssertion(
	evidence: readonly SourceAnchor[],
	sourceIds: readonly string[],
	boundaryId: string,
): AssertionMetadata {
	return {
		epistemic: { status: "proven", basis: "syntax" },
		availability: "runtime-dependent",
		provenance: { authorities: ["authored-source"], sourceIds: [...sourceIds] },
		evidence: [...evidence],
		boundaryIds: [boundaryId],
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
