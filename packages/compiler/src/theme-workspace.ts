import type { Diagnostic } from "@nazare/core";
import { checkComponentScripts } from "./check-script.js";
import { type EmitResult, emitTheme } from "./emit.js";
// Generated from a digest of this package's source, so any change to fact
// derivation invalidates persisted caches without anyone remembering to.
import { THEME_FACT_CACHE_REVISION } from "./fact-cache-revision.js";
import { parseNazareLiquid } from "./parser.js";
import { markDiagnostics } from "./pipeline.js";
import {
	checkDependencies,
	createDependencyResolver,
	type DependencyResolver,
} from "./resolver.js";
import {
	filterThemeCheckIssues,
	parseThemeCheckPolicy,
} from "./theme-check-policy.js";
import {
	partitionExcludedThemeFiles,
	themeExclusionIssues,
} from "./theme-exclusions.js";
import type {
	AnalyzeNazareThemeOptions,
	BuildNazareThemeWorkspaceOptions,
	InspectNazareThemeOptions,
	InspectNazareThemeResult,
	ThemeAnalysis,
	ThemeBuildResult,
	ThemeFact,
	ThemeInputFile,
	ThemeSemanticModel,
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

export const THEME_ANALYSIS_DEFAULTS = {
	root: ".",
	strictness: "strict",
	plainLiquidParseMode: "tolerant",
} as const;

export const THEME_BUILD_DEFAULTS = {
	root: ".",
	strictness: "strict",
	plainLiquidParseMode: "strict",
	scope: { kind: "workspace" },
	emitOnError: false,
} as const;

export function analyzeNazareTheme(
	files: ThemeInputFile[],
	options: AnalyzeNazareThemeOptions = {},
): ThemeAnalysis {
	const normalized = normalizeInputFiles(files);
	const { analyzed, excluded } = partitionExcludedThemeFiles(
		normalized.files,
		options.exclude,
	);
	for (const exclusion of excluded) normalized.byPath.delete(exclusion.path);
	return analyzeNormalizedThemeFiles(analyzed, normalized.byPath, {
		...THEME_ANALYSIS_DEFAULTS,
		...options,
		initialIssues: [...normalized.issues, ...themeExclusionIssues(excluded)],
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
	const buildOptions = { ...THEME_BUILD_DEFAULTS, ...options };
	const normalized = normalizeInputFiles(files);
	const scopeIssues = buildScopeIssues(buildOptions.scope, normalized.byPath);
	const scopePaths = hasErrors(scopeIssues)
		? new Set<string>()
		: buildScopePaths(buildOptions.scope, normalized.byPath);
	const filesToAnalyze =
		buildOptions.scope.kind === "workspace"
			? normalized.files
			: normalized.files.filter((file) => scopePaths.has(file.path));
	const analysis = analyzeNormalizedThemeFiles(
		filesToAnalyze,
		normalized.byPath,
		{
			...buildOptions,
			initialIssues: [...normalized.issues, ...scopeIssues],
		},
	);
	const readFile = (path: string): string | undefined =>
		normalized.byPath.get(normalizeThemePath(path));
	// One resolver for every artifact's dependency check: the workspace's
	// components import each other, so the parse/contract caches are shared.
	const dependencyResolver = createDependencyResolver(readFile);
	let selected = buildScopeArtifacts(
		analysis.artifacts,
		buildOptions.scope,
		scopePaths,
	);
	const allIssues: Diagnostic[] = [...analysis.issues];
	const emitted: EmitResult = { files: [], issues: [] };
	const dependencyIssuesByPath = new Map<string, Diagnostic[]>();
	for (const artifact of selected) {
		const dependencyIssues = checkDependencies(artifact.ast, readFile, {
			mode: buildOptions.strictness,
			resolver: dependencyResolver,
		});
		dependencyIssuesByPath.set(artifact.path, dependencyIssues);
		pushUniqueDiagnostics(allIssues, dependencyIssues);
	}

	const scriptErrorPaths = new Set<string>();
	for (const artifact of analysis.artifacts) {
		const scriptIssues = markDiagnostics(
			checkComponentScripts(artifact.ir, { readFile }),
			"check",
		);
		if (hasErrors(scriptIssues)) scriptErrorPaths.add(artifact.path);
		pushUniqueDiagnostics(allIssues, scriptIssues);
	}
	const checkedAnalysisArtifacts = analysis.artifacts.map((artifact) =>
		scriptErrorPaths.has(artifact.path)
			? { ...artifact, canEmit: false }
			: artifact,
	);
	selected = selected.map(
		(artifact) =>
			checkedAnalysisArtifacts.find(
				(candidate) => candidate.path === artifact.path,
			) ?? artifact,
	);

	const workspaceCanEmit =
		!hasErrors(allIssues) || buildOptions.emitOnError === true;
	const scopedEntryPath =
		buildOptions.scope.kind === "workspace" ||
		buildOptions.scope.kind === "files"
			? undefined
			: normalizeThemePath(buildOptions.scope.path);
	let artifacts = selected.map((artifact) => {
		const dependencyIssues = dependencyIssuesByPath.get(artifact.path) ?? [];
		if (
			!workspaceCanEmit ||
			(!artifact.canEmit && buildOptions.emitOnError !== true) ||
			(hasErrors(dependencyIssues) && buildOptions.emitOnError !== true)
		) {
			return artifact;
		}
		const result = emitTheme(
			artifact.source,
			{ ast: artifact.ast, ir: artifact.ir, contracts: artifact.contracts },
			{
				name:
					artifact.path === scopedEntryPath && buildOptions.name
						? buildOptions.name
						: themeNameFromPath(artifact.path),
				readFile,
			},
		);
		emitted.files.push(...result.files);
		emitted.issues.push(...result.issues);
		pushUniqueDiagnostics(allIssues, result.issues);
		return {
			...artifact,
			canEmit: artifact.canEmit && !hasErrors(result.issues),
			emitted: result,
		};
	});
	if (hasErrors(allIssues) && !buildOptions.emitOnError) {
		emitted.files = [];
		artifacts = artifacts.map((artifact) => {
			if (!artifact.emitted) return artifact;
			const { emitted: _discarded, ...withoutEmission } = artifact;
			return withoutEmission;
		});
	}
	const artifactByPath = new Map(
		artifacts.map((artifact) => [artifact.path, artifact]),
	);
	const resultAnalysis: ThemeAnalysis = {
		...analysis,
		artifacts: checkedAnalysisArtifacts.map(
			(artifact) => artifactByPath.get(artifact.path) ?? artifact,
		),
	};
	return {
		analysis: resultAnalysis,
		artifacts,
		emitted,
		issues: allIssues,
		emittedOnError: emitted.files.length > 0 && hasErrors(allIssues),
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
	const cache = options.cache?.version === 1 ? options.cache : undefined;
	const componentDependencyFingerprints = fingerprintComponentSources(files);
	if (cache) {
		const currentPaths = new Set(files.map((file) => file.path));
		for (const path of Object.keys(cache.entries)) {
			if (!currentPaths.has(path)) delete cache.entries[path];
		}
	}

	for (const file of files) {
		const fileKind = classifyThemeFile(file.path);
		const cacheable = true;
		const fingerprint = themeFileFingerprint(
			file,
			fileKind,
			options,
			fileKind === "nazareComponent"
				? componentDependencyFingerprints.get(file.path)
				: undefined,
		);
		const cached = cacheable ? cache?.entries[file.path] : undefined;
		if (cached && cached.fingerprint === fingerprint) {
			facts.push(...cached.facts);
			issues.push(...cached.issues);
			if (cached.artifact) artifacts.push(cached.artifact);
			continue;
		}
		const factStart = facts.length;
		const issueStart = issues.length;
		const saveCacheEntry = (
			artifact?: ThemeBuildResult["artifacts"][number],
		): void => {
			if (!cache || !cacheable || !fingerprint) return;
			cache.entries[file.path] = {
				fingerprint,
				facts: facts.slice(factStart),
				issues: issues.slice(issueStart),
				...(artifact ? { artifact } : {}),
			};
		};
		facts.push({ kind: "file", path: file.path, fileKind });
		if (fileKind === "asset") {
			// One declaration per asset; the model additionally indexes assets by
			// path, so references by filename or by full path both resolve to it.
			facts.push({
				kind: "declaresAsset",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
			saveCacheEntry();
			continue;
		}
		if (fileKind === "layout") {
			facts.push({
				kind: "declaresLayout",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
		}
		if (fileKind === "sectionGroup") {
			facts.push({
				kind: "declaresSectionGroup",
				path: file.path,
				name: themeNameFromPath(file.path),
			});
		}
		if (fileKind === "themeBlock") {
			facts.push({
				kind: "declaresThemeBlock",
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
			if (result.artifact) {
				artifacts.push(result.artifact);
				saveCacheEntry(result.artifact);
			} else {
				saveCacheEntry();
			}
			continue;
		}
		if (file.path.endsWith(".liquid")) {
			const result = collectPlainLiquidThemeFacts(file.path, file.contents, {
				parseMode: options.plainLiquidParseMode ?? "tolerant",
			});
			facts.push(...result.facts);
			issues.push(...result.issues);
			saveCacheEntry();
			continue;
		}
		if (file.path.endsWith(".json")) {
			const result = collectJsonThemeFacts(file.path, file.contents);
			facts.push(...result.facts);
			issues.push(...result.issues);
		}
		saveCacheEntry();
	}

	const themeCheckPolicy = parseThemeCheckPolicy(options.themeCheck);
	const modelFingerprint = JSON.stringify({
		root: options.root,
		facts,
		issues,
		metafields: options.metafields,
	});
	let baseModel = options.memo?.model;
	if (!baseModel || options.memo?.fingerprint !== modelFingerprint) {
		baseModel = buildThemeSemanticModel(facts, issues, {
			root: options.root,
			metafields: options.metafields,
		});
		if (options.memo) {
			options.memo.fingerprint = modelFingerprint;
			options.memo.model = baseModel;
			delete options.memo.projectionFingerprint;
			delete options.memo.projectedModel;
		}
	}
	const projectionFingerprint = JSON.stringify(themeCheckPolicy);
	if (
		options.memo?.projectionFingerprint === projectionFingerprint &&
		options.memo.projectedModel
	) {
		return {
			ir: options.memo.projectedModel,
			artifacts,
			facts,
			issues: options.memo.projectedModel.issues,
		};
	}
	const filteredIssues = filterThemeCheckIssues(
		[...baseModel.issues, ...themeCheckPolicy.issues],
		themeCheckPolicy,
	);
	const ir: ThemeSemanticModel = {
		...baseModel,
		themeCheck: {
			path: themeCheckPolicy.path,
			ignoredChecks: themeCheckPolicy.ignoredChecks,
		},
		issues: filteredIssues,
	};
	if (options.memo) {
		options.memo.projectionFingerprint = projectionFingerprint;
		options.memo.projectedModel = ir;
	}
	return { ir, artifacts, facts, issues: filteredIssues };
}

function themeFileFingerprint(
	file: ThemeInputFile,
	fileKind: ReturnType<typeof classifyThemeFile>,
	options: AnalyzeNazareThemeOptions,
	dependencyFingerprint?: string,
): string {
	let hash = 2_166_136_261;
	const input = `${THEME_FACT_CACHE_REVISION}\0${fileKind}\0${options.plainLiquidParseMode ?? "tolerant"}\0${dependencyFingerprint ?? ""}\0${file.contents}`;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return `${input.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function fingerprintComponentSources(
	files: ThemeInputFile[],
): Map<string, string> {
	const sources = new Map(
		files
			.filter((file) => classifyThemeFile(file.path) === "nazareComponent")
			.map((file) => [file.path, file]),
	);
	const fingerprints = new Map<string, string>();
	for (const file of sources.values()) {
		const closure = new Set<string>();
		const pending = [file.path];
		while (pending.length > 0) {
			const path = pending.pop();
			if (path === undefined || closure.has(path)) continue;
			closure.add(path);
			const source = sources.get(path);
			if (!source) continue;
			const ast = parseNazareLiquid(source.contents, source.path);
			for (const node of ast.nodes) {
				if (node.type !== "NazareImport") continue;
				const target = normalizeThemePath(node.path);
				if (sources.has(target)) pending.push(target);
			}
		}
		fingerprints.set(
			file.path,
			[...closure]
				.sort()
				.map((path) => `${path}\0${sources.get(path)?.contents ?? ""}`)
				.join("\0"),
		);
	}
	return fingerprints;
}

function buildScopeIssues(
	scope: BuildNazareThemeWorkspaceOptions["scope"],
	byPath: Map<string, string>,
): Diagnostic[] {
	if (!scope || scope.kind === "workspace") return [];
	const rawPaths = scope.kind === "files" ? scope.paths : [scope.path];
	const issues: Diagnostic[] = [];
	for (const rawPath of rawPaths) {
		const path = normalizeThemePath(rawPath);
		if (isUnsafeThemePath(path)) {
			issues.push({
				severity: "error",
				code: "THEME_SCOPE_UNSAFE_PATH",
				message: `Unsafe theme build scope path ${rawPath}`,
				phase: "parse",
			});
		} else if (!byPath.has(path)) {
			issues.push({
				severity: "error",
				code: "THEME_SCOPE_FILE_NOT_FOUND",
				message: `Theme build scope file not found: ${rawPath}`,
				phase: "resolve",
			});
		} else if (!path.endsWith(".nz.liquid")) {
			issues.push({
				severity: "error",
				code: "THEME_SCOPE_UNSUPPORTED_FILE_KIND",
				message: `Theme build scope file must be a .nz.liquid component: ${rawPath}`,
				phase: "parse",
			});
		}
	}
	return issues;
}

function buildScopePaths(
	scope: NonNullable<BuildNazareThemeWorkspaceOptions["scope"]>,
	byPath: Map<string, string>,
): Set<string> {
	if (scope.kind === "workspace") return new Set(byPath.keys());
	const entries = scope.kind === "files" ? scope.paths : [scope.path];
	const paths = new Set<string>();
	for (const entry of entries) {
		for (const path of scopedNazareClosure(normalizeThemePath(entry), byPath)) {
			paths.add(path);
		}
	}
	return paths;
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
	scope: NonNullable<BuildNazareThemeWorkspaceOptions["scope"]>,
	scopePaths: Set<string>,
): ThemeBuildResult["artifacts"] {
	if (scope.kind === "workspace") return artifacts;
	if (scope.kind === "closure") {
		return artifacts.filter((artifact) => scopePaths.has(artifact.path));
	}
	const selectedPaths = new Set(
		(scope.kind === "files" ? scope.paths : [scope.path]).map(
			normalizeThemePath,
		),
	);
	return artifacts.filter((artifact) => selectedPaths.has(artifact.path));
}

function normalizeInputFiles(files: ThemeInputFile[]): {
	files: ThemeInputFile[];
	byPath: Map<string, string>;
	issues: Diagnostic[];
} {
	const byPath = new Map<string, string>();
	const issues: Diagnostic[] = [];
	for (const file of files) {
		if (
			!file ||
			typeof file.path !== "string" ||
			typeof file.contents !== "string"
		) {
			issues.push({
				severity: "error",
				code: "THEME_INVALID_INPUT_FILE",
				message: "Theme input files require string path and contents fields",
				phase: "parse",
			});
			continue;
		}
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
