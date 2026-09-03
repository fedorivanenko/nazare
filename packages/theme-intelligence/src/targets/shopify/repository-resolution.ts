import type {
	SemanticAssemblyDraft,
	SemanticAssemblyPass,
} from "../../compiler/semantic-graph-assembler.js";
import type { SemanticEntity } from "../../outputs/semantic-graph-snapshot.js";
import type { SourceAnchor } from "../../semantic/evidence.js";

/** Strengthens literal snippet references only after repository scope is assembled. */
export const shopifyRepositoryResolutionPass: SemanticAssemblyPass = {
	id: "shopify-repository-resolution",
	apply(draft, context) {
		const repositoryPaths = [
			...new Set(
				context.contributions.flatMap(({ scope }) => [...scope.paths]),
			),
		].sort();
		const partialScopeBoundaryId =
			context.repositoryScope.status === "partial"
				? addPartialScopeBoundary(draft)
				: undefined;
		for (const [family, kind] of [
			["shopify.source-files", "shopify.source-file"],
			["shopify.snippets", "shopify.snippet"],
		] as const) {
			draft.coverage.push({
				id: `coverage:${family}:repository`,
				family,
				scope: {
					...(context.repositoryScope.status === "partial" &&
					repositoryPaths.length > 0
						? { paths: repositoryPaths }
						: {}),
					kinds: [kind],
				},
				status:
					context.repositoryScope.status === "complete"
						? "complete"
						: "partial",
				extractor: { id: "shopify-repository-resolution", version: 1 },
				boundaryIds: partialScopeBoundaryId ? [partialScopeBoundaryId] : [],
			});
		}
		const snippets = new Map(
			draft.entities
				.filter((entity) => entity.kind === "shopify.snippet")
				.map((entity) => [entity.id, entity]),
		);
		for (const [index, relation] of draft.relations.entries()) {
			if (relation.kind !== "shopify.invokes") continue;
			const target = snippets.get(relation.to);
			if (!target) continue;
			if (target.attributes.defined === true) {
				draft.relations[index] = {
					...relation,
					attributes: {
						...relation.attributes,
						resolution: "repository-exact",
					},
					assertion: {
						...relation.assertion,
						epistemic: { status: "proven", basis: "resolution" },
						provenance: {
							...relation.assertion.provenance,
							sourceIds: unionStrings(relation.assertion.provenance.sourceIds, [
								target.id,
							]),
						},
						evidence: mergeEvidence(
							relation.assertion.evidence,
							target.assertion.evidence.filter(
								(anchor) => anchor.path === target.attributes.path,
							),
						),
					},
				};
				continue;
			}
			if (context.repositoryScope.status !== "complete") continue;
			markMissingTarget(draft, index, target);
		}
	},
};

function addPartialScopeBoundary(draft: SemanticAssemblyDraft): string {
	const boundaryId = "boundary:shopify:partial-repository-scope";
	const subjects = draft.entities.filter(
		({ kind }) => kind === "shopify.source-file" || kind === "shopify.snippet",
	);
	draft.boundaries.push({
		id: boundaryId,
		kind: "external-data",
		message:
			"Repository discovery is incomplete because only a partial contribution scope was supplied",
		subjectIds: subjects.map(({ id }) => id).sort(),
		evidence: mergeEvidence(
			[],
			subjects.flatMap(({ assertion }) => [...assertion.evidence]),
		),
		attributes: { scope: "partial-repository" },
	});
	return boundaryId;
}

function markMissingTarget(
	draft: SemanticAssemblyDraft,
	relationIndex: number,
	target: SemanticEntity,
): void {
	const relation = draft.relations[relationIndex];
	if (!relation) return;
	const boundaryId = ["boundary", "unresolved-reference", relation.id]
		.map((part) => encodeURIComponent(part))
		.join(":");
	const evidence = mergeEvidence(
		relation.assertion.evidence,
		target.assertion.evidence,
	);
	draft.boundaries.push({
		id: boundaryId,
		kind: "unresolved-reference",
		message: `Referenced Shopify snippet ${target.name ?? target.path ?? target.id} is not defined in the complete repository scope`,
		subjectIds: [relation.id, target.id].sort(),
		evidence,
		attributes: { resolution: "not-found" },
	});
	draft.relations[relationIndex] = {
		...relation,
		attributes: { ...relation.attributes, resolution: "not-found" },
		assertion: {
			...relation.assertion,
			boundaryIds: unionStrings(relation.assertion.boundaryIds, [boundaryId]),
		},
	};
	draft.diagnostics.push({
		severity: "warning",
		code: "SHOPIFY_SNIPPET_NOT_FOUND",
		message: `Referenced snippet ${target.name ?? target.id} was not found`,
		evidence,
	});
}

function unionStrings<Value extends string>(
	left: readonly Value[],
	right: readonly Value[],
): Value[] {
	return [...new Set([...left, ...right])].sort();
}

function mergeEvidence(
	left: readonly SourceAnchor[],
	right: readonly SourceAnchor[],
): SourceAnchor[] {
	const evidence = new Map<string, SourceAnchor>();
	for (const anchor of [...left, ...right]) {
		const key = `${anchor.path}:${anchor.range.start}:${anchor.range.end}:${anchor.role ?? ""}`;
		evidence.set(key, structuredClone(anchor));
	}
	return [...evidence.values()].sort(
		(leftAnchor, rightAnchor) =>
			leftAnchor.path.localeCompare(rightAnchor.path) ||
			leftAnchor.range.start - rightAnchor.range.start ||
			leftAnchor.range.end - rightAnchor.range.end,
	);
}
