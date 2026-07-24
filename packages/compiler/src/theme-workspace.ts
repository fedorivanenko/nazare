import type { Diagnostic } from "@nazare/core";
import { type EmitResult, emitTheme } from "./emit.js";
import { parseNazareLiquid } from "./parser.js";
import { checkDependencies } from "./resolver.js";

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
			nazarePaths: scopePaths,
		},
	);
	const readFile = (path: string): string | undefined =>
		normalized.byPath.get(normalizeThemePath(path));
	const selected = buildScopeArtifacts(analysis.artifacts, options.scope);
	const allIssues: Diagnostic[] = [...analysis.issues];
	const emitted: EmitResult = { files: [], issues: [] };
	const artifacts: ThemeBuildResult["artifacts"] = [];

	for (const artifact of selected) {
		artifacts.push(artifact);
		const dependencyIssues = checkDependencies(artifact.ast, readFile, {
			mode: options.strictness,
		});
		pushUniqueDiagnostics(allIssues, dependencyIssues);
		const canEmit =
			(artifact.canEmit && !hasErrors(dependencyIssues)) ||
			options.emitOnError === true;
		if (!canEmit) continue;
		const result = emitTheme(
			artifact.source,
			{ ast: artifact.ast, ir: artifact.ir, contracts: artifact.contracts },
			{
				name: options.name ?? themeNameFromPath(artifact.path),
				readFile,
			},
		);
		emitted.files.push(...result.files);
		emitted.issues.push(...result.issues);
		pushUniqueDiagnostics(allIssues, result.issues);
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
		nazarePaths?: Set<string>;
	} = {},
): ThemeAnalysis {
	const facts: ThemeFact[] = [];
	const artifacts: ThemeBuildResult["artifacts"] = [];
	const issues: Diagnostic[] = [...(options.initialIssues ?? [])];
	const readFile = (path: string): string | undefined =>
		byPath.get(normalizeThemePath(path));

	for (const file of files) {
		const fileKind = classifyThemeFile(file.path);
		facts.push({ kind: "file", path: file.path, fileKind });
		if (fileKind === "asset") {
			facts.push({
				kind: "declaresAsset",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
			facts.push({ kind: "declaresAsset", path: file.path, name: file.path });
			continue;
		}
		if (fileKind === "nazareComponent" || options.nazarePaths?.has(file.path)) {
			const result = collectNazareThemeFacts(file.path, file.contents, {
				readFile,
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
		if (source === undefined || !path.endsWith(".liquid")) continue;
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
