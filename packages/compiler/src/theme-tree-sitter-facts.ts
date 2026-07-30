import type { SourceSpan } from "@nazare/core";
import type { HtmlMarkupFacts, LiquidSyntaxFacts } from "@nazare/source";
import { spanFromOffsets } from "./source.js";
import { renderSiteKey, type ThemeFact } from "./theme-facts.js";
import {
	LIQUID_GLOBAL_NAMES,
	lookupCapabilityRules,
	SHOPIFY_DATA_OBJECTS,
	textCapabilityRules,
} from "./theme-liquid-policy.js";

type Range = { start: number; end: number };
type Binding = {
	name: string;
	scope: Range;
	alias?: { root: string; path: string[] };
};

/** Applies theme semantics to canonical Tree-sitter Liquid facts. */
export function collectTreeSitterSourceThemeFacts(
	path: string,
	source: string,
	liquid: LiquidSyntaxFacts,
	markup?: HtmlMarkupFacts,
): {
	facts: ThemeFact[];
	issues: [];
	uncertainty: Array<{ code: string; message: string; span?: SourceSpan }>;
} {
	if (!liquid.authoritative) return { facts: [], issues: [], uncertainty: [] };
	const facts: ThemeFact[] = [];
	const uncertainty = (markup?.uncertainty ?? []).map((boundary) => ({
		code: "THEME_DYNAMIC_MARKUP_HOOK",
		message: `Dynamic ${boundary.kind} markup prevents complete DOM hook analysis`,
		span: spanFromOffsets(source, path, boundary.range),
	}));
	for (const hook of markup?.hooks ?? []) {
		facts.push(
			hook.kind === "customElement"
				? {
						kind: "behavior",
						fromPath: path,
						subjectKind: "customElement",
						operation: "uses",
						name: hook.name,
						span: spanFromOffsets(source, path, hook.range),
						extractor: "tree-sitter-html",
					}
				: {
						kind: "behavior",
						fromPath: path,
						subjectKind: "domHook",
						hookKind: hook.kind,
						operation: "emits",
						name: hook.name,
						span: spanFromOffsets(source, path, hook.range),
						extractor: "tree-sitter-html",
					},
		);
	}
	const span = (range: Range): SourceSpan =>
		spanFromOffsets(source, path, range);
	const branchBodies = [
		...liquid.blocks
			.filter((block) => block.name === "for")
			.map((block) => block.body),
		...liquid.conditionals.flatMap((conditional) => conditional.branches),
	];
	// Every read resolves through the bindings visible at its offset, so the
	// bindings are kept indexed by name: a template with thousands of reads and
	// thousands of assigns otherwise rescans the whole list per lookup.
	const bindings = new BindingIndex();
	for (const binding of liquid.localBindings) {
		bindings.add({
			name: binding.name,
			scope: narrowToBranch(binding.scope, branchBodies),
			alias:
				binding.via === "for" || binding.via === "tablerow"
					? collectionElementAlias(binding.value)
					: bareLookup(binding.value),
		});
	}
	promoteDefiniteAssignments(
		bindings,
		liquid.conditionals,
		branchBodies,
		source.length,
	);
	const visibleBinding = (name: string, at: number): Binding | undefined =>
		bindings.visibleAt(name, at);
	const resolve = (root: string, pathParts: string[], at: number) => {
		let object = root;
		let resolvedPath = [...pathParts];
		for (let depth = 0; depth < 8; depth += 1) {
			const binding = visibleBinding(object, at);
			if (!binding?.alias) break;
			resolvedPath = [...binding.alias.path, ...resolvedPath];
			object = binding.alias.root;
		}
		return { object, path: resolvedPath };
	};
	const insideBranch = (at: number): boolean =>
		branchBodies.some((body) => at >= body.start && at <= body.end);
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

	for (const read of liquid.reads) {
		const at = span(read.range);
		const resolved = resolve(read.root, read.path, read.range.start);
		const propertyPath =
			resolved.path.length > 0 ? resolved.path.join(".") : undefined;
		for (const rule of lookupCapabilityRules) {
			if (rule.matches(resolved.object, propertyPath ?? "")) {
				pushCapability(rule.capability, rule.evidenceStrength, at);
			}
		}
		if (SHOPIFY_DATA_OBJECTS.has(resolved.object)) {
			facts.push({
				kind: "readsShopifyData",
				fromPath: path,
				object: resolved.object,
				propertyPath,
				expression: propertyPath
					? `${resolved.object}.${propertyPath}`
					: resolved.object,
				conditional: insideBranch(read.range.start),
				span: at,
			});
		} else if (
			!LIQUID_GLOBAL_NAMES.has(resolved.object) &&
			!visibleBinding(resolved.object, read.range.start)
		) {
			facts.push({
				kind: "readsFreeVariable",
				fromPath: path,
				name: resolved.object,
				propertyPath,
				expression: propertyPath
					? `${resolved.object}.${propertyPath}`
					: resolved.object,
				usage: read.inRenderArgument ? "renderArgument" : "expression",
				span: at,
			});
		}
	}

	const safeInitializations = new Set<number>();
	for (const binding of liquid.localBindings) {
		const alias = bareLookup(binding.value);
		if (!alias) continue;
		const initialization = liquid.reads
			.filter(
				(read) =>
					read.tag === "assign" &&
					read.root === alias.root &&
					read.range.end <= binding.scope.start,
			)
			.at(-1);
		if (initialization) safeInitializations.add(initialization.range.start);
	}
	const defaulted = new Set(
		liquid.guards
			.filter((guard) => guard.via === "default")
			.map((guard) => resolve(guard.name, [], guard.range.start).object),
	);
	const guardProxyTargets = new Map<string, Set<string>>();
	for (const conditional of liquid.conditionals) {
		if (!conditional.exhaustive || conditional.branches.length < 2) continue;
		const primary = conditional.branches[0];
		const alternate = conditional.branches.at(-1);
		if (!primary || !alternate) continue;
		const primaryBooleans = booleanBindingsIn(primary, liquid.localBindings);
		const alternateBooleans = booleanBindingsIn(
			alternate,
			liquid.localBindings,
		);
		const conditionTargets = liquid.guards
			.filter(
				(guard) =>
					guard.via === "guard" &&
					guard.range.start >= conditional.range.start &&
					guard.range.end <= primary.start,
			)
			.map((guard) => resolve(guard.name, [], guard.range.start).object);
		for (const [name, value] of primaryBooleans) {
			if (value !== true || alternateBooleans.get(name) === true) continue;
			guardProxyTargets.set(name, new Set(conditionTargets));
		}
	}
	const guarded = new Set<string>();
	const guardRanges = new Map<string, Range[]>();
	for (const guard of liquid.guards.filter(
		(candidate) => candidate.via === "guard",
	)) {
		const resolvedGuard = resolve(guard.name, [], guard.range.start);
		const directName =
			resolvedGuard.path.length === 0 ? resolvedGuard.object : guard.name;
		const names = new Set([
			directName,
			...(guardProxyTargets.get(guard.name) ?? []),
		]);
		for (const name of names) guarded.add(name);
		const conditional = liquid.conditionals
			.filter(
				(candidate) =>
					guard.range.start >= candidate.range.start &&
					guard.range.end <= candidate.range.end,
			)
			.sort(
				(left, right) =>
					left.range.end -
					left.range.start -
					(right.range.end - right.range.start),
			)[0];
		const primary = conditional?.branches.find(
			(branch) => branch.start >= guard.range.end,
		);
		if (!primary) continue;
		for (const name of names) {
			const ranges = guardRanges.get(name);
			if (ranges) ranges.push(primary);
			else guardRanges.set(name, [primary]);
		}
		if (
			liquid.localBindings.some(
				(binding) =>
					binding.name === guard.name &&
					binding.scope.start >= primary.start &&
					binding.scope.start <= primary.end,
			)
		) {
			defaulted.add(directName);
		}
	}
	const unguarded = new Set(
		liquid.reads
			.filter((read) => {
				if (safeInitializations.has(read.range.start)) return false;
				if (read.inCondition) return false;
				const name = resolve(read.root, read.path, read.range.start).object;
				return !(guardRanges.get(name) ?? []).some(
					(range) =>
						read.range.start >= range.start && read.range.end <= range.end,
				);
			})
			.map((read) => resolve(read.root, read.path, read.range.start).object),
	);
	for (const name of new Set([...guarded, ...defaulted])) {
		if (unguarded.has(name) && !defaulted.has(name)) continue;
		facts.push({
			kind: "guardsObject",
			fromPath: path,
			name,
			via: defaulted.has(name) ? "default" : "guard",
		});
	}

	for (const reference of liquid.assetReferences) {
		facts.push({
			kind: "referencesAsset",
			fromPath: path,
			targetName: reference.value,
			static: true,
			span: span(reference.range),
		});
	}
	for (const reference of liquid.localeReferences) {
		facts.push({
			kind: "referencesLocaleKey",
			fromPath: path,
			key: reference.value,
			static: true,
			span: span(reference.range),
		});
	}
	for (const param of liquid.docParams) {
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
	for (const argument of liquid.renderArguments) {
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

	for (const rule of textCapabilityRules) {
		rule.pattern.lastIndex = 0;
		let match = rule.pattern.exec(source);
		while (match) {
			pushCapability(
				rule.capability,
				rule.evidenceStrength,
				span({ start: match.index, end: match.index + match[0].length }),
			);
			match = rule.pattern.exec(source);
		}
	}
	return { facts, issues: [], uncertainty };
}

function booleanBindingsIn(
	range: Range,
	bindings: LiquidSyntaxFacts["localBindings"],
): Map<string, boolean> {
	const values = new Map<string, boolean>();
	for (const binding of bindings) {
		if (
			binding.via !== "assign" ||
			binding.scope.start < range.start ||
			binding.scope.start > range.end
		)
			continue;
		if (binding.value?.trim() === "true") values.set(binding.name, true);
		if (binding.value?.trim() === "false") values.set(binding.name, false);
	}
	return values;
}

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
	if (implicit) {
		const element = collectionElementAlias(
			[source.root, propertyPath].filter(Boolean).join("."),
		);
		if (element) return { sourceObject: element.root };
	}
	return {
		sourceObject: source.root,
		sourcePath: propertyPath || undefined,
	};
}

function bareLookup(value: string | undefined): Binding["alias"] {
	if (!value || value.includes("|")) return undefined;
	if (
		["true", "false", "nil", "null", "blank", "empty"].includes(value.trim())
	) {
		return undefined;
	}
	const match = value.trim().match(/^([A-Za-z_$][\w$]*)(?:\.([\w$.]+))?$/);
	if (!match) return undefined;
	return { root: match[1] as string, path: match[2]?.split(".") ?? [] };
}

function collectionElementAlias(value: string | undefined): Binding["alias"] {
	const collection = bareLookup(value);
	if (!collection) return undefined;
	const propertyPath = collection.path.join(".");
	if (collection.root === "collection" && propertyPath === "products") {
		return { root: "product", path: [] };
	}
	if (collection.root === "product" && propertyPath === "variants") {
		return { root: "variant", path: [] };
	}
	return undefined;
}

function narrowToBranch(scope: Range, branches: Range[]): Range {
	let containing: Range | undefined;
	for (const branch of branches) {
		if (scope.start < branch.start || scope.start > branch.end) continue;
		if (!containing || branch.start > containing.start) containing = branch;
	}
	return containing
		? { start: scope.start, end: Math.min(scope.end, containing.end) }
		: scope;
}

/** Local bindings of one file, indexed by name for offset lookups. */
class BindingIndex {
	private readonly byName = new Map<string, Binding[]>();

	add(binding: Binding): void {
		const named = this.byName.get(binding.name);
		if (named) named.push(binding);
		else this.byName.set(binding.name, [binding]);
	}

	/** Innermost binding of `name` whose scope contains `at`. */
	visibleAt(name: string, at: number): Binding | undefined {
		let visible: Binding | undefined;
		for (const binding of this.byName.get(name) ?? []) {
			if (at < binding.scope.start || at > binding.scope.end) continue;
			if (!visible || binding.scope.start > visible.scope.start)
				visible = binding;
		}
		return visible;
	}

	named(name: string): readonly Binding[] {
		return this.byName.get(name) ?? [];
	}

	names(): readonly string[] {
		return [...this.byName.keys()];
	}
}

function promoteDefiniteAssignments(
	bindings: BindingIndex,
	conditionals: LiquidSyntaxFacts["conditionals"],
	branches: Range[],
	fileEnd: number,
): void {
	const covers = (binding: Binding, branch: Range): boolean =>
		binding.scope.start >= branch.start && binding.scope.end >= branch.end;
	for (const conditional of [...conditionals].sort(
		(left, right) => left.range.end - right.range.end,
	)) {
		if (
			conditional.name === "case" ||
			!conditional.exhaustive ||
			conditional.branches.length === 0
		)
			continue;
		const [first, ...rest] = conditional.branches;
		if (!first) continue;
		// A name assigned in every branch is bound after the conditional. One
		// promotion per name: repeating it for every covering binding of the same
		// name only appends duplicates of an identical scope.
		for (const name of bindings.names()) {
			const candidates = bindings.named(name);
			if (!candidates.some((candidate) => covers(candidate, first))) continue;
			if (
				!rest.every((branch) =>
					candidates.some((candidate) => covers(candidate, branch)),
				)
			)
				continue;
			bindings.add({
				name,
				scope: narrowToBranch(
					{ start: conditional.range.end, end: fileEnd },
					branches,
				),
			});
		}
	}
}
