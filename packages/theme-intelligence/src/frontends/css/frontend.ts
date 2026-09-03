import type { ChildNode, Rule } from "postcss";
import type { CssDocument } from "../../parsers/css/parser.js";
import type { SourceAnchor, SourceRange } from "../../semantic/evidence.js";
import {
	defineFrontend,
	type FrontendBoundary,
	type FrontendDiagnostic,
} from "../frontend.js";
import { CSS_MECHANICAL_FACT_KINDS, type CssFact } from "./facts.js";
import { cssMechanicalOntology } from "./ontology.js";

const FRONTEND_ID = "postcss-class-selectors";
const FRONTEND_VERSION = 1;
const COVERAGE_FAMILY = "css.class-selectors";

export const cssFrontend = defineFrontend<CssDocument, CssFact>({
	id: FRONTEND_ID,
	version: FRONTEND_VERSION,
	languages: ["css", "scss"],
	ontology: {
		namespace: cssMechanicalOntology.namespace,
		version: cssMechanicalOntology.version,
	},
	factKinds: CSS_MECHANICAL_FACT_KINDS,
	extract({ document, limits }) {
		const facts: CssFact[] = [];
		const diagnostics: FrontendDiagnostic[] = [];
		const boundaries: FrontendBoundary[] = [];
		const boundaryKeys = new Set<string>();
		let visited = 0;
		let boundarySequence = 0;
		let exhausted = false;

		walk(document.syntax.nodes);

		return {
			path: document.path,
			language: document.language,
			frontend: { id: FRONTEND_ID, version: FRONTEND_VERSION },
			facts,
			diagnostics,
			boundaries,
			coverage: [
				{
					family: COVERAGE_FAMILY,
					status: boundaries.length === 0 ? "complete" : "partial",
					boundaryIds: boundaries.map(({ id }) => id),
				},
			],
			work: { visited, emitted: facts.length },
		};

		function walk(nodes: readonly ChildNode[] | undefined): void {
			for (const node of nodes ?? []) {
				if (exhausted) return;
				if (!consumeWork(1, nodeRange(node))) return;
				if (node.type === "rule") processRule(node);
				if ("nodes" in node) walk(node.nodes);
			}
		}

		function processRule(rule: Rule): void {
			const selectorRange = locateSelector(rule);
			if (!selectorRange) {
				addBoundary(
					"unsupported-syntax",
					"CSS selector could not be located in parser source offsets",
					nodeRange(rule),
				);
				return;
			}
			if (!consumeWork(rule.selector.length, selectorRange)) return;
			const result = scanClassSelectors(rule.selector, selectorRange.start);
			for (const dynamicRange of result.dynamicRanges) {
				addBoundary(
					"dynamic-syntax",
					"SCSS interpolation may produce class selector names",
					dynamicRange,
				);
			}
			for (const item of result.classes) {
				if (facts.length >= Math.max(0, limits.maxFacts)) {
					exhaust(item.range, "CSS frontend fact budget exhausted");
					return;
				}
				facts.push({
					kind: "css.class-selector",
					evidence: anchor(item.range),
					name: item.name,
					nameEvidence: anchor(item.nameRange),
					selectorEvidence: anchor(selectorRange),
				});
			}
		}

		function locateSelector(rule: Rule): SourceRange | undefined {
			const start = rule.source?.start;
			if (!start) return undefined;
			const parserStart = offsetFromLineColumn(
				document.source,
				start.line,
				start.column,
			);
			const exact = document.source.indexOf(rule.selector, parserStart);
			if (exact < 0) return undefined;
			return { start: exact, end: exact + rule.selector.length };
		}

		function consumeWork(amount: number, range: SourceRange): boolean {
			if (visited + amount > Math.max(0, limits.maxWork)) {
				exhaust(range, "CSS frontend work budget exhausted");
				return false;
			}
			visited += amount;
			return true;
		}

		function exhaust(range: SourceRange, message: string): void {
			exhausted = true;
			addBoundary("budget", message, range);
		}

		function addBoundary(
			kind: FrontendBoundary["kind"],
			message: string,
			range: SourceRange,
		): void {
			const key = `${kind}\0${message}\0${range.start}\0${range.end}`;
			if (boundaryKeys.has(key)) return;
			boundaryKeys.add(key);
			boundarySequence += 1;
			boundaries.push({
				id: `css-boundary-${boundarySequence}`,
				kind,
				message,
				range,
			});
		}

		function anchor(range: SourceRange): SourceAnchor {
			return { path: document.path, range };
		}
	},
});

type ScannedClass = {
	name: string;
	range: SourceRange;
	nameRange: SourceRange;
};

function scanClassSelectors(
	selector: string,
	baseOffset: number,
): { classes: ScannedClass[]; dynamicRanges: SourceRange[] } {
	const classes: ScannedClass[] = [];
	const dynamicRanges: SourceRange[] = [];
	let squareDepth = 0;
	let quote: string | undefined;
	for (let index = 0; index < selector.length; index += 1) {
		const character = selector[index];
		if (quote) {
			if (character === "\\") index += 1;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			continue;
		}
		if (character === "/" && selector[index + 1] === "*") {
			const end = selector.indexOf("*/", index + 2);
			index = end < 0 ? selector.length : end + 1;
			continue;
		}
		if (character === "[") {
			squareDepth += 1;
			continue;
		}
		if (character === "]") {
			squareDepth = Math.max(0, squareDepth - 1);
			continue;
		}
		if (character === "#" && selector[index + 1] === "{") {
			const end = interpolationEnd(selector, index);
			dynamicRanges.push({
				start: baseOffset + index,
				end: baseOffset + end,
			});
			index = end - 1;
			continue;
		}
		if (character !== "." || squareDepth > 0) continue;
		const identifier = readIdentifier(selector, index + 1);
		if (!identifier || identifier.end === index + 1) continue;
		if (selector.startsWith("#{", identifier.end)) {
			const end = interpolationEnd(selector, identifier.end);
			dynamicRanges.push({
				start: baseOffset + index,
				end: baseOffset + end,
			});
			index = end - 1;
			continue;
		}
		classes.push({
			name: identifier.name,
			range: { start: baseOffset + index, end: baseOffset + identifier.end },
			nameRange: {
				start: baseOffset + index + 1,
				end: baseOffset + identifier.end,
			},
		});
		index = identifier.end - 1;
	}
	return { classes, dynamicRanges };
}

function readIdentifier(
	selector: string,
	start: number,
): { name: string; end: number } | undefined {
	let index = start;
	let name = "";
	while (index < selector.length) {
		const character = selector[index] ?? "";
		if (/[-_A-Za-z0-9\u0080-\uFFFF]/.test(character)) {
			name += character;
			index += 1;
			continue;
		}
		if (character !== "\\") break;
		const parsedEscape = readEscape(selector, index);
		if (!parsedEscape) break;
		name += parsedEscape.value;
		index = parsedEscape.end;
	}
	return index === start ? undefined : { name, end: index };
}

function readEscape(
	selector: string,
	start: number,
): { value: string; end: number } | undefined {
	let index = start + 1;
	if (index >= selector.length) return undefined;
	let hex = "";
	while (hex.length < 6 && /[0-9A-Fa-f]/.test(selector[index] ?? "")) {
		hex += selector[index];
		index += 1;
	}
	if (hex.length > 0) {
		if (/\s/.test(selector[index] ?? "")) index += 1;
		const codePoint = Number.parseInt(hex, 16);
		return {
			value:
				codePoint > 0 && codePoint <= 0x10ffff
					? String.fromCodePoint(codePoint)
					: "�",
			end: index,
		};
	}
	return { value: selector[index] ?? "", end: index + 1 };
}

function interpolationEnd(selector: string, start: number): number {
	let depth = 0;
	for (let index = start; index < selector.length; index += 1) {
		if (selector[index] === "{") depth += 1;
		if (selector[index] === "}") {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
	}
	return selector.length;
}

function nodeRange(node: ChildNode): SourceRange {
	const start = node.source?.start;
	const end = node.source?.end;
	return {
		start: start ? Math.max(0, start.offset) : 0,
		end: end ? Math.max(0, end.offset + 1) : 0,
	};
}

function offsetFromLineColumn(
	source: string,
	oneBasedLine: number,
	oneBasedColumn: number,
): number {
	let offset = 0;
	for (let line = 1; line < oneBasedLine && offset < source.length; line += 1) {
		const newline = source.indexOf("\n", offset);
		if (newline < 0) return source.length;
		offset = newline + 1;
	}
	return Math.min(source.length, offset + Math.max(0, oneBasedColumn - 1));
}
