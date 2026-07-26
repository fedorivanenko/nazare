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
	type LiquidRead,
	type LiquidToken,
	liquidAssetReferences,
	liquidBlocks,
	liquidDocParams,
	liquidGuards,
	liquidLocalBindings,
	liquidLocaleReferences,
	liquidReads,
	liquidRenderArguments,
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

/**
 * Follows `assign` chains so a read of an alias reports the data it stands for.
 *
 * `assign menu = linklists[settings.menu]` followed by `menu.links` is a read
 * of `linklists.links`. Without this the graph loses the edge entirely: `menu`
 * is a local, so the read looks like it touches no Shopify data at all.
 *
 * Only the root is substituted, and only when the alias resolves to something
 * rooted in a Shopify object. Chains are followed to a fixed depth because an
 * `assign` can name a previous alias, and a cycle would otherwise hang.
 */
function resolveAliases(
	tokens: LiquidToken[],
	end: number,
): Map<string, { root: string; path: string[] }> {
	const aliases = new Map<string, { root: string; path: string[] }>();
	const MAX_DEPTH = 8;
	for (const binding of liquidLocalBindings(tokens, end)) {
		// `for` bindings are deliberately not aliased. A loop variable stands for
		// one element, and the reference extractor reports it under its own name —
		// `for product in collection.products` yields reads of `product`, not of
		// `collection`.
		if (binding.via !== "assign") continue;
		if (!binding.value) continue;
		const [lookup] = scanLiquidExpression(binding.value).lookups;
		if (!lookup) continue;
		let root = lookup.root;
		let path = [...lookup.path];
		for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
			const target = aliases.get(root);
			if (!target) break;
			path = [...target.path, ...path];
			root = target.root;
		}
		if (!SHOPIFY_DATA_OBJECTS.has(root)) continue;
		aliases.set(binding.name, { root, path });
	}
	return aliases;
}

function resolvedExpression(
	read: LiquidRead,
	aliases: Map<string, { root: string; path: string[] }>,
): { object: string; propertyPath?: string } | undefined {
	const alias = aliases.get(read.root);
	const object = alias ? alias.root : read.root;
	if (!SHOPIFY_DATA_OBJECTS.has(object)) return undefined;
	const path = alias ? [...alias.path, ...read.path] : read.path;
	return { object, propertyPath: path.length > 0 ? path.join(".") : undefined };
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
	const aliases = resolveAliases(tokens, last ? last.range.end : source.length);

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
	const blockBodies = liquidBlocks(tokens)
		.filter((block) => BRANCH_BLOCKS.has(block.name))
		.map((block) => block.body);
	const insideBlock = (at: number): boolean =>
		blockBodies.some((body) => at >= body.start && at <= body.end);

	const reads = liquidReads(tokens);
	for (const read of reads) {
		const at = span(read.range);
		// Capability rules key on objects the data vocabulary does not contain --
		// `routes.cart_add_url`, `predictive_search`, `filter.active_values` --
		// so they are applied to every read, not only to Shopify data reads.
		for (const rule of lookupCapabilityRules) {
			if (rule.matches(read.root, read.path.join("."))) {
				pushCapability(rule.capability, rule.evidenceStrength, at);
			}
		}
		const resolved = resolvedExpression(read, aliases);
		if (resolved) {
			const { object, propertyPath } = resolved;
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
		// A bare name that no scope provides and the file never bound is what the
		// caller has to pass in.
		if (read.local || LIQUID_GLOBAL_NAMES.has(read.root)) continue;
		facts.push({
			kind: "readsFreeVariable",
			fromPath: path,
			name: read.root,
			propertyPath: read.path.length > 0 ? read.path.join(".") : undefined,
			expression: read.expression,
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
	const blocks = liquidBlocks(tokens);
	const guardRanges = new Map<string, { start: number; end: number }[]>();
	const defaultedNames = new Set<string>();
	for (const guard of liquidGuards(tokens)) {
		if (guard.via === "default") {
			defaultedNames.add(guard.name);
			continue;
		}
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
	const guardedNames = new Set<string>();
	const unguardedNames = new Set<string>();
	for (const read of reads) {
		if (read.local || read.path.length > 0) continue;
		const guarded =
			read.inCondition ||
			(guardRanges.get(read.root) ?? []).some(
				(range) =>
					read.range.start >= range.start && read.range.end <= range.end,
			);
		if (guarded) guardedNames.add(read.root);
		else unguardedNames.add(read.root);
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
