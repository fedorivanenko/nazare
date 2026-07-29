import { createHash } from "node:crypto";
import type { Diagnostic } from "@nazare/core";
import { type EmitResult, emitTheme } from "./emit.js";
// Generated from a digest of this package's source, so any change to fact
// derivation invalidates persisted caches without anyone remembering to.
import { THEME_FACT_CACHE_REVISION } from "./fact-cache-revision.js";
import {
	checkDependencies,
	createDependencyResolver,
	type DependencyResolver,
} from "./resolver.js";
import { parseThemeCheckPolicy } from "./theme-check-policy.js";
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
	ThemeAnalysisMemo,
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
import { buildThemeSemanticModel } from "./theme-model.js";
import { analyzeThemeSource } from "./theme-source-frontends.js";
import { projectTreeSitterNazareAst } from "./tree-sitter-nazare-projector.js";

export const THEME_ANALYSIS_DEFAULTS = {
	root: ".",
	strictness: "strict",
	plainLiquidParseMode: "liquid-only",
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
	const selected = buildScopeArtifacts(
		analysis.artifacts,
		buildOptions.scope,
		scopePaths,
	);
	const allIssues: Diagnostic[] = [...analysis.issues];
	const emitted: EmitResult = { files: [], issues: [] };
	const emittedContentsByPath = new Map<string, string>();
	let hasOutputCollision = false;
	const dependencyIssuesByPath = new Map<string, Diagnostic[]>();
	for (const artifact of selected) {
		const dependencyIssues = checkDependencies(artifact.ast, readFile, {
			mode: buildOptions.strictness,
			resolver: dependencyResolver,
		});
		dependencyIssuesByPath.set(artifact.path, dependencyIssues);
		pushUniqueDiagnostics(allIssues, dependencyIssues);
	}

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
		for (const file of result.files) {
			const outputPath = normalizeThemePath(file.path);
			const existing = emittedContentsByPath.get(outputPath);
			if (existing === undefined) {
				emittedContentsByPath.set(outputPath, file.contents);
				emitted.files.push({ ...file, path: outputPath });
				continue;
			}
			if (existing !== file.contents) {
				hasOutputCollision = true;
				pushUniqueDiagnostics(allIssues, [outputCollisionIssue(outputPath)]);
			}
		}
		emitted.issues.push(...result.issues);
		pushUniqueDiagnostics(allIssues, result.issues);
		return {
			...artifact,
			canEmit: artifact.canEmit && !hasErrors(result.issues),
			emitted: result,
		};
	});
	if (
		hasOutputCollision ||
		(hasErrors(allIssues) && !buildOptions.emitOnError)
	) {
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
		artifacts: analysis.artifacts.map(
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
	const componentDependencyFingerprints = fingerprintComponentSources(
		files,
		dependencyResolver,
		options.memo,
	);
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
		const sourceAnalysis = analyzeThemeSource(
			{ path: file.path, contents: file.contents, fileKind },
			{
				readFile,
				dependencyResolver,
				strictness: options.strictness ?? "strict",
				plainLiquidParseMode: options.plainLiquidParseMode ?? "liquid-only",
			},
		);
		facts.push(...sourceAnalysis.facts);
		issues.push(...sourceAnalysis.issues);
		if (sourceAnalysis.artifact) artifacts.push(sourceAnalysis.artifact);
		saveCacheEntry(sourceAnalysis.artifact);
	}

	const themeCheckPolicy = parseThemeCheckPolicy(options.themeCheck);
	if (options.factsOnly && options.memo?.model) {
		return {
			ir: options.memo.model,
			artifacts,
			facts,
			issues,
		};
	}
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
	// The theme-check policy is reported, not derived from: it overlays one
	// field and contributes its own parse diagnostics. Keeping it out of the
	// model fingerprint means editing .theme-check.yml -- which the graph server
	// watches -- costs this overlay rather than a whole-theme rebuild.
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
	const projectedIssues = [...baseModel.issues, ...themeCheckPolicy.issues];
	const ir: ThemeSemanticModel = {
		...baseModel,
		themeCheck: {
			path: themeCheckPolicy.path,
			ignoredChecks: themeCheckPolicy.ignoredChecks,
		},
		issues: projectedIssues,
	};
	if (options.memo) {
		options.memo.projectionFingerprint = projectionFingerprint;
		options.memo.projectedModel = ir;
	}
	return { ir, artifacts, facts, issues: projectedIssues };
}

function themeFileFingerprint(
	file: ThemeInputFile,
	fileKind: ReturnType<typeof classifyThemeFile>,
	options: AnalyzeNazareThemeOptions,
	dependencyFingerprint?: string,
): string {
	const input = `${THEME_FACT_CACHE_REVISION}\0${fileKind}\0${options.strictness ?? "strict"}\0${options.plainLiquidParseMode ?? "liquid-only"}\0${dependencyFingerprint ?? ""}\0${file.contents}`;
	return createHash("sha256").update(input).digest("hex");
}

function fingerprintComponentSources(
	files: ThemeInputFile[],
	dependencyResolver: DependencyResolver,
	memo: ThemeAnalysisMemo | undefined,
): Map<string, string> {
	const sources = new Map(files.map((file) => [file.path, file]));
	const componentSources = memo?.componentSources ?? new Map();
	const currentPaths = new Set(sources.keys());
	for (const path of componentSources.keys()) {
		if (!currentPaths.has(path)) componentSources.delete(path);
	}
	for (const file of files) {
		const cached = componentSources.get(file.path);
		if (cached?.contents === file.contents) continue;
		const imports: string[] = [];
		if (classifyThemeFile(file.path) === "nazareComponent") {
			const ast = dependencyResolver.loadAst(file.path);
			if (!ast) {
				throw new Error(
					`Dependency resolver could not parse known source ${file.path}`,
				);
			}
			for (const node of ast.nodes) {
				if (node.type === "NazareImport" || node.type === "NazareAssetImport") {
					imports.push(normalizeThemePath(node.path));
				}
			}
		}
		componentSources.set(file.path, {
			contents: file.contents,
			contentHash: createHash("sha256").update(file.contents).digest("hex"),
			imports: [...new Set(imports)].sort(),
		});
	}
	if (memo) memo.componentSources = componentSources;
	const fingerprints = new Map<string, string>();
	for (const file of files) {
		if (classifyThemeFile(file.path) !== "nazareComponent") continue;
		const closure = new Set<string>();
		const pending = [file.path];
		while (pending.length > 0) {
			const path = pending.pop();
			if (path === undefined || closure.has(path)) continue;
			closure.add(path);
			const source = componentSources.get(path);
			if (!source) {
				throw new Error(`Missing component source fingerprint for ${path}`);
			}
			for (const target of source.imports) {
				if (sources.has(target)) pending.push(target);
			}
		}
		fingerprints.set(
			file.path,
			[...closure]
				.sort()
				.map((path) => {
					const source = componentSources.get(path);
					if (!source) {
						throw new Error(`Missing component source fingerprint for ${path}`);
					}
					return `${path}\0${source.contentHash}`;
				})
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
		const ast = parseWorkspaceNazareAst(source, path);
		for (const node of ast.nodes) {
			if (node.type !== "NazareImport" && node.type !== "NazareAssetImport") {
				continue;
			}
			const target = normalizeThemePath(node.path);
			if (byPath.has(target)) pending.push(target);
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

function outputCollisionIssue(path: string): Diagnostic {
	return {
		severity: "error",
		code: "THEME_OUTPUT_COLLISION",
		message: `Multiple components emit conflicting contents for ${path}`,
		phase: "emit",
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

function parseWorkspaceNazareAst(source: string, path: string) {
	return projectTreeSitterNazareAst(source, path).ast;
}

function hasErrors(issues: Diagnostic[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}
