import type { SourceSpan } from "@nazare/core";
import type { LiquidSyntaxFacts } from "@nazare/source";
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
): { facts: ThemeFact[]; issues: [] } {
	if (!liquid.authoritative) return { facts: [], issues: [] };
	const facts: ThemeFact[] = [];
	const span = (range: Range): SourceSpan =>
		spanFromOffsets(source, path, range);
	const branchBodies = [
		...liquid.blocks
			.filter((block) => block.name === "for")
			.map((block) => block.body),
		...liquid.conditionals.flatMap((conditional) => conditional.branches),
	];
	const bindings: Binding[] = liquid.localBindings.map((binding) => ({
		name: binding.name,
		scope: narrowToBranch(binding.scope, branchBodies),
		alias:
			binding.via === "for" || binding.via === "tablerow"
				? collectionElementAlias(binding.value)
				: bareLookup(binding.value),
	}));
	promoteDefiniteAssignments(
		bindings,
		liquid.conditionals,
		branchBodies,
		source.length,
	);
	const visibleBinding = (name: string, at: number): Binding | undefined =>
		bindings
			.filter(
				(binding) =>
					binding.name === name &&
					at >= binding.scope.start &&
					at <= binding.scope.end,
			)
			.sort((left, right) => right.scope.start - left.scope.start)[0];
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

	const defaulted = new Set(
		liquid.guards
			.filter((guard) => guard.via === "default")
			.map((guard) => resolve(guard.name, [], guard.range.start).object),
	);
	const guarded = new Set(
		liquid.guards
			.filter((guard) => guard.via === "guard")
			.map((guard) => resolve(guard.name, [], guard.range.start).object),
	);
	const unguarded = new Set(
		liquid.reads
			.filter((read) => !read.inCondition && !insideBranch(read.range.start))
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
			...(argument.source
				? {
						sourceObject: argument.source.root,
						sourcePath: argument.source.path.join(".") || undefined,
					}
				: {}),
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
	return { facts, issues: [] };
}

function bareLookup(value: string | undefined): Binding["alias"] {
	if (!value || value.includes("|")) return undefined;
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
	const containing = branches
		.filter(
			(branch) => scope.start >= branch.start && scope.start <= branch.end,
		)
		.sort((left, right) => right.start - left.start)[0];
	return containing
		? { start: scope.start, end: Math.min(scope.end, containing.end) }
		: scope;
}

function promoteDefiniteAssignments(
	bindings: Binding[],
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
		for (const binding of [...bindings]) {
			if (!covers(binding, first)) continue;
			if (
				!rest.every((branch) =>
					bindings.some(
						(candidate) =>
							candidate.name === binding.name && covers(candidate, branch),
					),
				)
			)
				continue;
			bindings.push({
				name: binding.name,
				scope: narrowToBranch(
					{ start: conditional.range.end, end: fileEnd },
					branches,
				),
			});
		}
	}
}
