// Readings that need the expression layer.
//
// The split from liquid-facts.ts is deliberate: those readers only need a tag's
// name and quoted target, these need what its markup evaluates.
//
// Policy stays out. Which roots are Shopify objects, which lookups imply a
// capability, which names count as inputs — those are the compiler's rules, and
// encoding them here would put theme semantics in a scanner. What this reports
// is mechanical: what was written, where, and in what syntactic position.

import type { LiquidDocument } from "./liquid.js";
import {
	type LiquidLookup,
	lookupExpression,
	scanLiquidExpression,
} from "./liquid-expression.js";
import { BLOCK_TAGS } from "./liquid-spec.js";
import type { Range } from "./source.js";

/** Tags whose markup is a condition rather than a value. */
const CONDITION_TAGS: ReadonlySet<string> = new Set([
	"if",
	"unless",
	"elsif",
	"when",
	"case",
]);

/** Standard Shopify filters that turn a string into a reference. */
const ASSET_FILTERS: ReadonlySet<string> = new Set([
	"asset_url",
	"asset_img_url",
]);
const TRANSLATE_FILTERS: ReadonlySet<string> = new Set(["t", "translate"]);

export type LiquidBlock = {
	name: string;
	/** From the opening tag's start to the closing tag's end. */
	range: Range;
	/** The body between the tags. */
	body: Range;
};

/**
 * Pairs block tags with their `end<name>`. Nesting is respected, so an inner
 * `{% if %}` does not close an outer one.
 *
 * Callers need this to answer "was this read reached only through a branch?",
 * which changes whether the read proves the file needs a value on every render.
 */
export function liquidBlocks(document: LiquidDocument): LiquidBlock[] {
	const blocks: LiquidBlock[] = [];
	const open: { name: string; start: number; bodyStart: number }[] = [];
	for (const token of document.tokens) {
		if (token.kind !== "tag" || !token.name) continue;
		if (BLOCK_TAGS.has(token.name)) {
			open.push({
				name: token.name,
				start: token.range.start,
				bodyStart: token.range.end,
			});
			continue;
		}
		if (!token.name.startsWith("end")) continue;
		const closing = token.name.slice(3);
		const entry = open.at(-1);
		if (!entry || entry.name !== closing) continue;
		blocks.push({
			name: entry.name,
			range: { start: entry.start, end: token.range.end },
			body: { start: entry.bodyStart, end: token.range.start },
		});
		open.pop();
	}
	return blocks;
}

export type LiquidConditional = {
	/** `if`, `unless`, or `case`. */
	name: string;
	/** The whole block, opening tag to closing tag. */
	range: Range;
	/** One body per branch, in source order. */
	branches: Range[];
	/** A final `else` covers the paths the other branches do not. */
	exhaustive: boolean;
};

/**
 * Conditional blocks with their branch divisions.
 *
 * A caller doing definite-assignment analysis needs to know not just where a
 * block is but how it splits: a name assigned in every branch of an exhaustive
 * conditional is defined afterwards, and one assigned in only some is not.
 *
 * Frames are pushed for every block tag, not only conditionals, because
 * `{% for %}` takes an `{% else %}` too — attaching that divider to an
 * enclosing `{% if %}` would split the wrong block.
 */
export function liquidConditionals(
	document: LiquidDocument,
): LiquidConditional[] {
	type Frame = {
		name: string;
		conditional: boolean;
		start: number;
		/** Undefined before a `case` reaches its first `when`. */
		branchStart?: number;
		branches: Range[];
		exhaustive: boolean;
	};
	const conditionals: LiquidConditional[] = [];
	const stack: Frame[] = [];
	for (const token of document.tokens) {
		if (token.kind !== "tag" || !token.name) continue;
		const name = token.name;
		if (BLOCK_TAGS.has(name)) {
			stack.push({
				name,
				conditional: name === "if" || name === "unless" || name === "case",
				start: token.range.start,
				// The text between `{% case x %}` and its first `{% when %}` is not
				// a branch, so `case` starts without one.
				branchStart: name === "case" ? undefined : token.range.end,
				branches: [],
				exhaustive: false,
			});
			continue;
		}
		const frame = stack.at(-1);
		if (!frame) continue;
		if (name === "elsif" || name === "else" || name === "when") {
			if (frame.branchStart !== undefined) {
				frame.branches.push({
					start: frame.branchStart,
					end: token.range.start,
				});
			}
			frame.branchStart = token.range.end;
			// `{% else %}` on a loop means "the collection was empty", not an
			// exhaustive alternative.
			if (name === "else" && frame.conditional) frame.exhaustive = true;
			continue;
		}
		if (name !== `end${frame.name}`) continue;
		if (frame.branchStart !== undefined) {
			frame.branches.push({ start: frame.branchStart, end: token.range.start });
		}
		if (frame.conditional) {
			conditionals.push({
				name: frame.name,
				range: { start: frame.start, end: token.range.end },
				branches: frame.branches,
				exhaustive: frame.exhaustive,
			});
		}
		stack.pop();
	}
	return conditionals;
}

export type LiquidRead = {
	root: string;
	path: string[];
	/** `a.b.c`, the form fact records key on. */
	expression: string;
	range: Range;
	/** The read sits in a condition's markup: `{% if product %}`. */
	inCondition: boolean;
	/** The tag this read came from, `undefined` for `{{ output }}`. */
	tag?: string;
	/** The read is an argument value on a render tag. */
	inRenderArgument: boolean;
	/**
	 * The root resolves to a name the file binds itself — a `for` variable, an
	 * `assign`, a `capture`. Such a read says nothing about what the file needs
	 * from outside, so callers that infer inputs or data usage skip it.
	 */
	local: boolean;
};

export type LiquidLocalBinding = {
	name: string;
	/** Where the name is visible. */
	scope: Range;
	via: "assign" | "capture" | "for" | "tablerow";
	/**
	 * What the name was bound to, as written: the right side of an `assign`, or
	 * the collection of a `for`.
	 *
	 * Resolving `assign menu = linklists[...]` so that a later `menu.links` reads
	 * as `linklists.links` is data flow, not syntax, so it stays with the caller
	 * that owns those semantics. This is the primitive it needs.
	 */
	value?: string;
};

/** Implicitly available inside every `for` body. */
const FORLOOP = "forloop";

const ASSIGN_NAME = /^\s*([a-zA-Z_][\w-]*)\s*=/;
const LOOP_NAME = /^\s*([a-zA-Z_][\w-]*)\s+in\b/;
const CAPTURE_NAME = /^\s*([a-zA-Z_][\w-]*)/;

/**
 * Names the file binds for itself.
 *
 * `assign` and `capture` are visible from their tag to the end of the file;
 * `for` and `tablerow` bind only within their own block, which is why block
 * pairing has to happen first.
 */
export function liquidLocalBindings(
	document: LiquidDocument,
	end: number,
): LiquidLocalBinding[] {
	const bindings: LiquidLocalBinding[] = [];
	const blocks = liquidBlocks(document);
	for (const token of document.tokens) {
		if (token.kind !== "tag" || !token.name) continue;
		if (token.name === "assign") {
			const name = ASSIGN_NAME.exec(token.markup)?.[1];
			if (name) {
				const equals = token.markup.indexOf("=");
				bindings.push({
					name,
					scope: { start: token.range.end, end },
					via: "assign",
					value:
						equals === -1 ? undefined : token.markup.slice(equals + 1).trim(),
				});
			}
			continue;
		}
		if (token.name === "capture") {
			const name = CAPTURE_NAME.exec(token.markup)?.[1];
			if (name) {
				bindings.push({
					name,
					scope: { start: token.range.end, end },
					via: "capture",
				});
			}
			continue;
		}
		if (token.name !== "for" && token.name !== "tablerow") continue;
		const name = LOOP_NAME.exec(token.markup)?.[1];
		if (!name) continue;
		const block = blocks.find(
			(candidate) =>
				candidate.name === token.name &&
				candidate.range.start === token.range.start,
		);
		const scope = block?.body ?? { start: token.range.end, end };
		const inMatch = /\s+in\s+([\s\S]+)$/.exec(token.markup);
		bindings.push({
			name,
			scope,
			via: token.name,
			value: inMatch?.[1]?.trim(),
		});
		bindings.push({ name: FORLOOP, scope, via: token.name });
	}
	return bindings;
}

const RENDER_TAGS: ReadonlySet<string> = new Set(["render", "include"]);

/**
 * Where a binding tag names its variable, as a file offset.
 *
 * The position matters, not just the name: `{% assign n = n | to_i %}` reads
 * `n` on the right of the `=` while binding it on the left, and skipping every
 * occurrence by name would lose the read.
 */
function bindingSiteOf(
	tag: string | undefined,
	markup: string,
	markupStart: number,
): number | undefined {
	const name =
		tag === "assign"
			? ASSIGN_NAME.exec(markup)?.[1]
			: tag === "capture"
				? CAPTURE_NAME.exec(markup)?.[1]
				: tag === "for" || tag === "tablerow"
					? LOOP_NAME.exec(markup)?.[1]
					: undefined;
	if (!name) return undefined;
	const at = markup.indexOf(name);
	return at === -1 ? undefined : markupStart + at;
}

/** Every variable lookup in the file, with the syntactic position it appeared in. */
export function liquidReads(document: LiquidDocument): LiquidRead[] {
	const reads: LiquidRead[] = [];
	const last = document.tokens.at(-1);
	const bindings = liquidLocalBindings(document, last ? last.range.end : 0);
	const isLocal = (root: string, at: number): boolean =>
		bindings.some(
			(binding) =>
				binding.name === root &&
				at >= binding.scope.start &&
				at <= binding.scope.end,
		);
	for (const token of document.tokens) {
		if (token.kind === "raw") continue;
		const expression = scanLiquidExpression(token.markup, token.markupStart);
		const tag = token.kind === "tag" ? token.name : undefined;
		const inCondition = tag !== undefined && CONDITION_TAGS.has(tag);
		const inRenderArgument = tag !== undefined && RENDER_TAGS.has(tag);
		// `{% for variant in … %}` and `{% assign x = … %}` name a binding site.
		// It is where the name comes into existence, not a read of it.
		const bound = bindingSiteOf(tag, token.markup, token.markupStart);
		for (const lookup of expression.lookups) {
			if (bound !== undefined && lookup.range.start === bound) continue;
			reads.push({
				root: lookup.root,
				path: lookup.path,
				expression: lookupExpression(lookup),
				range: lookup.range,
				inCondition,
				tag,
				inRenderArgument,
				local: isLocal(lookup.root, lookup.range.start),
			});
		}
	}
	return reads;
}

export type LiquidGuard = {
	name: string;
	/** `guard` is a condition; `default` is the `| default:` filter. */
	via: "guard" | "default";
	range: Range;
};

/**
 * Names the file shows it can do without: tested in a condition, or given a
 * fallback. A guarded read tolerates absence, which is what separates an
 * optional input from a required one.
 *
 * Only the lookup's root is reported. Guarding `product.metafields.x` says the
 * file handles that property being missing, not that it handles `product`
 * being absent — attributing it to the root would make required inputs look
 * optional.
 */
export function liquidGuards(document: LiquidDocument): LiquidGuard[] {
	const guards: LiquidGuard[] = [];
	for (const token of document.tokens) {
		if (token.kind === "raw") continue;
		const expression = scanLiquidExpression(token.markup, token.markupStart);
		if (token.kind === "tag" && token.name && CONDITION_TAGS.has(token.name)) {
			for (const lookup of expression.lookups) {
				if (lookup.path.length > 0) continue;
				guards.push({ name: lookup.root, via: "guard", range: lookup.range });
			}
		}
		for (const chain of expression.filterChains) {
			if (!chain.filters.some((filter) => filter.name === "default")) continue;
			const subject = chain.subject;
			if (!("root" in subject) || subject.path.length > 0) continue;
			guards.push({
				name: subject.root,
				via: "default",
				range: subject.range,
			});
		}
	}
	return guards;
}

export type LiquidRenderArgument = {
	/** The snippet being rendered, when statically known. */
	targetName?: string;
	argumentName: string;
	/** Raw value text, as written. */
	valueExpression: string;
	/** The lookup the value resolves to, when it is one. */
	source?: LiquidLookup;
	/** The render tag this argument belongs to. */
	siteRange: Range;
	range: Range;
	/** Bound by `with`/`for` rather than named explicitly. */
	implicit: boolean;
};

const QUOTED_HEAD = /^\s*(?:'([^']*)'|"([^"]*)")/;
/** `{% render 'card' with product %}` and `… for items as item %}`. */
const IMPLICIT =
	/\b(with|for)\s+([a-zA-Z_][\w.-]*)(?:\s+as\s+([a-zA-Z_][\w-]*))?/;

/**
 * Arguments passed at a render site. `with`/`for` bind implicitly — the value
 * takes the target's own name unless aliased with `as` — and that binding is
 * what makes the argument comparable to the target's declared inputs.
 */
export function liquidRenderArguments(
	document: LiquidDocument,
): LiquidRenderArgument[] {
	const args: LiquidRenderArgument[] = [];
	for (const token of document.tokens) {
		if (token.kind !== "tag" || !token.name || !RENDER_TAGS.has(token.name)) {
			continue;
		}
		const quoted = QUOTED_HEAD.exec(token.markup);
		const targetName = quoted?.[1] ?? quoted?.[2];
		const expression = scanLiquidExpression(token.markup, token.markupStart);

		const implicit = IMPLICIT.exec(token.markup);
		if (implicit && targetName) {
			const valueExpression = implicit[2] as string;
			const alias = implicit[3];
			const source = expression.lookups.find(
				(lookup) => lookupExpression(lookup) === valueExpression,
			);
			args.push({
				targetName,
				argumentName: alias ?? targetName,
				valueExpression,
				source,
				siteRange: token.range,
				range: source?.range ?? token.range,
				implicit: true,
			});
		}

		for (const argument of expression.namedArguments) {
			const source = expression.lookups.find(
				(lookup) =>
					lookup.range.start >= argument.valueRange.start &&
					lookup.range.end <= argument.valueRange.end,
			);
			args.push({
				targetName,
				argumentName: argument.name,
				valueExpression: argument.value,
				source,
				siteRange: token.range,
				range: argument.range,
				implicit: false,
			});
		}
	}
	return args;
}

export type LiquidStringReference = { value: string; range: Range };

/** `'file.css' | asset_url` and `| asset_img_url`. */
export function liquidAssetReferences(
	document: LiquidDocument,
): LiquidStringReference[] {
	return stringReferences(document, ASSET_FILTERS);
}

/** `'key.path' | t`. A dynamic key produces no reference, only a read. */
export function liquidLocaleReferences(
	document: LiquidDocument,
): LiquidStringReference[] {
	return stringReferences(document, TRANSLATE_FILTERS);
}

function stringReferences(
	document: LiquidDocument,
	filterNames: ReadonlySet<string>,
): LiquidStringReference[] {
	const references: LiquidStringReference[] = [];
	for (const token of document.tokens) {
		if (token.kind === "raw") continue;
		const expression = scanLiquidExpression(token.markup, token.markupStart);
		for (const chain of expression.filterChains) {
			if (!chain.filters.some((filter) => filterNames.has(filter.name)))
				continue;
			const subject = chain.subject;
			if (!("value" in subject)) continue;
			references.push({ value: subject.value, range: subject.range });
		}
	}
	return references;
}

export type LiquidDocParam = {
	name: string;
	required: boolean;
	paramType?: string;
	description?: string;
	range: Range;
};

// `@param {type} name - description`, with `[name]` marking it optional.
const DOC_PARAM =
	/^\s*@param\s*(?:\{([^}]*)\})?\s*(\[?)([a-zA-Z_][\w-]*)\]?\s*(?:-\s*(.*))?$/;

/**
 * `{% doc %}` parameter declarations — the authored contract for a snippet.
 * The body is LiquidDoc rather than Liquid, so it is read here line by line
 * rather than through the expression layer.
 */
export function liquidDocParams(document: LiquidDocument): LiquidDocParam[] {
	const params: LiquidDocParam[] = [];
	for (const token of document.tokens) {
		if (token.kind !== "raw" || token.name !== "doc") continue;
		let cursor = token.bodyStart;
		for (const line of token.body.split("\n")) {
			const lineStart = cursor;
			cursor += line.length + 1;
			const match = DOC_PARAM.exec(line);
			if (!match) continue;
			const name = match[3] as string;
			params.push({
				name,
				required: match[2] !== "[",
				paramType: match[1]?.trim() || undefined,
				description: match[4]?.trim() || undefined,
				range: {
					start: lineStart + line.indexOf("@param"),
					end: lineStart + line.length,
				},
			});
		}
	}
	return params;
}
