import { parseNazareLiquid } from "./parser.js";
import type {
	BuildNazareThemeWorkspaceOptions,
	ThemeAnalysisCache,
	ThemeAnalysisMemo,
	ThemeBuildResult,
	ThemeInputFile,
	ThemeSemanticModel,
} from "./theme-facts.js";
import { normalizeThemePath } from "./theme-file-classifier.js";
import {
	type ThemeGraphUpdate,
	ThemeProgram,
	type ThemeUpdateTelemetry,
} from "./theme-session.js";
import { buildNazareThemeWorkspace } from "./theme-workspace.js";

export type ThemeBuildUpdate = {
	revision: number;
	build: ThemeBuildResult;
	changedPaths: string[];
	recomputedPaths: string[];
	addedOutputPaths: string[];
	removedOutputPaths: string[];
	changedOutputPaths: string[];
	telemetry: ThemeUpdateTelemetry;
	graphUpdate: ThemeGraphUpdate;
};

class ThemeBuildState {
	private readonly filesByPath = new Map<string, ThemeInputFile>();
	private readonly options: BuildNazareThemeWorkspaceOptions;
	private readonly cache: ThemeAnalysisCache = { version: 1, entries: {} };
	private readonly memo = {} as ThemeAnalysisMemo;
	private readonly semanticSession: ThemeProgram;
	private build: ThemeBuildResult;
	private readonly compiledArtifactsByPath = new Map<
		string,
		ThemeBuildResult["artifacts"][number]
	>();
	private outputPathsBySourcePath = new Map<string, Set<string>>();
	private sourcePathsByOutputPath = new Map<string, Set<string>>();
	private revision = 0;

	constructor(
		files: ThemeInputFile[],
		options: BuildNazareThemeWorkspaceOptions = {},
		semanticProgram?: ThemeProgram,
	) {
		this.options = {
			...options,
			cache: options.cache ?? this.cache,
			memo: options.memo ?? this.memo,
		};
		for (const file of files) this.filesByPath.set(file.path, file);
		this.semanticSession =
			semanticProgram ?? new ThemeProgram(this.files(), this.options);
		this.build = buildNazareThemeWorkspace(this.files(), this.options);
		for (const artifact of this.build.artifacts) {
			if (artifact.emitted)
				this.compiledArtifactsByPath.set(artifact.path, artifact);
		}
		this.replaceOutputOwnership(this.build);
	}

	getBuild(): ThemeBuildResult {
		return this.build;
	}

	getOwnedOutputPaths(sourcePath: string): string[] {
		return [
			...(this.outputPathsBySourcePath.get(normalizeThemePath(sourcePath)) ??
				[]),
		].sort((a, b) => a.localeCompare(b));
	}

	getOutputOwners(outputPath: string): string[] {
		return [
			...(this.sourcePathsByOutputPath.get(normalizeThemePath(outputPath)) ??
				[]),
		].sort((a, b) => a.localeCompare(b));
	}

	updateFile(file: ThemeInputFile): ThemeBuildUpdate {
		const previous = this.filesByPath.get(file.path);
		if (previous?.contents === file.contents) {
			return this.emptyUpdate([], this.semanticSession.updateFile(file));
		}
		this.filesByPath.set(file.path, file);
		try {
			return this.rebuild([file.path]);
		} catch (error) {
			if (previous) this.filesByPath.set(file.path, previous);
			else this.filesByPath.delete(file.path);
			throw error;
		}
	}

	removeFile(path: string): ThemeBuildUpdate {
		const previous = this.filesByPath.get(path);
		if (!previous || !this.filesByPath.delete(path))
			return this.emptyUpdate([], this.semanticSession.removeFile(path));
		try {
			return this.rebuild([path]);
		} catch (error) {
			this.filesByPath.set(path, previous);
			throw error;
		}
	}

	private rebuild(changedPaths: string[]): ThemeBuildUpdate {
		const startedAt = buildTelemetryNow();
		const memoryAtStart = buildTelemetryMemory();
		const previous = this.build;
		const recomputedPaths = buildRecomputationClosure(
			this.files(),
			changedPaths,
		);
		const selectedPaths = recomputedPaths.filter(
			(path) => path.endsWith(".nz.liquid") && this.filesByPath.has(path),
		);
		const rebuilt = buildNazareThemeWorkspace(this.files(), {
			...this.options,
			scope: { kind: "files", paths: selectedPaths },
		});
		validateRetainedOutputCollisions(
			previous,
			rebuilt,
			new Set(recomputedPaths),
			this.sourcePathsByOutputPath,
		);
		let graphUpdate: ThemeGraphUpdate | undefined;
		for (const path of changedPaths) {
			const file = this.filesByPath.get(path);
			graphUpdate = file
				? this.semanticSession.updateFile(file)
				: this.semanticSession.removeFile(path);
		}
		for (const path of recomputedPaths) {
			if (!this.filesByPath.has(path))
				this.compiledArtifactsByPath.delete(path);
		}
		for (const artifact of rebuilt.artifacts) {
			if (artifact.emitted)
				this.compiledArtifactsByPath.set(artifact.path, artifact);
		}
		this.build = shareUnchangedOutputSnapshots(
			previous,
			mergeSelectiveBuild(
				previous,
				this.compiledArtifactsByPath,
				rebuilt,
				new Set(recomputedPaths),
				new Set(this.filesByPath.keys()),
				this.semanticSession,
				this.options.emitOnError === true,
			),
		);
		this.replaceOutputOwnership(this.build);
		this.revision += 1;
		if (!graphUpdate)
			throw new Error("Build update did not produce graph state");
		return diffBuilds(
			this.revision,
			previous,
			this.build,
			changedPaths,
			recomputedPaths,
			{
				filesParsed: graphUpdate?.telemetry.filesParsed ?? selectedPaths.length,
				passKeysProcessed: graphUpdate?.telemetry.passKeysProcessed ?? 0,
				semanticRecordsReplaced:
					graphUpdate?.telemetry.semanticRecordsReplaced ?? 0,
				graphRecordsReplaced: graphUpdate?.telemetry.graphRecordsReplaced ?? 0,
				outputsEmitted: rebuilt.emitted.files.length,
				elapsedMs: buildTelemetryNow() - startedAt,
				peakMemoryBytes: Math.max(memoryAtStart, buildTelemetryMemory()),
			},
			graphUpdate,
		);
	}

	private replaceOutputOwnership(build: ThemeBuildResult): void {
		const ownership = buildOutputOwnership(build);
		this.outputPathsBySourcePath = ownership.outputPathsBySourcePath;
		this.sourcePathsByOutputPath = ownership.sourcePathsByOutputPath;
	}

	private emptyUpdate(
		changedPaths: string[],
		graphUpdate: ThemeGraphUpdate,
	): ThemeBuildUpdate {
		return diffBuilds(
			this.revision,
			this.build,
			this.build,
			changedPaths,
			[],
			emptyBuildTelemetry(),
			graphUpdate,
		);
	}

	private files(): ThemeInputFile[] {
		return [...this.filesByPath.values()].sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}
}

/** @deprecated Use ThemeProgram for semantic workspace state. */
export class ThemeBuildSession extends ThemeBuildState {}

type ThemeEmittedFile = ThemeBuildResult["emitted"]["files"][number];

type ThemeOutputOwnership = {
	outputPathsBySourcePath: Map<string, Set<string>>;
	sourcePathsByOutputPath: Map<string, Set<string>>;
};

function buildOutputOwnership(build: ThemeBuildResult): ThemeOutputOwnership {
	const outputPathsBySourcePath = new Map<string, Set<string>>();
	const sourcePathsByOutputPath = new Map<string, Set<string>>();
	for (const artifact of build.artifacts) {
		for (const file of artifact.emitted?.files ?? []) {
			const outputPath = normalizeThemePath(file.path);
			const sourcePath = normalizeThemePath(artifact.path);
			const outputs =
				outputPathsBySourcePath.get(sourcePath) ?? new Set<string>();
			outputs.add(outputPath);
			outputPathsBySourcePath.set(sourcePath, outputs);
			const owners =
				sourcePathsByOutputPath.get(outputPath) ?? new Set<string>();
			owners.add(sourcePath);
			sourcePathsByOutputPath.set(outputPath, owners);
		}
	}
	return { outputPathsBySourcePath, sourcePathsByOutputPath };
}

function validateRetainedOutputCollisions(
	previous: ThemeBuildResult,
	selective: ThemeBuildResult,
	affectedPaths: Set<string>,
	ownersByOutputPath: Map<string, Set<string>>,
): void {
	const retained = new Map(
		previous.emitted.files
			.filter((file) =>
				[...(ownersByOutputPath.get(normalizeThemePath(file.path)) ?? [])].some(
					(owner) => !affectedPaths.has(owner),
				),
			)
			.map((file) => [normalizeThemePath(file.path), file.contents]),
	);
	for (const file of selective.emitted.files) {
		const retainedContents = retained.get(normalizeThemePath(file.path));
		if (retainedContents !== undefined && retainedContents !== file.contents) {
			throw new Error(
				`Selective build output collision at ${normalizeThemePath(file.path)}`,
			);
		}
	}
}

function mergeSelectiveBuild(
	previous: ThemeBuildResult,
	compiledArtifactsByPath: Map<string, ThemeBuildResult["artifacts"][number]>,
	selective: ThemeBuildResult,
	affectedPaths: Set<string>,
	currentPaths: Set<string>,
	semanticSession: ThemeProgram,
	emitOnError: boolean,
): ThemeBuildResult {
	const artifactsByPath = new Map(
		[...compiledArtifactsByPath.values()]
			.filter((artifact) => currentPaths.has(artifact.path))
			.map((artifact) => [artifact.path, artifact]),
	);
	for (const artifact of selective.artifacts) {
		artifactsByPath.set(artifact.path, artifact);
	}
	let artifacts = [...artifactsByPath.values()].sort((a, b) =>
		a.path.localeCompare(b.path),
	);
	const previousSemanticIssueKeys = new Set(
		previous.analysis.ir.issues.map((issue) => JSON.stringify(issue)),
	);
	const selectiveSemanticIssueKeys = new Set(
		selective.analysis.ir.issues.map((issue) => JSON.stringify(issue)),
	);
	const retainedIssues = previous.issues.filter((issue) => {
		if (previousSemanticIssueKeys.has(JSON.stringify(issue))) return false;
		const path = issue.span?.file;
		return path === undefined || !affectedPaths.has(normalizeThemePath(path));
	});
	const selectiveBuildIssues = selective.issues.filter(
		(issue) => !selectiveSemanticIssueKeys.has(JSON.stringify(issue)),
	);
	const issueKeys = new Set<string>();
	const issues = [
		...semanticSession.getModel().issues,
		...retainedIssues,
		...selectiveBuildIssues,
	].filter((issue) => {
		const key = JSON.stringify(issue);
		if (issueKeys.has(key)) return false;
		issueKeys.add(key);
		return true;
	});
	const hasErrors = issues.some((issue) => issue.severity === "error");
	if (hasErrors && !emitOnError) {
		artifacts = artifacts.map((artifact) => {
			if (!artifact.emitted) return artifact;
			const { emitted: _emitted, ...withoutEmission } = artifact;
			return withoutEmission;
		});
	}
	const emittedFiles = artifacts.flatMap(
		(artifact) => artifact.emitted?.files ?? [],
	);
	const emittedIssues = artifacts.flatMap(
		(artifact) => artifact.emitted?.issues ?? [],
	);
	return {
		analysis: {
			ir: canonicalSemanticModel(semanticSession.getModel()),
			artifacts,
			facts: semanticSession.getFacts(),
			issues,
		},
		artifacts,
		emitted: { files: emittedFiles, issues: emittedIssues },
		issues,
		emittedOnError: emittedFiles.length > 0 && hasErrors,
	};
}

function canonicalSemanticModel(model: ThemeSemanticModel): ThemeSemanticModel {
	const byId = <T extends { id: string }>(records: T[]): T[] =>
		[...records].sort((a, b) => a.id.localeCompare(b.id));
	return {
		...model,
		files: [...model.files].sort((a, b) => a.path.localeCompare(b.path)),
		declarations: byId(model.declarations),
		references: byId(model.references),
		schemas: byId(model.schemas),
		settings: byId(model.settings),
		blocks: byId(model.blocks),
		blockSettings: byId(model.blockSettings),
		sectionInstances: byId(model.sectionInstances),
		blockInstances: byId(model.blockInstances),
		pages: byId(model.pages),
		localeKeys: byId(model.localeKeys),
		localeTranslations: byId(model.localeTranslations),
		localeReferences: byId(model.localeReferences),
		settingReads: byId(model.settingReads),
		dataAccesses: byId(model.dataAccesses),
		metafieldDefinitions: byId(model.metafieldDefinitions),
		metafieldReads: byId(model.metafieldReads),
		variableReads: byId(model.variableReads),
		renderArguments: byId(model.renderArguments),
		expectedInputs: byId(model.expectedInputs),
		renderSites: byId(model.renderSites),
		capabilitySignals: byId(model.capabilitySignals),
		capabilities: byId(model.capabilities),
		classifications: byId(model.classifications),
		evidence: byId(model.evidence),
	};
}

function shareUnchangedOutputSnapshots(
	previous: ThemeBuildResult,
	current: ThemeBuildResult,
): ThemeBuildResult {
	const outputKey = (file: ThemeEmittedFile): string =>
		JSON.stringify([file.path, file.contents]);
	const previousFilesByKey = new Map(
		previous.emitted.files.map((file) => [outputKey(file), file]),
	);
	const sharedFilesByKey = new Map<string, ThemeEmittedFile>();
	const shareFile = (file: ThemeEmittedFile): ThemeEmittedFile => {
		const key = outputKey(file);
		const alreadyShared = sharedFilesByKey.get(key);
		if (alreadyShared) return alreadyShared;
		const shared = previousFilesByKey.get(key) ?? file;
		sharedFilesByKey.set(key, shared);
		return shared;
	};
	const artifacts = current.artifacts.map((artifact) => {
		if (!artifact.emitted) return artifact;
		const files = artifact.emitted.files.map(shareFile);
		if (files.every((file, index) => file === artifact.emitted?.files[index])) {
			return artifact;
		}
		return { ...artifact, emitted: { ...artifact.emitted, files } };
	});
	const artifactsByPath = new Map(
		artifacts.map((artifact) => [artifact.path, artifact]),
	);
	return {
		...current,
		analysis: {
			...current.analysis,
			artifacts: current.analysis.artifacts.map(
				(artifact) => artifactsByPath.get(artifact.path) ?? artifact,
			),
		},
		artifacts,
		emitted: {
			...current.emitted,
			files: current.emitted.files.map(shareFile),
		},
	};
}

function buildRecomputationClosure(
	files: ThemeInputFile[],
	changedPaths: string[],
): string[] {
	const components = new Map(
		files
			.filter((file) => file.path.endsWith(".nz.liquid"))
			.map((file) => [file.path, file]),
	);
	const dependents = new Map<string, Set<string>>();
	for (const file of components.values()) {
		const ast = parseNazareLiquid(file.contents, file.path);
		for (const node of ast.nodes) {
			if (node.type !== "NazareImport") continue;
			const target = normalizeThemePath(node.path);
			if (!components.has(target)) continue;
			const paths = dependents.get(target) ?? new Set<string>();
			paths.add(file.path);
			dependents.set(target, paths);
		}
	}
	const visited = new Set<string>();
	const pending = [...changedPaths];
	while (pending.length > 0) {
		const path = pending.pop();
		if (path === undefined || visited.has(path)) continue;
		visited.add(path);
		for (const dependent of dependents.get(path) ?? []) pending.push(dependent);
	}
	return [...visited].sort((a, b) => a.localeCompare(b));
}

function diffBuilds(
	revision: number,
	previous: ThemeBuildResult,
	current: ThemeBuildResult,
	changedPaths: string[],
	recomputedPaths: string[],
	telemetry: ThemeUpdateTelemetry,
	graphUpdate: ThemeGraphUpdate,
): ThemeBuildUpdate {
	const previousFiles = new Map(
		previous.emitted.files.map((file) => [file.path, file.contents]),
	);
	const currentFiles = new Map(
		current.emitted.files.map((file) => [file.path, file.contents]),
	);
	return {
		revision,
		build: current,
		changedPaths: [...new Set(changedPaths)].sort(),
		recomputedPaths: [...new Set(recomputedPaths)].sort(),
		addedOutputPaths: [...currentFiles.keys()]
			.filter((path) => !previousFiles.has(path))
			.sort(),
		removedOutputPaths: [...previousFiles.keys()]
			.filter((path) => !currentFiles.has(path))
			.sort(),
		changedOutputPaths: [...currentFiles.keys()]
			.filter(
				(path) =>
					previousFiles.has(path) &&
					previousFiles.get(path) !== currentFiles.get(path),
			)
			.sort(),
		telemetry,
		graphUpdate,
	};
}

function emptyBuildTelemetry(): ThemeUpdateTelemetry {
	return {
		filesParsed: 0,
		passKeysProcessed: 0,
		semanticRecordsReplaced: 0,
		graphRecordsReplaced: 0,
		outputsEmitted: 0,
		elapsedMs: 0,
		peakMemoryBytes: buildTelemetryMemory(),
	};
}

function buildTelemetryNow(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function buildTelemetryMemory(): number {
	const processLike = globalThis as typeof globalThis & {
		process?: { memoryUsage?: () => { heapUsed: number } };
	};
	return processLike.process?.memoryUsage?.().heapUsed ?? 0;
}
