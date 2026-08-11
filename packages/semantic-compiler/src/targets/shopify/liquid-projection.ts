import type { SemanticContribution } from "../../compiler/semantic-contribution.js";
import type { FrontendResult } from "../../frontends/frontend.js";
import type {
	LiquidAccessPath,
	LiquidConditionFact,
	LiquidFact,
	LiquidGuardFact,
	LiquidMarkupAttributeFact,
	LiquidPredicateFact,
	LiquidPredicateOperand,
	LiquidReference,
} from "../../frontends/liquid/facts.js";
import type {
	SemanticBoundary,
	SemanticCoverage,
	SemanticEntity,
	SemanticOccurrence,
	SemanticPredicate,
	SemanticRelation,
	SemanticValue,
} from "../../outputs/semantic-graph-snapshot.js";
import type { LiquidDocument } from "../../parsers/liquid/parser.js";
import type { AssertionMetadata } from "../../semantic/assertion.js";
import type { SourceAnchor, SourceRange } from "../../semantic/evidence.js";
import type { JsonValue, SemanticRecordId } from "../../semantic/record.js";

export type LiquidShopifyProjectionInput = {
	document: LiquidDocument;
	frontend: FrontendResult<LiquidFact>;
};

const coverageInputs = {
	"shopify.reads": ["liquid.access-paths"],
	"shopify.bindings": ["liquid.bindings"],
	"shopify.filters": ["liquid.filters"],
	"shopify.conditions": [
		"liquid.predicates",
		"liquid.conditions",
		"liquid.guards",
	],
	"shopify.renders": ["liquid.render-sites", "liquid.render-arguments"],
	"shopify.schema-regions": ["liquid.schema-regions"],
	"shopify.asset-references": ["liquid.asset-references"],
	"shopify.locale-references": ["liquid.locale-references"],
	"shopify.markup-attributes": ["liquid.markup-attributes"],
} as const;

/** Projects source-local Liquid facts into Shopify domain semantics. */
export function projectLiquidToShopify({
	document,
	frontend,
}: LiquidShopifyProjectionInput): SemanticContribution {
	if (
		frontend.path !== document.path ||
		frontend.language !== document.language
	) {
		throw new Error(
			"Liquid projection document and frontend result must share scope",
		);
	}

	const entities = new Map<string, SemanticEntity>();
	const occurrences: SemanticOccurrence[] = [];
	const relations: SemanticRelation[] = [];
	const values = new Map<string, SemanticValue>();
	const predicates = new Map<string, SemanticPredicate>();
	const boundaries: SemanticBoundary[] = [];
	const runtimeSubjectIds = new Set<SemanticRecordId>();
	const runtimeEvidence = new Map<string, SourceAnchor>();
	const projectedFrontendBoundaries = new Map<string, string>();
	const projectionCoverageBoundaries = new Map<string, Set<string>>();
	const occurrenceByFact = new Map<LiquidFact, SemanticOccurrence>();
	const renderSiteByEvidence = new Map<string, SemanticOccurrence>();
	const conditionByPredicateEvidence = new Map<string, SemanticOccurrence>();
	const basePredicateByEvidence = new Map<string, string>();
	const guards: Array<{ fact: LiquidGuardFact; predicateId: string }> = [];
	const unresolvedGuards: Array<{ range: SourceRange; boundaryId: string }> =
		[];
	const runtimeBoundaryId = id("boundary", "shopify-runtime", document.path);
	const fileId = id("entity", "shopify.source-file", document.path);
	const fileEvidence = anchor({ start: 0, end: document.source.length });

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
		assertion: assertion([fileEvidence], [], "proven", "syntax", "static"),
	});

	const currentSnippet = snippetHandle(document.path);
	if (currentSnippet) {
		const snippet = ensureSnippet(currentSnippet, fileEvidence, "defined");
		relations.push({
			id: id("relation", "shopify.defines", fileId, snippet.id),
			kind: "shopify.defines",
			from: fileId,
			to: snippet.id,
			guards: [],
			attributes: {},
			assertion: assertion(
				[fileEvidence],
				[fileId],
				"inferred",
				"convention",
				"static",
			),
		});
	}

	projectFrontendBoundaries();

	for (const fact of frontend.facts) projectOccurrence(fact);
	for (const fact of frontend.facts) {
		if (fact.kind === "liquid.predicate") projectPredicate(fact);
	}
	for (const fact of frontend.facts) {
		if (fact.kind === "liquid.condition") ensureConditionPredicates(fact);
	}
	for (const fact of frontend.facts) {
		if (fact.kind === "liquid.guard") projectGuard(fact);
	}
	for (const fact of frontend.facts) projectRelations(fact);

	if (runtimeSubjectIds.size > 0) {
		boundaries.push({
			id: runtimeBoundaryId,
			kind: "shopify-runtime",
			message:
				"Liquid expressions and conditions require Shopify runtime values",
			subjectIds: [...runtimeSubjectIds].sort(),
			evidence: [...runtimeEvidence.values()].sort(compareAnchor),
			attributes: {},
		});
	}

	const coverage = projectCoverage();
	return {
		scope: { paths: [document.path], languages: [document.language] },
		entities: sortRecords(entities.values()),
		occurrences: sortRecords(occurrences),
		relations: sortRecords(relations),
		values: sortRecords(values.values()),
		predicates: sortRecords(predicates.values()),
		boundaries: sortRecords(boundaries),
		coverage: sortRecords(coverage),
		diagnostics: frontend.diagnostics.map((diagnostic) => ({
			severity: diagnostic.severity,
			code: diagnostic.code,
			message: diagnostic.message,
			evidence: diagnostic.range ? [anchor(diagnostic.range)] : [fileEvidence],
		})),
	};

	function projectOccurrence(fact: LiquidFact): void {
		switch (fact.kind) {
			case "liquid.access-path": {
				const occurrence = addOccurrence(fact, "shopify.expression-site", {
					expression: source(fact.evidence),
					context: fact.context,
					root: fact.path.root.name,
					segments: fact.path.segments.map(
						(segment): JsonValue =>
							segment.kind === "property"
								? { kind: "property", name: segment.name }
								: {
										kind: "index",
										expression: source(segment.expressionEvidence),
									},
					),
				});
				addExpressionValue(
					occurrence.id,
					"shopify.read-value",
					fact.evidence,
					source(fact.evidence),
					true,
				);
				break;
			}
			case "liquid.binding": {
				const occurrence = addOccurrence(fact, "shopify.binding-site", {
					name: fact.name,
					binding: fact.binding,
					scopeStart: fact.scopeEvidence.range.start,
					scopeEnd: fact.scopeEvidence.range.end,
				});
				if ("value" in fact) {
					addExpressionValue(
						occurrence.id,
						"shopify.binding-value",
						fact.value.evidence,
						fact.value.text,
						true,
					);
				}
				break;
			}
			case "liquid.filter": {
				const occurrence = addOccurrence(fact, "shopify.filter-site", {
					name: fact.name,
					input: fact.input.text,
					arguments: fact.arguments.map(({ text }) => text),
				});
				const inputValueId = addExpressionValue(
					occurrence.id,
					"shopify.filter-input",
					fact.input.evidence,
					fact.input.text,
					true,
				);
				const argumentValueIds = fact.arguments.map((argument, position) =>
					addExpressionValue(
						occurrence.id,
						"shopify.filter-argument",
						argument.evidence,
						argument.text,
						true,
						String(position),
						{ position },
					),
				);
				addDerivedValue(
					occurrence.id,
					"shopify.filter-result",
					fact.evidence,
					fact.name,
					fact.evidence.path === fact.input.evidence.path
						? source(fact.evidence)
						: fact.input.text,
					[inputValueId, ...argumentValueIds],
				);
				break;
			}
			case "liquid.markup-attribute": {
				const occurrence = addOccurrence(
					fact,
					"shopify.markup-attribute-site",
					{
						name: fact.name,
						element: fact.element,
						valueKind: fact.valueKind,
					},
				);
				addMarkupAttributeValue(occurrence.id, fact);
				break;
			}
			case "liquid.condition": {
				const occurrence = addOccurrence(fact, "shopify.condition-site", {
					construct: fact.construct,
					bodyStart: fact.bodyEvidence.range.start,
					bodyEnd: fact.bodyEvidence.range.end,
				});
				for (const evidence of fact.predicateEvidence) {
					conditionByPredicateEvidence.set(anchorKey(evidence), occurrence);
				}
				break;
			}
			case "liquid.render-site": {
				const target = referenceSource(fact.target);
				const occurrence = addOccurrence(fact, "shopify.render-site", {
					targetKind: fact.target.kind,
					target,
				});
				renderSiteByEvidence.set(anchorKey(fact.evidence), occurrence);
				const dynamic = fact.target.kind === "dynamic";
				const boundaryId = dynamic
					? addBoundary(
							"dynamic-target",
							"Dynamic Liquid render target cannot be resolved statically",
							[occurrence.id],
							[fact.evidence],
						)
					: undefined;
				const valueId = id("value", "shopify.render-target", occurrence.id);
				values.set(valueId, {
					id: valueId,
					ownerId: occurrence.id,
					slot: "shopify.render-target",
					representation: dynamic ? "expression" : "literal",
					authority: "authored-source",
					...(dynamic ? { expression: target } : { resolved: target }),
					sourceValueIds: [],
					attributes: {},
					assertion: assertion(
						[
							fact.target.kind === "literal"
								? fact.target.evidence
								: fact.target.expressionEvidence,
						],
						[occurrence.id],
						"proven",
						"syntax",
						dynamic ? "runtime-dependent" : "static",
						boundaryId ? [boundaryId] : [],
					),
				});
				break;
			}
			case "liquid.render-argument": {
				const argument = fact.argument;
				const occurrence = addOccurrence(fact, "shopify.render-argument-site", {
					argumentKind: argument.kind,
					...(argument.kind === "named"
						? { name: argument.name }
						: argument.alias
							? { name: argument.alias.name }
							: {}),
					expression: argument.value.text,
				});
				addExpressionValue(
					occurrence.id,
					"shopify.render-argument-value",
					argument.value.evidence,
					argument.value.text,
					true,
				);
				break;
			}
			case "liquid.schema-region":
				addOccurrence(fact, "shopify.schema-region", {
					contentStart: fact.contentEvidence.range.start,
					contentEnd: fact.contentEvidence.range.end,
				});
				break;
			case "liquid.asset-reference":
				addOccurrence(fact, "shopify.asset-reference-site", {
					syntax: fact.syntax,
					referenceKind: fact.reference.kind,
					reference: referenceSource(fact.reference),
				});
				break;
			case "liquid.locale-reference":
				addOccurrence(fact, "shopify.locale-reference-site", {
					referenceKind: fact.key.kind,
					key: referenceSource(fact.key),
				});
				break;
			case "liquid.predicate":
			case "liquid.guard":
				break;
		}
	}

	function addOccurrence(
		fact: LiquidFact,
		kind: SemanticOccurrence["kind"],
		attributes: SemanticOccurrence["attributes"],
	): SemanticOccurrence {
		const occurrence: SemanticOccurrence = {
			id: id(
				"occurrence",
				kind,
				document.path,
				fact.evidence.range.start,
				fact.evidence.range.end,
			),
			kind,
			ownerId: fileId,
			attributes,
			assertion: assertion(
				[fact.evidence],
				[fileId],
				"proven",
				"syntax",
				"static",
			),
		};
		occurrences.push(occurrence);
		occurrenceByFact.set(fact, occurrence);
		return occurrence;
	}

	function projectPredicate(fact: LiquidPredicateFact): void {
		const predicateId = predicateRecordId(fact.evidence);
		const ownerId = conditionOwner(fact.evidence)?.id ?? fileId;
		const operands = fact.operands.map((operand, index) =>
			projectPredicateOperand(operand, ownerId, predicateId, index),
		);
		const predicate: SemanticPredicate = {
			id: predicateId,
			kind: "shopify.liquid-predicate",
			operator: fact.operator,
			operands,
			attributes: { expression: source(fact.evidence) },
			assertion: runtimeAssertion([fact.evidence], [ownerId]),
		};
		predicates.set(predicate.id, predicate);
		basePredicateByEvidence.set(anchorKey(fact.evidence), predicate.id);
		addRuntimeSubject(predicate.id, fact.evidence);
	}

	function ensureConditionPredicates(fact: LiquidConditionFact): void {
		if (fact.construct === "case" || fact.construct === "when") {
			const occurrence = occurrenceByFact.get(fact);
			if (occurrence) {
				const boundaryId = addBoundary(
					"unsupported",
					"Case/when predicate projection requires selector-value correlation",
					[occurrence.id],
					[fact.evidence],
				);
				coverageBoundary("shopify.conditions", boundaryId);
			}
			return;
		}
		const owner = occurrenceByFact.get(fact);
		if (!owner) return;
		for (const evidence of fact.predicateEvidence) {
			const key = anchorKey(evidence);
			if (basePredicateByEvidence.has(key)) continue;
			const valueId = addExpressionValue(
				owner.id,
				"shopify.condition-operand",
				evidence,
				source(evidence),
				true,
			);
			const predicateId = predicateRecordId(evidence);
			predicates.set(predicateId, {
				id: predicateId,
				kind: "shopify.liquid-predicate",
				operator: "truthy",
				operands: [{ kind: "value", valueId }],
				attributes: { expression: source(evidence) },
				assertion: runtimeAssertion([evidence], [owner.id, valueId]),
			});
			basePredicateByEvidence.set(key, predicateId);
			addRuntimeSubject(predicateId, evidence);
		}
	}

	function projectGuard(fact: LiquidGuardFact): void {
		if (fact.outcome === "case-match") {
			addUnresolvedGuard(fact);
			return;
		}
		if (fact.outcome === "iterates" || fact.outcome === "empty") {
			const owner = conditionOwner(fact.conditionEvidence)?.id ?? fileId;
			const valueId = addExpressionValue(
				owner,
				"shopify.condition-operand",
				fact.conditionEvidence,
				source(fact.conditionEvidence),
				true,
				`${fact.outcome}:${fact.guardedEvidence.range.start}:${fact.guardedEvidence.range.end}`,
			);
			const predicateId = guardPredicate(
				fact,
				fact.outcome === "iterates" ? "not-blank" : "blank",
				{ kind: "value", valueId },
			);
			guards.push({ fact, predicateId });
			return;
		}
		const baseId = basePredicateByEvidence.get(
			anchorKey(fact.conditionEvidence),
		);
		if (!baseId) {
			addUnresolvedGuard(fact);
			return;
		}
		const predicateId =
			fact.outcome === "false"
				? guardPredicate(fact, "not", {
						kind: "predicate",
						predicateId: baseId,
					})
				: baseId;
		guards.push({ fact, predicateId });
	}

	function addUnresolvedGuard(fact: LiquidGuardFact): void {
		const boundaryId = addBoundary(
			"unsupported",
			"Liquid guard could not be represented as a semantic predicate",
			[fileId],
			[fact.conditionEvidence, fact.guardedEvidence],
		);
		coverageBoundary("shopify.conditions", boundaryId);
		unresolvedGuards.push({ range: fact.guardedEvidence.range, boundaryId });
	}

	function guardPredicate(
		fact: LiquidGuardFact,
		operator: "not" | "blank" | "not-blank",
		operand: SemanticPredicate["operands"][number],
	): string {
		const predicateId = id(
			"predicate",
			"shopify.liquid-predicate",
			document.path,
			fact.conditionEvidence.range.start,
			fact.conditionEvidence.range.end,
			operator,
			fact.guardedEvidence.range.start,
			fact.guardedEvidence.range.end,
		);
		predicates.set(predicateId, {
			id: predicateId,
			kind: "shopify.liquid-predicate",
			operator,
			operands: [operand],
			attributes: { expression: source(fact.conditionEvidence) },
			assertion: runtimeAssertion([fact.conditionEvidence], [fileId]),
		});
		addRuntimeSubject(predicateId, fact.conditionEvidence);
		return predicateId;
	}

	function projectPredicateOperand(
		operand: LiquidPredicateOperand,
		ownerId: string,
		predicateId: string,
		index: number,
	): SemanticPredicate["operands"][number] {
		switch (operand.kind) {
			case "access-path": {
				const evidence = accessPathEvidence(operand.path);
				const valueId = addExpressionValue(
					ownerId,
					"shopify.condition-operand",
					evidence,
					source(evidence),
					true,
					`${predicateId}:${index}`,
				);
				return { kind: "value", valueId };
			}
			case "predicate":
				return {
					kind: "predicate",
					predicateId: predicateRecordId(operand.evidence),
				};
			case "string":
			case "number":
			case "boolean":
				return { kind: "literal", value: operand.value };
			case "nil":
				return { kind: "literal", value: null };
			case "empty":
			case "blank":
				return { kind: "literal", value: { sentinel: operand.kind } };
		}
	}

	function projectRelations(fact: LiquidFact): void {
		if (fact.kind === "liquid.markup-attribute") {
			const occurrence = occurrenceByFact.get(fact);
			if (!occurrence) return;
			const attribute = ensureDomAttribute(fact.name, fact.nameEvidence);
			const guardIds = guardsFor(fact.evidence);
			relations.push({
				id: id(
					"relation",
					"shopify.emits-attribute",
					occurrence.id,
					attribute.id,
				),
				kind: "shopify.emits-attribute",
				from: occurrence.id,
				to: attribute.id,
				guards: guardIds,
				attributes: {},
				assertion: assertion(
					[fact.nameEvidence],
					[occurrence.id, attribute.id],
					"proven",
					"syntax",
					guardIds.length > 0 ? "runtime-dependent" : "static",
					guardIds.length > 0 ? [runtimeBoundaryId] : [],
				),
			});
			if (guardIds.length > 0)
				addRuntimeSubject(relations.at(-1)?.id ?? occurrence.id, fact.evidence);
		}
		if (fact.kind === "liquid.render-site") {
			const render = occurrenceByFact.get(fact);
			if (!render || fact.target.kind !== "literal") return;
			const snippet = ensureSnippet(
				fact.target.value,
				fact.target.evidence,
				"referenced",
			);
			const guardIds = guardsFor(fact.evidence);
			const unresolvedBoundaryIds = unresolvedGuards
				.filter(({ range }) => contains(range, fact.evidence.range))
				.map(({ boundaryId }) => boundaryId)
				.sort();
			const relationBoundaryIds = [
				...(guardIds.length > 0 ? [runtimeBoundaryId] : []),
				...unresolvedBoundaryIds,
			];
			relations.push({
				id: id("relation", "shopify.invokes", render.id, snippet.id),
				kind: "shopify.invokes",
				from: render.id,
				to: snippet.id,
				guards: guardIds,
				attributes: { resolution: "literal-convention" },
				assertion: assertion(
					[fact.evidence],
					[render.id, snippet.id],
					"inferred",
					"convention",
					guardIds.length > 0 || unresolvedBoundaryIds.length > 0
						? "runtime-dependent"
						: "static",
					relationBoundaryIds,
				),
			});
			if (guardIds.length > 0)
				addRuntimeSubject(relations.at(-1)?.id ?? render.id, fact.evidence);
		}
		if (fact.kind === "liquid.render-argument") {
			const argument = occurrenceByFact.get(fact);
			const render = renderSiteByEvidence.get(
				anchorKey(fact.renderSiteEvidence),
			);
			if (!argument || !render) return;
			relations.push({
				id: id("relation", "shopify.passes-argument", render.id, argument.id),
				kind: "shopify.passes-argument",
				from: render.id,
				to: argument.id,
				guards: [],
				attributes: {},
				assertion: assertion(
					[fact.evidence],
					[render.id, argument.id],
					"proven",
					"syntax",
					"static",
				),
			});
		}
	}

	function conditionOwner(
		evidence: SourceAnchor,
	): SemanticOccurrence | undefined {
		const exact = conditionByPredicateEvidence.get(anchorKey(evidence));
		if (exact) return exact;
		for (const fact of frontend.facts) {
			if (fact.kind !== "liquid.condition") continue;
			if (
				fact.predicateEvidence.some((candidate) =>
					contains(candidate.range, evidence.range),
				)
			)
				return occurrenceByFact.get(fact);
		}
		return undefined;
	}

	function guardsFor(evidence: SourceAnchor): string[] {
		return guards
			.filter(({ fact }) =>
				contains(fact.guardedEvidence.range, evidence.range),
			)
			.map(({ predicateId }) => predicateId)
			.sort();
	}

	function addMarkupAttributeValue(
		ownerId: string,
		fact: LiquidMarkupAttributeFact,
	): void {
		const evidence = fact.valueEvidence ?? fact.nameEvidence;
		const rawValue = fact.valueEvidence ? source(fact.valueEvidence) : "true";
		const valueId = id(
			"value",
			"shopify.markup-attribute-value",
			ownerId,
			evidence.range.start,
			evidence.range.end,
		);
		const runtime = fact.valueKind === "dynamic" || fact.valueKind === "mixed";
		const resolved =
			fact.valueKind === "boolean"
				? true
				: fact.valueKind === "literal"
					? unquoteMarkupValue(rawValue)
					: undefined;
		values.set(valueId, {
			id: valueId,
			ownerId,
			slot: "shopify.markup-attribute-value",
			representation: runtime ? "expression" : "literal",
			authority: "authored-source",
			...(runtime ? { expression: rawValue } : { resolved: resolved ?? null }),
			sourceValueIds: [],
			attributes: { valueKind: fact.valueKind },
			assertion: runtime
				? runtimeAssertion([evidence], [ownerId])
				: assertion([evidence], [ownerId], "proven", "syntax", "static"),
		});
		if (runtime) addRuntimeSubject(valueId, evidence);
	}

	function addExpressionValue(
		ownerId: string,
		slot: SemanticValue["slot"],
		evidence: SourceAnchor,
		expression: string,
		runtime: boolean,
		discriminator = "",
		attributes: SemanticValue["attributes"] = {},
	): string {
		const valueId = id(
			"value",
			slot,
			ownerId,
			evidence.range.start,
			evidence.range.end,
			discriminator,
		);
		const literal = liquidLiteral(expression);
		const requiresRuntime = runtime && !literal.found;
		values.set(valueId, {
			id: valueId,
			ownerId,
			slot,
			representation: literal.found ? "literal" : "expression",
			authority: "authored-source",
			...(literal.found ? { resolved: literal.value } : { expression }),
			sourceValueIds: [],
			attributes,
			assertion: requiresRuntime
				? runtimeAssertion([evidence], [ownerId])
				: assertion([evidence], [ownerId], "proven", "syntax", "static"),
		});
		if (requiresRuntime) addRuntimeSubject(valueId, evidence);
		return valueId;
	}

	function addDerivedValue(
		ownerId: string,
		slot: SemanticValue["slot"],
		evidence: SourceAnchor,
		operation: string,
		expression: string,
		sourceValueIds: readonly string[],
	): string {
		const valueId = id(
			"value",
			slot,
			ownerId,
			evidence.range.start,
			evidence.range.end,
		);
		const sourceValues = sourceValueIds.flatMap((sourceId) => {
			const value = values.get(sourceId);
			return value ? [value] : [];
		});
		const runtime = sourceValues.some(
			({ assertion: sourceAssertion }) =>
				sourceAssertion.availability !== "static",
		);
		const boundaryIds = [
			...new Set(
				sourceValues.flatMap(
					({ assertion: sourceAssertion }) => sourceAssertion.boundaryIds,
				),
			),
		].sort();
		values.set(valueId, {
			id: valueId,
			ownerId,
			slot,
			representation: "derived",
			authority: "authored-source",
			expression,
			sourceValueIds,
			attributes: { filter: operation },
			assertion: assertion(
				[evidence],
				[ownerId, ...sourceValueIds],
				"inferred",
				"bounded-analysis",
				runtime ? "runtime-dependent" : "static",
				boundaryIds,
			),
		});
		if (runtime) addRuntimeSubject(valueId, evidence);
		return valueId;
	}

	function addRuntimeSubject(subjectId: string, evidence: SourceAnchor): void {
		runtimeSubjectIds.add(subjectId);
		runtimeEvidence.set(anchorKey(evidence), evidence);
	}

	function runtimeAssertion(
		evidence: readonly SourceAnchor[],
		sourceIds: readonly string[],
	): AssertionMetadata {
		return assertion(
			evidence,
			sourceIds,
			"proven",
			"syntax",
			"runtime-dependent",
			[runtimeBoundaryId],
		);
	}

	function ensureDomAttribute(
		name: string,
		evidence: SourceAnchor,
	): SemanticEntity {
		const attributeId = id("entity", "shopify.dom-attribute", name);
		const existing = entities.get(attributeId);
		if (existing) return existing;
		const attribute: SemanticEntity = {
			id: attributeId,
			kind: "shopify.dom-attribute",
			identity: {
				scheme: "shopify.dom-attribute",
				components: { name },
			},
			name,
			attributes: {},
			assertion: assertion([evidence], [fileId], "proven", "syntax", "static"),
		};
		entities.set(attributeId, attribute);
		return attribute;
	}

	function ensureSnippet(
		handleInput: string,
		evidence: SourceAnchor,
		declaration: "defined" | "referenced",
	): SemanticEntity {
		const handle = normalizeSnippetHandle(handleInput);
		const snippetId = id("entity", "shopify.snippet", handle);
		const existing = entities.get(snippetId);
		if (existing) return existing;
		const snippet: SemanticEntity = {
			id: snippetId,
			kind: "shopify.snippet",
			identity: {
				scheme: "shopify.snippet",
				components: { handle },
			},
			name: handle,
			path: `snippets/${handle}.liquid`,
			attributes: {
				path: `snippets/${handle}.liquid`,
				defined: declaration === "defined",
			},
			assertion: assertion(
				[evidence],
				[fileId],
				"inferred",
				"convention",
				"static",
			),
		};
		entities.set(snippetId, snippet);
		return snippet;
	}

	function projectFrontendBoundaries(): void {
		for (const boundary of frontend.boundaries) {
			const boundaryId = id("boundary", "frontend", document.path, boundary.id);
			projectedFrontendBoundaries.set(boundary.id, boundaryId);
			boundaries.push({
				id: boundaryId,
				kind:
					boundary.kind === "budget"
						? "budget"
						: boundary.kind === "dynamic-syntax"
							? "dynamic-target"
							: "unsupported",
				message: boundary.message,
				subjectIds: [fileId],
				evidence: boundary.range ? [anchor(boundary.range)] : [fileEvidence],
				attributes: { frontendBoundaryKind: boundary.kind },
			});
		}
	}

	function projectCoverage(): SemanticCoverage[] {
		const projected: SemanticCoverage[] = [
			coverageRecord("shopify.source-files", [], "complete"),
			coverageRecord("shopify.snippets", [], "complete"),
		];
		for (const [family, inputFamilies] of Object.entries(coverageInputs)) {
			const inputs = frontend.coverage.filter((coverage) =>
				(inputFamilies as readonly string[]).includes(coverage.family),
			);
			const boundaryIds = new Set<string>(
				projectionCoverageBoundaries.get(family),
			);
			for (const input of inputs) {
				for (const boundaryId of input.boundaryIds) {
					const projectedId = projectedFrontendBoundaries.get(boundaryId);
					if (projectedId) boundaryIds.add(projectedId);
				}
			}
			const status =
				inputs.length !== inputFamilies.length ||
				inputs.some(({ status }) => status !== "complete") ||
				boundaryIds.size > 0
					? "partial"
					: "complete";
			projected.push(coverageRecord(family, [...boundaryIds].sort(), status));
		}
		return projected;
	}

	function coverageRecord(
		family: string,
		boundaryIds: readonly string[],
		status: SemanticCoverage["status"],
	): SemanticCoverage {
		return {
			id: id("coverage", family, document.path),
			family: family as SemanticCoverage["family"],
			scope: { paths: [document.path], languages: [document.language] },
			status,
			extractor: {
				id: frontend.frontend.id,
				version: frontend.frontend.version,
			},
			boundaryIds,
		};
	}

	function coverageBoundary(family: string, boundaryId: string): void {
		let ids = projectionCoverageBoundaries.get(family);
		if (!ids) {
			ids = new Set();
			projectionCoverageBoundaries.set(family, ids);
		}
		ids.add(boundaryId);
	}

	function addBoundary(
		kind: SemanticBoundary["kind"],
		message: string,
		subjectIds: readonly string[],
		evidence: readonly SourceAnchor[],
	): string {
		const boundaryId = id(
			"boundary",
			kind,
			document.path,
			evidence[0]?.range.start ?? 0,
			evidence[0]?.range.end ?? 0,
			boundaries.length,
		);
		boundaries.push({
			id: boundaryId,
			kind,
			message,
			subjectIds,
			evidence,
			attributes: {},
		});
		return boundaryId;
	}

	function assertion(
		evidence: readonly SourceAnchor[],
		sourceIds: readonly string[],
		status: "proven" | "inferred",
		basis: AssertionMetadata["epistemic"]["basis"],
		availability: AssertionMetadata["availability"],
		boundaryIds: readonly string[] = [],
	): AssertionMetadata {
		return {
			epistemic: { status, basis },
			availability,
			provenance: {
				authorities: ["authored-source"],
				sourceIds,
			},
			evidence,
			boundaryIds,
		};
	}

	function anchor(range: SourceRange): SourceAnchor {
		return { path: document.path, range };
	}

	function source(evidence: SourceAnchor): string {
		return document.source.slice(evidence.range.start, evidence.range.end);
	}

	function referenceSource(reference: LiquidReference): string {
		return reference.kind === "literal"
			? reference.value
			: source(reference.expressionEvidence);
	}
}

function predicateRecordId(evidence: SourceAnchor): string {
	return id(
		"predicate",
		"shopify.liquid-predicate",
		evidence.path,
		evidence.range.start,
		evidence.range.end,
	);
}

function accessPathEvidence(path: LiquidAccessPath): SourceAnchor {
	const last = path.segments.at(-1);
	const end =
		last?.kind === "property"
			? last.evidence.range.end
			: (last?.expressionEvidence.range.end ?? path.root.evidence.range.end);
	return {
		path: path.root.evidence.path,
		range: { start: path.root.evidence.range.start, end },
	};
}

function snippetHandle(path: string): string | undefined {
	const match = /^snippets\/(.+)\.liquid$/u.exec(path);
	return match?.[1];
}

function normalizeSnippetHandle(handle: string): string {
	return handle.replace(/^snippets\//u, "").replace(/\.liquid$/u, "");
}

function unquoteMarkupValue(value: string): string {
	if (
		value.length >= 2 &&
		((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'")))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function liquidLiteral(
	expression: string,
): { found: true; value: JsonValue } | { found: false } {
	const text = expression.trim();
	if (
		(text.startsWith("'") && text.endsWith("'")) ||
		(text.startsWith('"') && text.endsWith('"'))
	) {
		const quote = text.slice(0, 1);
		return {
			found: true,
			value: text
				.slice(1, -1)
				.replaceAll(`\\${quote}`, quote)
				.replaceAll("\\\\", "\\"),
		};
	}
	if (/^-?(?:\d+\.?\d*|\.\d+)$/u.test(text)) {
		return { found: true, value: Number(text) };
	}
	if (text === "true" || text === "false") {
		return { found: true, value: text === "true" };
	}
	if (text === "nil" || text === "null") return { found: true, value: null };
	return { found: false };
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

function anchorKey(anchor: SourceAnchor): string {
	return `${anchor.path}:${anchor.range.start}:${anchor.range.end}`;
}

function contains(container: SourceRange, candidate: SourceRange): boolean {
	return container.start <= candidate.start && candidate.end <= container.end;
}

function id(...parts: readonly (number | string)[]): string {
	return parts.map((part) => encodeURIComponent(String(part))).join(":");
}

function sortRecords<Record extends { id: string }>(
	records: Iterable<Record>,
): Record[] {
	return [...records].sort((left, right) => left.id.localeCompare(right.id));
}

function compareAnchor(left: SourceAnchor, right: SourceAnchor): number {
	return (
		left.path.localeCompare(right.path) ||
		left.range.start - right.range.start ||
		left.range.end - right.range.end
	);
}
