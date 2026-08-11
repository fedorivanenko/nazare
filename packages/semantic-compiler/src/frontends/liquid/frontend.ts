import type Parser from "tree-sitter";
import type { LiquidDocument } from "../../parsers/liquid/parser.js";
import type { SourceAnchor, SourceRange } from "../../semantic/evidence.js";
import {
	defineFrontend,
	type FrontendBoundary,
	type FrontendCoverage,
	type FrontendDiagnostic,
} from "../frontend.js";
import {
	LIQUID_MECHANICAL_FACT_KINDS,
	type LiquidAccessPath,
	type LiquidAssetReferenceSyntax,
	type LiquidConditionConstruct,
	type LiquidExpressionSource,
	type LiquidFact,
	type LiquidPredicateOperand,
	type LiquidPredicateOperator,
	type LiquidReadContext,
	type LiquidReference,
} from "./facts.js";
import { liquidMechanicalOntology } from "./ontology.js";

const FRONTEND_ID = "tree-sitter-liquid-facts";
const FRONTEND_VERSION = 1;

const predicateOperators: Readonly<Record<string, LiquidPredicateOperator>> = {
	"==": "equal",
	"!=": "not-equal",
	contains: "contains",
	">": "greater-than",
	">=": "greater-than-or-equal",
	"<": "less-than",
	"<=": "less-than-or-equal",
	and: "and",
	or: "or",
};

const assetFilterSyntax: Readonly<Record<string, LiquidAssetReferenceSyntax>> =
	{
		asset_url: "asset-url-filter",
		asset_img_url: "asset-image-url-filter",
		stylesheet_tag: "stylesheet-tag-filter",
		script_tag: "script-tag-filter",
		inline_asset_content: "inline-asset-content-filter",
	};

const allCoverageFamilies = liquidMechanicalOntology.coverageFamilies.map(
	({ kind }) => kind,
);

type Node = Parser.SyntaxNode;
type CoverageFamily = (typeof allCoverageFamilies)[number];

export const liquidFrontend = defineFrontend<LiquidDocument, LiquidFact>({
	id: FRONTEND_ID,
	version: FRONTEND_VERSION,
	languages: ["liquid"],
	ontology: {
		namespace: liquidMechanicalOntology.namespace,
		version: liquidMechanicalOntology.version,
	},
	factKinds: LIQUID_MECHANICAL_FACT_KINDS,
	extract({ document, limits }) {
		const facts: LiquidFact[] = [];
		const diagnostics: FrontendDiagnostic[] = document.diagnostics.map(
			(diagnostic) => ({
				severity: "error",
				code: diagnostic.code,
				message: diagnostic.message,
				range: diagnostic.range,
			}),
		);
		const boundaries: FrontendBoundary[] = [];
		const coverageBoundaries = new Map<CoverageFamily, Set<string>>(
			allCoverageFamilies.map((family) => [family, new Set<string>()]),
		);
		let visited = 0;
		let boundarySequence = 0;
		let budgetExhausted = false;

		for (const diagnostic of document.diagnostics) {
			addBoundary(
				"unsupported-syntax",
				`Liquid parser could not fully interpret this source: ${diagnostic.message}`,
				diagnostic.range,
				allCoverageFamilies,
			);
		}
		for (const diagnostic of document.markupDiagnostics) {
			diagnostics.push({
				severity: "error",
				code: diagnostic.code,
				message: diagnostic.message,
				range: diagnostic.range,
			});
			addBoundary(
				"unsupported-syntax",
				`Liquid markup parser could not fully interpret this source: ${diagnostic.message}`,
				diagnostic.range,
				["liquid.markup-attributes"],
			);
		}

		walk(document.syntax.rootNode);
		if (!budgetExhausted) walkMarkup(document.markupSyntax.rootNode);

		const coverage: FrontendCoverage[] = allCoverageFamilies.map((family) => {
			const boundaryIds = [...(coverageBoundaries.get(family) ?? [])];
			return {
				family,
				status: boundaryIds.length === 0 ? "complete" : "partial",
				boundaryIds,
			};
		});

		return {
			path: document.path,
			language: document.language,
			frontend: { id: FRONTEND_ID, version: FRONTEND_VERSION },
			facts,
			diagnostics,
			boundaries,
			coverage,
			work: { visited, emitted: facts.length },
		};

		function walk(node: Node): void {
			if (budgetExhausted) return;
			if (visited >= Math.max(0, limits.maxWork)) {
				exhaustBudget(rawRange(node), "Liquid frontend work budget exhausted");
				return;
			}
			visited += 1;
			processNode(node);
			if (budgetExhausted) return;
			for (const child of node.namedChildren) {
				walk(child);
				if (budgetExhausted) return;
			}
		}

		function walkMarkup(node: Node): void {
			if (budgetExhausted) return;
			if (visited >= Math.max(0, limits.maxWork)) {
				exhaustBudget(rawRange(node), "Liquid frontend work budget exhausted");
				return;
			}
			visited += 1;
			if (node.type === "attribute") emitMarkupAttribute(node);
			if (node.type === "start_tag" || node.type === "self_closing_tag") {
				reportDynamicAttributeNames(node);
			}
			for (const child of node.namedChildren) {
				walkMarkup(child);
				if (budgetExhausted) return;
			}
		}

		function processNode(node: Node): void {
			switch (node.type) {
				case "assignment_statement":
					emitAssignment(node);
					break;
				case "capture_statement":
					emitCapture(node);
					break;
				case "for_loop_statement":
					emitIteratorBinding(node, "for");
					break;
				case "tablerow_statement":
					emitIteratorBinding(node, "tablerow");
					break;
				case "paginate_statement":
					emitPaginateBinding(node);
					break;
				case "increment_statement":
				case "decrement_statement":
					emitCounterBinding(node);
					break;
				case "filter":
				case "render_filter":
					emitFilter(node);
					break;
				case "predicate":
					emitPredicate(node);
					break;
				case "if_statement":
					emitPrimaryCondition(node, "if", "true");
					break;
				case "unless_statement":
					emitPrimaryCondition(node, "unless", "false");
					break;
				case "elsif_clause":
					emitAlternativeCondition(node);
					break;
				case "case_statement":
					emitCaseCondition(node);
					break;
				case "when_clause":
					emitWhenCondition(node);
					break;
				case "else_clause":
					emitElseGuards(node);
					break;
				case "render_statement":
					emitRender(node);
					break;
				case "schema_statement":
					emitSchema(node);
					break;
				case "access":
					if (
						node.parent?.type !== "access" ||
						isIndexProperty(node.parent, node)
					)
						emitAccess(node);
					break;
				case "identifier":
					if (isReadIdentifier(node)) emitIdentifierRead(node);
					break;
			}
		}

		function emitMarkupAttribute(node: Node): void {
			const nameNode = node.namedChildren.find(
				(child) => child.type === "attribute_name",
			);
			const tagNode = node.parent?.namedChildren.find(
				(child) => child.type === "tag_name",
			);
			if (
				nameNode &&
				document.markupDynamicRanges.some((range) =>
					overlaps(range, rawRange(nameNode)),
				)
			) {
				return;
			}
			if (!nameNode || !tagNode) {
				unsupported(node, "Liquid markup attribute shape is unsupported", [
					"liquid.markup-attributes",
				]);
				return;
			}
			const valueNode = node.namedChildren.find(
				(child) =>
					child.type === "quoted_attribute_value" ||
					child.type === "attribute_value",
			);
			const valueRange = valueNode ? rawRange(valueNode) : undefined;
			const dynamicRanges = valueRange
				? document.markupDynamicRanges.filter((range) =>
						overlaps(range, valueRange),
					)
				: [];
			let valueKind: "boolean" | "literal" | "dynamic" | "mixed" = valueNode
				? "literal"
				: "boolean";
			if (valueRange && dynamicRanges.length > 0) {
				const staticText = staticMarkupText(valueRange, dynamicRanges).replace(
					/[\s"']/g,
					"",
				);
				valueKind = staticText.length > 0 ? "mixed" : "dynamic";
			}
			emit({
				kind: "liquid.markup-attribute",
				evidence: nodeAnchor(node),
				name: text(nameNode),
				nameEvidence: nodeAnchor(nameNode),
				element: text(tagNode),
				elementEvidence: nodeAnchor(tagNode),
				valueKind,
				...(valueNode ? { valueEvidence: nodeAnchor(valueNode, false) } : {}),
			});
		}

		function reportDynamicAttributeNames(node: Node): void {
			const attributes = node.namedChildren.filter(
				(child) => child.type === "attribute",
			);
			const tagName = node.namedChildren.find(
				(child) => child.type === "tag_name",
			);
			for (const range of document.markupDynamicRanges) {
				if (!overlaps(range, rawRange(node))) continue;
				if (tagName && overlaps(range, rawRange(tagName))) continue;
				const insideKnownValue = attributes.some((attribute) => {
					const value = attribute.namedChildren.find(
						(child) =>
							child.type === "quoted_attribute_value" ||
							child.type === "attribute_value",
					);
					return value ? containsRange(rawRange(value), range) : false;
				});
				if (insideKnownValue) continue;
				addBoundary(
					"unsupported-syntax",
					"Dynamic Liquid markup may emit attribute names",
					range,
					["liquid.markup-attributes"],
				);
			}
		}

		function overlaps(left: SourceRange, right: SourceRange): boolean {
			return left.start < right.end && right.start < left.end;
		}

		function containsRange(outer: SourceRange, inner: SourceRange): boolean {
			return outer.start <= inner.start && outer.end >= inner.end;
		}

		function staticMarkupText(
			range: SourceRange,
			dynamicRanges: readonly SourceRange[],
		): string {
			const characters = document.source
				.slice(range.start, range.end)
				.split("");
			for (const dynamic of dynamicRanges) {
				const start = Math.max(range.start, dynamic.start) - range.start;
				const end = Math.min(range.end, dynamic.end) - range.start;
				characters.fill(" ", start, end);
			}
			return characters.join("");
		}

		function emitAssignment(node: Node): void {
			const target = node.childForFieldName("variable_name");
			const nameNode = target?.namedChildren[0];
			const valueNode = node.childForFieldName("value");
			if (!nameNode || !valueNode) {
				unsupported(node, "Liquid assignment shape is unsupported", [
					"liquid.bindings",
				]);
				return;
			}
			const statementEvidence = anchor(tagRange(node));
			emit({
				kind: "liquid.binding",
				evidence: statementEvidence,
				binding: "assign",
				name: text(nameNode),
				nameEvidence: nodeAnchor(nameNode),
				scopeEvidence: anchor({
					start: statementEvidence.range.end,
					end: document.source.length,
				}),
				value: expression(valueNode),
			});
		}

		function emitCapture(node: Node): void {
			const nameNode = node.childForFieldName("variable");
			const body = node.childForFieldName("value");
			if (!nameNode || !body) {
				unsupported(node, "Liquid capture shape is unsupported", [
					"liquid.bindings",
				]);
				return;
			}
			emit({
				kind: "liquid.binding",
				evidence: nodeAnchor(node),
				binding: "capture",
				name: text(nameNode),
				nameEvidence: nodeAnchor(nameNode),
				scopeEvidence: anchor({
					start: trimRange(node).end,
					end: document.source.length,
				}),
				bodyEvidence: nodeAnchor(body, false),
			});
		}

		function emitIteratorBinding(
			node: Node,
			binding: "for" | "tablerow",
		): void {
			const nameNode = node.childForFieldName("item");
			const iterator = node.childForFieldName("iterator");
			const body = node.childForFieldName("body");
			if (!nameNode || !iterator || !body) {
				unsupported(node, `Liquid ${binding} shape is unsupported`, [
					"liquid.bindings",
				]);
				return;
			}
			emit({
				kind: "liquid.binding",
				evidence: nodeAnchor(node),
				binding,
				name: text(nameNode),
				nameEvidence: nodeAnchor(nameNode),
				scopeEvidence: nodeAnchor(body, false),
				value: expression(iterator),
			});
			emitGuard(iterator, body, "iterates");
		}

		function emitPaginateBinding(node: Node): void {
			const item = node.childForFieldName("item");
			const body = node.childForFieldName("body");
			const keyword = childWithText(node, "paginate");
			if (!item || !body || !keyword) {
				unsupported(node, "Liquid paginate shape is unsupported", [
					"liquid.bindings",
				]);
				return;
			}
			emit({
				kind: "liquid.binding",
				evidence: nodeAnchor(node),
				binding: "paginate",
				name: "paginate",
				nameEvidence: nodeAnchor(keyword),
				scopeEvidence: nodeAnchor(body, false),
				value: expression(item),
			});
		}

		function emitCounterBinding(node: Node): void {
			const nameNode = node.namedChildren[0];
			if (!nameNode) return;
			const evidence = anchor(tagRange(node));
			emit({
				kind: "liquid.binding",
				evidence,
				binding:
					node.type === "increment_statement" ? "increment" : "decrement",
				name: text(nameNode),
				nameEvidence: nodeAnchor(nameNode),
				scopeEvidence: anchor({
					start: evidence.range.end,
					end: document.source.length,
				}),
			});
		}

		function emitFilter(node: Node): void {
			const body = node.childForFieldName("body");
			const nameNode = node.childForFieldName("name");
			if (!body || !nameNode) {
				unsupported(node, "Liquid filter shape is unsupported", [
					"liquid.filters",
				]);
				return;
			}
			const argumentList = node.namedChildren.find(
				(child) => child.type === "argument_list",
			);
			const argumentNodes =
				argumentList?.namedChildren ?? node.namedChildren.slice(2);
			const filterName = text(nameNode);
			emit({
				kind: "liquid.filter",
				evidence: nodeAnchor(node),
				name: filterName,
				nameEvidence: nodeAnchor(nameNode),
				input: expression(body),
				arguments: argumentNodes.map(expression),
			});

			const assetSyntax = assetFilterSyntax[filterName];
			if (assetSyntax) {
				emit({
					kind: "liquid.asset-reference",
					evidence: nodeAnchor(node),
					syntax: assetSyntax,
					reference: reference(innermostFilterInput(node)),
				});
			}
			if (filterName === "t" || filterName === "translate") {
				emit({
					kind: "liquid.locale-reference",
					evidence: nodeAnchor(node),
					syntax: "translation-filter",
					key: reference(innermostFilterInput(node)),
				});
			}
		}

		function emitPredicate(node: Node): void {
			const operatorNode = node.childForFieldName("operator");
			const left = node.childForFieldName("left");
			const right = node.childForFieldName("right");
			const operator = operatorNode && predicateOperators[text(operatorNode)];
			const leftOperand = left && predicateOperand(left);
			const rightOperand = right && predicateOperand(right);
			if (!operator || !leftOperand || !rightOperand) {
				unsupported(
					node,
					"Liquid predicate operator or operand is unsupported",
					["liquid.predicates"],
				);
				return;
			}
			emit({
				kind: "liquid.predicate",
				evidence: nodeAnchor(node),
				operator,
				operands: [leftOperand, rightOperand],
			});
		}

		function emitPrimaryCondition(
			node: Node,
			construct: "if" | "unless",
			outcome: "true" | "false",
		): void {
			const condition = node.childForFieldName("condition");
			const body = node.childForFieldName("consequence");
			if (!condition || !body) return;
			emitCondition(node, construct, condition, body);
			emitGuard(condition, body, outcome);
		}

		function emitAlternativeCondition(node: Node): void {
			const condition = node.childForFieldName("condition");
			const body = node.namedChildren.find((child) => child.type === "block");
			if (!condition || !body) return;
			emitCondition(node, "elsif", condition, body);
			for (const requirement of precedingGuardRequirements(node)) {
				emitGuard(requirement.condition, body, requirement.outcome);
			}
			emitGuard(condition, body, "true");
		}

		function emitCaseCondition(node: Node): void {
			const receiver = node.childForFieldName("receiver");
			const body = node.childForFieldName("conditions");
			if (receiver && body) emitCondition(node, "case", receiver, body);
		}

		function emitWhenCondition(node: Node): void {
			const condition = node.childForFieldName("condition");
			const body = node.childForFieldName("consequence");
			if (!condition || !body) return;
			emitCondition(node, "when", condition, body);
			emitGuard(condition, body, "case-match");
		}

		function emitElseGuards(node: Node): void {
			const body = node.namedChildren.find((child) => child.type === "block");
			if (!body) return;
			const parent = node.parent;
			if (!parent) return;
			if (parent.type === "for_loop_statement") {
				const iterator = parent.childForFieldName("iterator");
				if (iterator) emitGuard(iterator, body, "empty");
				return;
			}
			for (const requirement of precedingGuardRequirements(node)) {
				emitGuard(requirement.condition, body, requirement.outcome);
			}
		}

		function emitCondition(
			node: Node,
			construct: LiquidConditionConstruct,
			condition: Node,
			body: Node,
		): void {
			const predicateEvidence =
				condition.type === "argument_list"
					? condition.namedChildren.map((child) => nodeAnchor(child))
					: [nodeAnchor(condition)];
			emit({
				kind: "liquid.condition",
				evidence: anchor(openingTagRange(node)),
				construct,
				predicateEvidence,
				bodyEvidence: nodeAnchor(body, false),
			});
		}

		function emitGuard(
			condition: Node,
			body: Node,
			outcome: "true" | "false" | "case-match" | "iterates" | "empty",
		): void {
			emit({
				kind: "liquid.guard",
				evidence: nodeAnchor(body, false),
				conditionEvidence: nodeAnchor(condition),
				guardedEvidence: nodeAnchor(body, false),
				outcome,
			});
		}

		function emitRender(node: Node): void {
			const file = node.childForFieldName("file");
			if (!file) return;
			const renderSiteEvidence = anchor(tagRange(node));
			emit({
				kind: "liquid.render-site",
				evidence: renderSiteEvidence,
				target: reference(file),
			});
			for (const argument of node.namedChildren.filter(
				(child) => child.type === "render_argument",
			)) {
				const key = argument.childForFieldName("key");
				const value = argument.childForFieldName("value");
				if (!key || !value) continue;
				emit({
					kind: "liquid.render-argument",
					evidence: nodeAnchor(argument),
					renderSiteEvidence,
					argument: {
						kind: "named",
						name: text(key),
						nameEvidence: nodeAnchor(key),
						value: expression(value),
					},
				});
			}
			const mode = childWithText(node, "with")
				? "with"
				: childWithText(node, "for")
					? "for"
					: undefined;
			if (!mode) return;
			const value = node.childForFieldName(
				mode === "with" ? "with" : "iteration",
			);
			if (!value || text(value) === mode) {
				const fieldChildren = childrenForField(
					node,
					mode === "with" ? "with" : "iteration",
				);
				const expressionNode = fieldChildren.find(
					(child) => child.isNamed && text(child) !== mode,
				);
				if (expressionNode)
					emitRenderModeArgument(
						node,
						renderSiteEvidence,
						mode,
						expressionNode,
					);
				return;
			}
			emitRenderModeArgument(node, renderSiteEvidence, mode, value);
		}

		function emitRenderModeArgument(
			node: Node,
			renderSiteEvidence: SourceAnchor,
			mode: "with" | "for",
			value: Node,
		): void {
			const aliasNode = node.childForFieldName("item");
			const modeNode = childWithText(node, mode);
			emit({
				kind: "liquid.render-argument",
				evidence: anchor({
					start: modeNode?.startIndex ?? value.startIndex,
					end: aliasNode?.endIndex ?? value.endIndex,
				}),
				renderSiteEvidence,
				argument: {
					kind: mode,
					value: expression(value),
					...(aliasNode
						? {
								alias: {
									name: text(aliasNode),
									evidence: nodeAnchor(aliasNode),
								},
							}
						: {}),
				},
			});
		}

		function emitSchema(node: Node): void {
			const opening = openingTagRange(node);
			const closingStart = document.source.lastIndexOf(
				"{%",
				trimRange(node).end,
			);
			if (closingStart < opening.end) {
				unsupported(node, "Liquid schema closing tag is unavailable", [
					"liquid.schema-regions",
				]);
				return;
			}
			emit({
				kind: "liquid.schema-region",
				evidence: nodeAnchor(node),
				contentEvidence: anchor({ start: opening.end, end: closingStart }),
			});
		}

		function emitAccess(node: Node): void {
			const path = accessPath(node);
			if (!path) {
				unsupported(node, "Liquid access path is unsupported", [
					"liquid.access-paths",
				]);
				return;
			}
			emit({
				kind: "liquid.access-path",
				evidence: nodeAnchor(node),
				access: "read",
				path,
				context: readContext(node),
			});
		}

		function emitIdentifierRead(node: Node): void {
			emit({
				kind: "liquid.access-path",
				evidence: nodeAnchor(node),
				access: "read",
				path: {
					root: { name: text(node), evidence: nodeAnchor(node) },
					segments: [],
				},
				context: readContext(node),
			});
		}

		function emit(fact: LiquidFact): void {
			if (budgetExhausted) return;
			if (facts.length >= Math.max(0, limits.maxFacts)) {
				exhaustBudget(
					fact.evidence.range,
					"Liquid frontend fact budget exhausted",
				);
				return;
			}
			facts.push(fact);
		}

		function exhaustBudget(range: SourceRange, message: string): void {
			if (budgetExhausted) return;
			budgetExhausted = true;
			addBoundary("budget", message, range, allCoverageFamilies);
		}

		function unsupported(
			node: Node,
			message: string,
			families: readonly CoverageFamily[],
		): void {
			addBoundary("unsupported-syntax", message, trimRange(node), families);
		}

		function addBoundary(
			kind: FrontendBoundary["kind"],
			message: string,
			range: SourceRange,
			families: readonly CoverageFamily[],
		): void {
			const id = `liquid-boundary-${++boundarySequence}`;
			boundaries.push({ id, kind, message, range });
			for (const family of families) coverageBoundaries.get(family)?.add(id);
		}

		function anchor(range: SourceRange): SourceAnchor {
			return { path: document.path, range };
		}

		function nodeAnchor(node: Node, trim = true): SourceAnchor {
			return anchor(trim ? trimRange(node) : rawRange(node));
		}

		function rawRange(node: Node): SourceRange {
			return { start: node.startIndex, end: node.endIndex };
		}

		function trimRange(node: Node): SourceRange {
			let start = node.startIndex;
			let end = node.endIndex;
			while (start < end && /\s/.test(document.source[start] ?? "")) start += 1;
			while (end > start && /\s/.test(document.source[end - 1] ?? "")) end -= 1;
			return { start, end };
		}

		function text(node: Node): string {
			const range = trimRange(node);
			return document.source.slice(range.start, range.end);
		}

		function expression(node: Node): LiquidExpressionSource {
			const evidence = nodeAnchor(node);
			return {
				text: document.source.slice(evidence.range.start, evidence.range.end),
				evidence,
			};
		}

		function tagRange(node: Node): SourceRange {
			if (insideLiquidTag(node)) return trimRange(node);
			const open = document.source.lastIndexOf("{%", node.startIndex);
			const close = document.source.indexOf("%}", node.endIndex);
			if (open >= 0 && close >= node.endIndex) {
				const previousClose = document.source.lastIndexOf(
					"%}",
					node.startIndex,
				);
				if (previousClose < open) return { start: open, end: close + 2 };
			}
			return trimRange(node);
		}

		function openingTagRange(node: Node): SourceRange {
			const range = trimRange(node);
			if (insideLiquidTag(node)) {
				const body = node.namedChildren.find((child) => child.type === "block");
				if (!body) return range;
				let end = body.startIndex;
				while (end > range.start && /\s/.test(document.source[end - 1] ?? ""))
					end -= 1;
				return { start: range.start, end };
			}
			const open = document.source.indexOf("{%", node.startIndex);
			const close = document.source.indexOf("%}", open + 2);
			return open >= 0 && close >= 0 ? { start: open, end: close + 2 } : range;
		}

		function insideLiquidTag(node: Node): boolean {
			let parent = node.parent;
			while (parent) {
				if (parent.type === "liquid_tag") return true;
				parent = parent.parent;
			}
			return false;
		}

		function childWithText(node: Node, value: string): Node | undefined {
			for (let index = 0; index < node.childCount; index += 1) {
				const child = node.child(index);
				if (child && text(child) === value) return child;
			}
			return undefined;
		}

		function childrenForField(node: Node, field: string): Node[] {
			const children: Node[] = [];
			for (let index = 0; index < node.childCount; index += 1) {
				const child = node.child(index);
				if (child && node.fieldNameForChild(index) === field)
					children.push(child);
			}
			return children;
		}

		function accessPath(node: Node): LiquidAccessPath | undefined {
			if (node.type === "identifier") {
				return {
					root: { name: text(node), evidence: nodeAnchor(node) },
					segments: [],
				};
			}
			if (node.type !== "access") return undefined;
			const receiver = node.childForFieldName("receiver");
			const property = node.childForFieldName("property");
			if (!receiver || !property) return undefined;
			const base = accessPath(receiver);
			if (!base) return undefined;
			const between = document.source.slice(
				receiver.endIndex,
				property.startIndex,
			);
			return {
				root: base.root,
				segments: [
					...base.segments,
					between.includes("[")
						? { kind: "index", expressionEvidence: nodeAnchor(property) }
						: {
								kind: "property",
								name: text(property),
								evidence: nodeAnchor(property),
							},
				],
			};
		}

		function predicateOperand(node: Node): LiquidPredicateOperand | undefined {
			if (node.type === "access" || node.type === "identifier") {
				const value = text(node);
				const evidence = nodeAnchor(node);
				if (node.type === "identifier" && value === "nil")
					return { kind: "nil", evidence };
				if (node.type === "identifier" && value === "empty")
					return { kind: "empty", evidence };
				if (node.type === "identifier" && value === "blank")
					return { kind: "blank", evidence };
				const path = accessPath(node);
				return path ? { kind: "access-path", path } : undefined;
			}
			if (node.type === "predicate")
				return { kind: "predicate", evidence: nodeAnchor(node) };
			if (node.type === "string") {
				const raw = text(node);
				return {
					kind: "string",
					value: raw.slice(1, -1),
					evidence: nodeAnchor(node),
				};
			}
			if (node.type === "number")
				return {
					kind: "number",
					value: Number(text(node)),
					evidence: nodeAnchor(node),
				};
			if (node.type === "boolean")
				return {
					kind: "boolean",
					value: text(node) === "true",
					evidence: nodeAnchor(node),
				};
			return undefined;
		}

		function reference(node: Node): LiquidReference {
			if (node.type === "string") {
				const raw = text(node);
				return {
					kind: "literal",
					value: raw.slice(1, -1),
					evidence: nodeAnchor(node),
				};
			}
			return { kind: "dynamic", expressionEvidence: nodeAnchor(node) };
		}

		function innermostFilterInput(node: Node): Node {
			let current = node.childForFieldName("body") ?? node;
			while (current.type === "filter" || current.type === "render_filter") {
				const body = current.childForFieldName("body");
				if (!body) break;
				current = body;
			}
			return current;
		}

		function isReadIdentifier(node: Node): boolean {
			const parent = node.parent;
			if (!parent) return false;
			if (parent.type === "assignment_target") return false;
			if (parent.type === "access" && !isIndexProperty(parent, node))
				return false;
			const field = fieldName(parent, node);
			if (
				parent.type === "predicate" &&
				["nil", "empty", "blank"].includes(text(node))
			)
				return false;
			if (
				(parent.type === "filter" || parent.type === "render_filter") &&
				field === "name"
			)
				return false;
			if (parent.type === "render_argument" && field === "key") return false;
			if (parent.type === "render_statement" && field === "item") return false;
			if (parent.type === "argument" && field === "key") return false;
			if (
				[
					"capture_statement",
					"for_loop_statement",
					"tablerow_statement",
				].includes(parent.type) &&
				["variable", "item"].includes(field ?? "")
			)
				return false;
			if (["increment_statement", "decrement_statement"].includes(parent.type))
				return false;
			return true;
		}

		function isIndexProperty(parent: Node, child: Node): boolean {
			if (fieldName(parent, child) !== "property") return false;
			const receiver = parent.childForFieldName("receiver");
			return Boolean(
				receiver &&
					document.source
						.slice(receiver.endIndex, child.startIndex)
						.includes("["),
			);
		}

		function fieldName(parent: Node, child: Node): string | undefined {
			for (let index = 0; index < parent.childCount; index += 1) {
				const candidate = parent.child(index);
				if (candidate?.id === child.id)
					return parent.fieldNameForChild(index) ?? undefined;
			}
			return undefined;
		}

		function readContext(node: Node): LiquidReadContext {
			let child = node;
			for (
				let parent = node.parent;
				parent;
				child = parent, parent = parent.parent
			) {
				const field = fieldName(parent, child);
				if (parent.type === "render_argument" && field === "value")
					return "render-argument";
				if (parent.type === "render_statement") {
					return field === "with" || field === "iteration"
						? "render-argument"
						: "tag-argument";
				}
				if (
					(parent.type === "filter" || parent.type === "render_filter") &&
					field === "body"
				)
					return "filter-input";
				if (parent.type === "assignment_statement" && field === "value")
					return "assignment";
				if (parent.type === "predicate") return "condition";
				if (
					[
						"if_statement",
						"unless_statement",
						"elsif_clause",
						"when_clause",
					].includes(parent.type) &&
					field === "condition"
				)
					return "condition";
				if (parent.type === "case_statement" && field === "receiver")
					return "condition";
				if (
					child.type === "block" ||
					[
						"consequence",
						"body",
						"alternative",
						"conditions",
						"value",
					].includes(field ?? "")
				)
					continue;
				if (parent.type.endsWith("_statement")) return "tag-argument";
			}
			return "output";
		}

		function precedingGuardRequirements(node: Node): Array<{
			condition: Node;
			outcome: "true" | "false";
		}> {
			const parent = node.parent;
			if (!parent) return [];
			const requirements: Array<{
				condition: Node;
				outcome: "true" | "false";
			}> = [];
			const primary = parent.childForFieldName("condition");
			if (primary) {
				requirements.push({
					condition: primary,
					outcome: parent.type === "unless_statement" ? "true" : "false",
				});
			}
			if (parent.type === "case_statement") {
				const conditionBlock = parent.childForFieldName("conditions");
				for (const when of conditionBlock?.namedChildren ?? []) {
					if (when.type !== "when_clause") continue;
					if (node.type === "when_clause" && when.id === node.id) break;
					const condition = when.childForFieldName("condition");
					if (condition) requirements.push({ condition, outcome: "false" });
				}
				return requirements;
			}
			for (const alternative of childrenForField(parent, "alternative")) {
				if (alternative.id === node.id) break;
				if (alternative.type !== "elsif_clause") continue;
				const condition = alternative.childForFieldName("condition");
				if (condition) requirements.push({ condition, outcome: "false" });
			}
			return requirements;
		}
	},
});
