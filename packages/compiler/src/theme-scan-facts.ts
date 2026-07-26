// Theme facts from @nazare/scan's token stream.
//
// The counterpart to theme-source-facts.ts, which reads the same facts out of
// the Shopify parser's AST. Both exist while the differential proves they
// agree; when it does, this one stays and that one goes.
//
// The division of labour: the scanner reports what a file wrote, this applies
// what it means. Alias resolution, the Shopify object vocabulary, and the
// capability rules all live on this side, because they are theme semantics
// rather than Liquid syntax.
import type { Diagnostic, SourceSpan } from "@nazare/core";
import {
	LineIndex,
	type LiquidConditional,
	type LiquidRead,
	type LiquidToken,
	liquidAssetReferences,
	liquidBlocks,
	liquidConditionals,
	liquidDocParams,
	liquidGuards,
	liquidLocalBindings,
	liquidLocaleReferences,
	liquidReads,
	liquidRenderArguments,
	type Range as ScanRange,
	scanLiquidExpression,
} from "@nazare/scan";
import { renderSiteKey, type ThemeFact } from "./theme-facts.js";
import {
	LIQUID_GLOBAL_NAMES,
	lookupCapabilityRules,
	SHOPIFY_DATA_OBJECTS,
	textCapabilityRules,
} from "./theme-liquid-policy.js";

/** Block tags whose bodies the reference extractor treats as branches. */
const BRANCH_BLOCKS: ReadonlySet<string> = new Set([
	"if",
	"unless",
	"for",
	"case",
]);

/** A name the file binds, and where that binding is visible. */
type LocalBinding = {
	name: string;
	scope: ScanRange;
	/** What a bare `assign` aliases, when it aliases anything. */
	alias?: { root: string; path: string[] };
};

/** The innermost branch body containing an offset, if any. */
function branchScopeAt(
	offset: number,
	branchBodies: ScanRange[],
): ScanRange | undefined {
	let innermost: ScanRange | undefined;
	for (const body of branchBodies) {
		if (offset < body.start || offset > body.end) continue;
		if (!innermost || body.start > innermost.start) innermost = body;
	}
	return innermost;
}

/**
 * Names the file binds, with a branch-scoped view of where each is visible.
 *
 * Liquid itself scopes `assign` to the whole file, but inference cannot: a
 * conditional assign is how a Liquid author writes a default for an optional
 * parameter.
 *
 *     {% unless alt != blank %}{% assign alt = image.alt %}{% endunless %}
 *     <img alt="{{ alt }}">
 *
 * `alt` is a render input the caller may omit. If the assign were treated as an
 * ordinary definition visible from that point on, the later read would be a
 * read of a local, `alt` would not appear in expectedInputs at all, and the
 * parameter would vanish rather than merely being misclassified. Confining a
 * conditional definition to its own branch keeps the read free, which is what
 * makes it an input.
 *
 * The cost is a false positive when a conditional assign really is just a
 * local. That is the safer direction: a spurious optional parameter is visible
 * and dismissible, a missing one is not.
 */
function localBindingsOf(
	tokens: LiquidToken[],
	branchBodies: ScanRange[],
	fileEnd: number,
): LocalBinding[] {
	return liquidLocalBindings(tokens, fileEnd).map((binding) => {
		const scope =
			binding.via === "assign" || binding.via === "capture"
				? narrowToBranch(binding.scope, branchBodies)
				: binding.scope;
		if (binding.via !== "assign" || !binding.value)
			return { name: binding.name, scope };
		// Only a bare assignment aliases. A filtered value is a transformation,
		// and reporting reads of the result as reads of the input would claim
		// data the file never touched.
		if (binding.value.includes("|")) return { name: binding.name, scope };
		const [lookup] = scanLiquidExpression(binding.value).lookups;
		return {
			name: binding.name,
			scope,
			alias: lookup ? { root: lookup.root, path: [...lookup.path] } : undefined,
		};
	});
}

/**
 * Extends bindings past a conditional the name survives.
 *
 * A name assigned in every branch of an exhaustive conditional is defined
 * afterwards — the file cannot reach the code below without having assigned it.
 * Assigned in only some branches, or inside a loop that may not run, it may be
 * absent, and a read below is a read of something the caller might have to
 * supply.
 *
 * Conditionals are processed by closing position so that an inner block is
 * resolved before the outer one containing it: a name promoted out of a nested
 * `if` then counts toward the enclosing branch.
 */
function withDefiniteAssignments(
	bindings: LocalBinding[],
	conditionals: LiquidConditional[],
	branchBodies: ScanRange[],
	fileEnd: number,
): LocalBinding[] {
	const resolved = [...bindings];
	const covers = (binding: LocalBinding, branch: ScanRange): boolean =>
		binding.scope.start >= branch.start &&
		binding.scope.start <= branch.end &&
		binding.scope.end >= branch.end;
	for (const conditional of [...conditionals].sort(
		(a, b) => a.range.end - b.range.end,
	)) {
		if (!conditional.exhaustive || conditional.branches.length === 0) continue;
		const [first, ...rest] = conditional.branches;
		if (!first) continue;
		const everywhere = new Map<string, LocalBinding>();
		for (const binding of resolved) {
			if (covers(binding, first)) everywhere.set(binding.name, binding);
		}
		for (const branch of rest) {
			for (const name of [...everywhere.keys()]) {
				const inBranch = resolved.some(
					(binding) => binding.name === name && covers(binding, branch),
				);
				if (!inBranch) everywhere.delete(name);
			}
		}
		for (const [name, binding] of everywhere) {
			// The alias only carries forward when every branch agrees on it: two
			// branches assigning different sources leave the name defined but its
			// origin unknowable.
			const sameAlias = [first, ...rest].every((branch) =>
				resolved.some(
					(candidate) =>
						candidate.name === name &&
						covers(candidate, branch) &&
						candidate.alias?.root === binding.alias?.root,
				),
			);
			resolved.push({
				name,
				alias: sameAlias ? binding.alias : undefined,
				scope: narrowToBranch(
					{ start: conditional.range.end, end: fileEnd },
					branchBodies,
				),
			});
		}
	}
	return resolved;
}

function narrowToBranch(
	scope: ScanRange,
	branchBodies: ScanRange[],
): ScanRange {
	const branch = branchScopeAt(scope.start, branchBodies);
	return branch
		? { start: scope.start, end: Math.min(branch.end, scope.end) }
		: scope;
}

/**
 * Resolves a read through the aliases visible at its position.
 *
 * `assign image = article.image` makes every later use of `image` a read of
 * `article.image` — the file touches the article whether or not it says so at
 * the point of use. Resolution stops at a binding whose scope does not reach
 * the read: an alias to a loop variable means nothing once the loop has ended,
 * and following it would report a name that no longer exists as a render input.
 */
function resolveRead(
	root: string,
	path: string[],
	at: number,
	bindings: LocalBinding[],
): { object: string; path: string[] } {
	let object = root;
	let resolved = [...path];
	// A reassignment can name a previous alias; a cycle would otherwise hang.
	for (let depth = 0; depth < 8; depth += 1) {
		const binding = visibleBinding(object, at, bindings);
		if (!binding?.alias) break;
		resolved = [...binding.alias.path, ...resolved];
		object = binding.alias.root;
	}
	return { object, path: resolved };
}

/** The nearest binding of a name whose scope covers an offset. */
function visibleBinding(
	name: string,
	at: number,
	bindings: LocalBinding[],
): LocalBinding | undefined {
	let visible: LocalBinding | undefined;
	for (const binding of bindings) {
		if (binding.name !== name) continue;
		if (at < binding.scope.start || at > binding.scope.end) continue;
		if (!visible || binding.scope.start > visible.scope.start)
			visible = binding;
	}
	return visible;
}

/**
 * Where an argument's value came from, when that is knowable.
 *
 * Only two shapes carry a source: a settings read, and a lookup rooted in a
 * Shopify object. Anything else — a local, a literal, an expression — has no
 * source to record, and inventing one would let the graph claim a data edge
 * the file never wrote.
 */
function argumentSource(
	source: { root: string; path: string[] } | undefined,
	implicit: boolean,
): { sourceObject?: string; sourcePath?: string } {
	if (!source) return {};
	const propertyPath = source.path.join(".");
	if (
		(source.root === "section" || source.root === "block") &&
		propertyPath.startsWith("settings.")
	) {
		return {
			sourceObject: `${source.root}.settings`,
			sourcePath: propertyPath.slice("settings.".length),
		};
	}
	if (!SHOPIFY_DATA_OBJECTS.has(source.root)) return {};
	// `{% render 'card' for collection.products %}` binds one product, so the
	// argument's source is the element type rather than the collection.
	if (implicit) {
		const element = collectionElementObject(source.root, propertyPath);
		if (element) return { sourceObject: element };
	}
	return {
		sourceObject: source.root,
		sourcePath: propertyPath || undefined,
	};
}

function collectionElementObject(
	object: string,
	propertyPath: string,
): string | undefined {
	if (object === "collection" && propertyPath === "products") return "product";
	if (object === "product" && propertyPath === "variants") return "variant";
	return undefined;
}

export function collectScannedSourceFacts(
	path: string,
	source: string,
	tokens: LiquidToken[],
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const facts: ThemeFact[] = [];
	const issues: Diagnostic[] = [];
	const index = new LineIndex(source);
	const span = (range: { start: number; end: number }): SourceSpan =>
		index.spanAt(path, range);
	const last = tokens.at(-1);
	const fileEnd = last ? last.range.end : source.length;
	const blocks = liquidBlocks(tokens);
	const branchBodies = blocks
		.filter((block) => BRANCH_BLOCKS.has(block.name))
		.map((block) => block.body);
	const bindings = withDefiniteAssignments(
		localBindingsOf(tokens, branchBodies, fileEnd),
		liquidConditionals(tokens),
		branchBodies,
		fileEnd,
	);
	const isLocal = (name: string, at: number): boolean =>
		visibleBinding(name, at, bindings) !== undefined;

	// A lookup rule and a text rule can both fire on the same token, and the
	// reference extractor emits both. They carry the same signal id, so the model
	// collapses them; deduplicating here instead would be a behaviour change
	// smuggled into a replacement.
	const pushCapability = (
		capability: string,
		evidenceStrength: (typeof lookupCapabilityRules)[number]["evidenceStrength"],
		at: SourceSpan,
	): void => {
		facts.push({
			kind: "detectsCapability",
			path,
			capability,
			evidenceStrength,
			span: at,
		});
	};

	// Not every block body is a branch. Determined by probing the reference
	// extractor tag by tag: `if`, `unless`, `for` and `case` mark reads inside
	// them conditional; `form`, `paginate`, `tablerow` and `capture` do not.
	// A read outside every branch is what proves the file needs a value on
	// every render, so the distinction decides whether an input is required.
	const insideBlock = (at: number): boolean =>
		branchBodies.some((body) => at >= body.start && at <= body.end);

	const reads = liquidReads(tokens);
	for (const read of reads) {
		const at = span(read.range);
		const { object, path: resolvedPath } = resolveRead(
			read.root,
			read.path,
			read.range.start,
			bindings,
		);
		const propertyPath =
			resolvedPath.length > 0 ? resolvedPath.join(".") : undefined;
		// Capability rules key on objects the data vocabulary does not contain --
		// `routes.cart_add_url`, `predictive_search`, `filter.active_values` --
		// so they are applied to every read, and to the resolved object, since an
		// alias to `linklists` is still navigation.
		for (const rule of lookupCapabilityRules) {
			if (rule.matches(object, propertyPath ?? "")) {
				pushCapability(rule.capability, rule.evidenceStrength, at);
			}
		}
		if (SHOPIFY_DATA_OBJECTS.has(object)) {
			facts.push({
				kind: "readsShopifyData",
				fromPath: path,
				object,
				propertyPath,
				expression: propertyPath ? `${object}.${propertyPath}` : object,
				conditional: insideBlock(read.range.start),
				span: at,
			});
			continue;
		}
		// A name no scope provides and the file never bound is what the caller
		// has to pass in. A name that only resolves to itself and is bound
		// locally is the file's own, and says nothing about its inputs.
		if (LIQUID_GLOBAL_NAMES.has(object)) continue;
		// Locality is checked on the resolved name. `assign icon = feature.icon`
		// inside a loop resolves to `feature`, which the loop binds — following
		// the alias without re-checking reported a loop variable as an input.
		if (isLocal(object, read.range.start)) continue;
		facts.push({
			kind: "readsFreeVariable",
			fromPath: path,
			name: object,
			propertyPath,
			expression: propertyPath ? `${object}.${propertyPath}` : object,
			usage: read.inRenderArgument ? "renderArgument" : "expression",
			span: at,
		});
	}

	// A guard is a property of a name across the whole file, not of one
	// occurrence. A name tested in a condition is only reported as guarded if it
	// is never also read outside that condition's body -- otherwise the file
	// depends on it regardless, and calling it optional would mislead a caller.
	// A default is different: supplying a value is proof the caller may omit it,
	// so it survives an unguarded read.
	const guardRanges = new Map<string, { start: number; end: number }[]>();
	const defaultedNames = new Set<string>();
	// A `| default:` names the root of whatever it falls back for, path or not:
	// `{{ section.settings.heading | default: 'Hi' }}` states that `section` may
	// arrive without that setting. Taking only bare subjects recorded the wrong
	// name, or none.
	for (const token of tokens) {
		if (token.kind === "raw") continue;
		const expression = scanLiquidExpression(token.markup, token.markupStart);
		if (!expression.filters.some((filter) => filter.name === "default")) {
			continue;
		}
		const bound =
			token.kind === "tag" && token.name === "assign"
				? /^\s*([a-zA-Z_][\w-]*)\s*=/.exec(token.markup)?.[1]
				: undefined;
		// On an assign the subject is the value, not the name being bound.
		const subject = expression.lookups.find(
			(lookup) => !bound || lookup.root !== bound,
		);
		if (!subject) continue;
		defaultedNames.add(
			resolveRead(subject.root, subject.path, subject.range.start, bindings)
				.object,
		);
	}
	for (const guard of liquidGuards(tokens)) {
		if (guard.via === "default") continue;
		const block = blocks.find(
			(candidate) =>
				guard.range.start >= candidate.range.start &&
				guard.range.start < candidate.body.start,
		);
		if (!block) continue;
		guardRanges.set(guard.name, [
			...(guardRanges.get(guard.name) ?? []),
			block.body,
		]);
	}
	// The value an `assign` initializes from does not count as an unguarded use:
	// `{% assign n = n | plus: 1 %}` is the file maintaining its own counter, not
	// a use that proves it needs `n` from outside.
	const safeInitializations = new Set<number>();
	for (const token of tokens) {
		if (token.kind !== "tag" || token.name !== "assign") continue;
		const equals = token.markup.indexOf("=");
		if (equals === -1) continue;
		const [first] = scanLiquidExpression(
			token.markup.slice(equals + 1),
			token.markupStart + equals + 1,
		).lookups;
		if (first) safeInitializations.add(first.range.start);
	}
	const guardedNames = new Set<string>();
	const unguardedNames = new Set<string>();
	for (const read of reads) {
		if (safeInitializations.has(read.range.start)) continue;
		// A name the file binds itself is not an input, so a guard on it cannot
		// make one optional. Including them over-produced guards, and a guard is
		// what turns a required input optional -- the direction that misleads a
		// caller, so the conservative side is the right one to err on.
		if (isLocal(read.root, read.range.start)) continue;
		const guarded =
			read.inCondition ||
			(guardRanges.get(read.root) ?? []).some(
				(range) =>
					read.range.start >= range.start && read.range.end <= range.end,
			);
		// A guard on a property says the file handles that property being absent,
		// not the root; an unguarded read of either shows it depends on the root.
		if (!guarded) unguardedNames.add(read.root);
		else if (read.path.length === 0) guardedNames.add(read.root);
	}
	for (const name of new Set([...guardedNames, ...defaultedNames])) {
		if (unguardedNames.has(name) && !defaultedNames.has(name)) continue;
		facts.push({
			kind: "guardsObject",
			fromPath: path,
			name,
			via: defaultedNames.has(name) ? "default" : "guard",
		});
	}

	for (const reference of liquidAssetReferences(tokens)) {
		facts.push({
			kind: "referencesAsset",
			fromPath: path,
			targetName: reference.value,
			static: true,
			span: span(reference.range),
		});
	}

	for (const reference of liquidLocaleReferences(tokens)) {
		facts.push({
			kind: "referencesLocaleKey",
			fromPath: path,
			key: reference.value,
			static: true,
			span: span(reference.range),
		});
	}

	for (const param of liquidDocParams(tokens)) {
		facts.push({
			kind: "declaresDocParam",
			path,
			name: param.name,
			required: param.required,
			paramType: param.paramType,
			description: param.description,
			span: span(param.range),
		});
	}

	for (const argument of liquidRenderArguments(tokens)) {
		if (!argument.targetName) continue;
		facts.push({
			kind: "passesRenderArgument",
			fromPath: path,
			targetName: argument.targetName,
			siteId: renderSiteKey(path, span(argument.siteRange)),
			argumentName: argument.argumentName,
			valueExpression: argument.valueExpression,
			...argumentSource(argument.source, argument.implicit),
			span: span(argument.range),
		});
	}

	// Text patterns are evidence of behaviour that leaves no Liquid trace: a
	// form action, an input name, a fetch in an inline script. They run over the
	// source with raw bodies removed, so a token inside a comment cannot signal.
	const scannable = redactRawBodies(source, tokens);
	for (const rule of textCapabilityRules) {
		rule.pattern.lastIndex = 0;
		let match = rule.pattern.exec(scannable);
		while (match) {
			pushCapability(
				rule.capability,
				rule.evidenceStrength,
				span({ start: match.index, end: match.index + match[0].length }),
			);
			match = rule.pattern.exec(scannable);
		}
	}

	return { facts, issues };
}

/** Blanks raw bodies so text rules cannot fire on commented-out markup. */
function redactRawBodies(source: string, tokens: LiquidToken[]): string {
	let redacted = source;
	for (const token of tokens) {
		if (token.kind !== "raw") continue;
		const { bodyStart } = token;
		const bodyEnd = bodyStart + token.body.length;
		redacted =
			redacted.slice(0, bodyStart) +
			" ".repeat(bodyEnd - bodyStart) +
			redacted.slice(bodyEnd);
	}
	return redacted;
}
