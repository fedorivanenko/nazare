import type { Diagnostic } from "@nazare/core";
import { type EmitResult, emitTheme } from "./emit.js";
import { parseNazareLiquid } from "./parser.js";
import {
	checkDependencies,
	createDependencyResolver,
	type DependencyResolver,
} from "./resolver.js";

import type {
	AnalyzeNazareThemeOptions,
	BuildNazareThemeWorkspaceOptions,
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	ThemeAnalysis,
	ThemeBuildResult,
	ThemeFact,
	ThemeInputFile,
} from "./theme-facts.js";
import {
	classifyThemeFile,
	isUnsafeThemePath,
	normalizeThemePath,
	themeNameFromPath,
} from "./theme-file-classifier.js";
import { themeGraphFromModel } from "./theme-graph-output.js";
import { collectJsonThemeFacts } from "./theme-json-facts.js";
import { collectPlainLiquidThemeFacts } from "./theme-liquid-facts.js";
import { buildThemeSemanticModel } from "./theme-model.js";
import { collectNazareThemeFacts } from "./theme-nazare-facts.js";

export function analyzeNazareTheme(
	files: ThemeInputFile[],
	options: AnalyzeNazareThemeOptions = {},
): ThemeAnalysis {
	const normalized = normalizeInputFiles(files);
	return analyzeNormalizedThemeFiles(normalized.files, normalized.byPath, {
		...options,
		initialIssues: normalized.issues,
	});
}

export function inspectNazareTheme(
	files: ThemeInputFile[],
	options: InspectNazareThemeOptions = {},
): InspectNazareThemeResult {
	return themeGraphFromModel(analyzeNazareTheme(files, options).ir);
}

export function buildNazareThemeWorkspace(
	files: ThemeInputFile[],
	options: BuildNazareThemeWorkspaceOptions = {},
): ThemeBuildResult {
	const normalized = normalizeInputFiles(files);
	const scopeIssues = buildScopeIssues(options.scope, normalized.byPath);
	const scopePaths = hasErrors(scopeIssues)
		? new Set<string>()
		: buildScopePaths(options.scope, normalized.byPath);
	const filesToAnalyze =
		options.scope?.kind === "file"
			? normalized.files.filter((file) => scopePaths.has(file.path))
			: normalized.files;
	const analysis = analyzeNormalizedThemeFiles(
		filesToAnalyze,
		normalized.byPath,
		{
			...options,
			initialIssues: [...normalized.issues, ...scopeIssues],
		},
	);
	const readFile = (path: string): string | undefined =>
		normalized.byPath.get(normalizeThemePath(path));
	// One resolver for every artifact's dependency check: the workspace's
	// components import each other, so the parse/contract caches are shared.
	const dependencyResolver = createDependencyResolver(readFile);
	const selected = buildScopeArtifacts(analysis.artifacts, options.scope);
	const allIssues: Diagnostic[] = [...analysis.issues];
	const emitted: EmitResult = { files: [], issues: [] };
	const artifacts: ThemeBuildResult["artifacts"] = [];

	const scopedName =
		options.scope?.kind === "file" ? options.name : undefined;
	for (const artifact of selected) {
		const dependencyIssues = checkDependencies(artifact.ast, readFile, {
			mode: options.strictness,
			resolver: dependencyResolver,
		});
		pushUniqueDiagnostics(allIssues, dependencyIssues);
		const canEmit =
			(artifact.canEmit && !hasErrors(dependencyIssues)) ||
			options.emitOnError === true;
		if (!canEmit) {
			artifacts.push(artifact);
			continue;
		}
		const result = emitTheme(
			artifact.source,
			{ ast: artifact.ast, ir: artifact.ir, contracts: artifact.contracts },
			{
				name: scopedName ?? themeNameFromPath(artifact.path),
				readFile,
			},
		);
		emitted.files.push(...result.files);
		emitted.issues.push(...result.issues);
		pushUniqueDiagnostics(allIssues, result.issues);
		artifacts.push({ ...artifact, emitted: result });
	}
	return {
		analysis,
		artifacts,
		emitted,
		issues: allIssues,
		emittedOnError: options.emitOnError === true && hasErrors(allIssues),
	};
}

function analyzeNormalizedThemeFiles(
	files: ThemeInputFile[],
	byPath: Map<string, string>,
	options: AnalyzeNazareThemeOptions & {
		initialIssues?: Diagnostic[];
	} = {},
): ThemeAnalysis {
	const facts: ThemeFact[] = [];
	const artifacts: ThemeBuildResult["artifacts"] = [];
	const issues: Diagnostic[] = [...(options.initialIssues ?? [])];
	const readFile = (path: string): string | undefined =>
		byPath.get(normalizeThemePath(path));
	// Shared across every component in the workspace: without it each
	// component re-parses its whole import closure from scratch.
	const dependencyResolver: DependencyResolver =
		createDependencyResolver(readFile);

	for (const file of files) {
		const fileKind = classifyThemeFile(file.path);
		facts.push({ kind: "file", path: file.path, fileKind });
		if (fileKind === "asset") {
			// One declaration per asset; the model additionally indexes assets by
			// path, so references by filename or by full path both resolve to it.
			facts.push({
				kind: "declaresAsset",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
			continue;
		}
		if (fileKind === "layout") {
			facts.push({
				kind: "declaresLayout",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
		}
		if (fileKind === "locale") {
			facts.push({
				kind: "declaresLocale",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
		}
		if (fileKind === "nazareComponent") {
			const result = collectNazareThemeFacts(file.path, file.contents, {
				readFile,
				dependencyResolver,
				strictness: options.strictness,
			});
			facts.push(...result.facts);
			issues.push(...result.issues);
			if (result.artifact) artifacts.push(result.artifact);
			continue;
		}
		if (file.path.endsWith(".liquid")) {
			const result = collectPlainLiquidThemeFacts(file.path, file.contents);
			facts.push(...result.facts);
			issues.push(...result.issues);
			continue;
		}
		if (file.path.endsWith(".json")) {
			const result = collectJsonThemeFacts(file.path, file.contents);
			facts.push(...result.facts);
			issues.push(...result.issues);
		}
	}

	const ir = buildThemeSemanticModel(facts, issues, { root: options.root });
	return { ir, artifacts, issues: ir.issues };
}

function buildScopeIssues(
	scope: BuildNazareThemeWorkspaceOptions["scope"],
	byPath: Map<string, string>,
): Diagnostic[] {
	if (!scope || scope.kind === "workspace") return [];
	const path = normalizeThemePath(scope.path);
	if (isUnsafeThemePath(path)) {
		return [
			{
				severity: "error",
				code: "THEME_SCOPE_UNSAFE_PATH",
				message: `Unsafe theme build scope path ${scope.path}`,
				phase: "parse",
			},
		];
	}
	if (!byPath.has(path)) {
		return [
			{
				severity: "error",
				code: "THEME_SCOPE_FILE_NOT_FOUND",
				message: `Theme build scope file not found: ${scope.path}`,
				phase: "resolve",
			},
		];
	}
	if (!path.endsWith(".nz.liquid")) {
		return [
			{
				severity: "error",
				code: "THEME_SCOPE_UNSUPPORTED_FILE_KIND",
				message: `Theme build scope file must be a .nz.liquid component: ${scope.path}`,
				phase: "parse",
			},
		];
	}
	return [];
}

function buildScopePaths(
	scope: BuildNazareThemeWorkspaceOptions["scope"] = { kind: "workspace" },
	byPath: Map<string, string>,
): Set<string> {
	if (scope.kind === "workspace") return new Set(byPath.keys());
	return scopedNazareClosure(normalizeThemePath(scope.path), byPath);
}

function scopedNazareClosure(
	entryPath: string,
	byPath: Map<string, string>,
): Set<string> {
	const visited = new Set<string>();
	const pending = [entryPath];
	while (pending.length > 0) {
		const path = normalizeThemePath(pending.pop() ?? "");
		if (!path || visited.has(path)) continue;
		visited.add(path);
		const source = byPath.get(path);
		if (source === undefined || !path.endsWith(".nz.liquid")) continue;
		const ast = parseNazareLiquid(source, path);
		for (const node of ast.nodes) {
			if (
				node.type === "NazareImport" &&
				byPath.has(normalizeThemePath(node.path))
			) {
				pending.push(normalizeThemePath(node.path));
			}
		}
	}
	return visited;
}

function buildScopeArtifacts(
	artifacts: ThemeBuildResult["artifacts"],
	scope: BuildNazareThemeWorkspaceOptions["scope"] = { kind: "workspace" },
): ThemeBuildResult["artifacts"] {
	if (scope.kind === "workspace") return artifacts;
	const path = normalizeThemePath(scope.path);
	return artifacts.filter((artifact) => artifact.path === path);
}

function normalizeInputFiles(files: ThemeInputFile[]): {
	files: ThemeInputFile[];
	byPath: Map<string, string>;
	issues: Diagnostic[];
} {
	const byPath = new Map<string, string>();
	const issues: Diagnostic[] = [];
	for (const file of files) {
		const path = normalizeThemePath(file.path);
		if (isUnsafeThemePath(path)) {
			issues.push({
				severity: "error",
				code: "THEME_UNSAFE_PATH",
				message: `Unsafe theme path ${file.path}`,
				phase: "parse",
			});
			continue;
		}
		if (byPath.has(path)) {
			issues.push({
				severity: "error",
				code: "THEME_DUPLICATE_NORMALIZED_PATH",
				message: `Duplicate theme input path after normalization: ${file.path} -> ${path}`,
				phase: "parse",
			});
			continue;
		}
		byPath.set(path, file.contents);
	}
	return {
		files: [...byPath.entries()]
			.map(([path, contents]) => ({ path, contents }))
			.sort((a, b) => a.path.localeCompare(b.path)),
		byPath,
		issues,
	};
}

function pushUniqueDiagnostics(
	target: Diagnostic[],
	diagnostics: Diagnostic[],
): void {
	const seen = new Set(target.map(diagnosticKey));
	for (const diagnostic of diagnostics) {
		const key = diagnosticKey(diagnostic);
		if (seen.has(key)) continue;
		seen.add(key);
		target.push(diagnostic);
	}
}

function diagnosticKey(diagnostic: Diagnostic): string {
	return JSON.stringify({
		severity: diagnostic.severity,
		code: diagnostic.code,
		message: diagnostic.message,
		phase: diagnostic.phase,
		file: diagnostic.span?.file,
		line: diagnostic.span?.start.line,
		column: diagnostic.span?.start.column,
	});
}

function hasErrors(issues: Diagnostic[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}
