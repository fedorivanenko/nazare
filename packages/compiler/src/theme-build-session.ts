import { parseNazareLiquid } from "./parser.js";
import type {
	BuildNazareThemeWorkspaceOptions,
	ThemeAnalysisCache,
	ThemeAnalysisMemo,
	ThemeBuildResult,
	ThemeInputFile,
} from "./theme-facts.js";
import { normalizeThemePath } from "./theme-file-classifier.js";
import { buildNazareThemeWorkspace } from "./theme-workspace.js";

export type ThemeBuildUpdate = {
	revision: number;
	build: ThemeBuildResult;
	changedPaths: string[];
	recomputedPaths: string[];
	addedOutputPaths: string[];
	removedOutputPaths: string[];
	changedOutputPaths: string[];
};

export class ThemeBuildSession {
	private readonly filesByPath = new Map<string, ThemeInputFile>();
	private readonly options: BuildNazareThemeWorkspaceOptions;
	private readonly cache: ThemeAnalysisCache = { version: 1, entries: {} };
	private readonly memo = {} as ThemeAnalysisMemo;
	private build: ThemeBuildResult;
	private outputPathsBySourcePath = new Map<string, Set<string>>();
	private sourcePathsByOutputPath = new Map<string, Set<string>>();
	private revision = 0;

	constructor(
		files: ThemeInputFile[],
		options: BuildNazareThemeWorkspaceOptions = {},
	) {
		this.options = {
			...options,
			cache: options.cache ?? this.cache,
			memo: options.memo ?? this.memo,
		};
		for (const file of files) this.filesByPath.set(file.path, file);
		this.build = buildNazareThemeWorkspace(this.files(), this.options);
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
			return this.emptyUpdate([]);
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
			return this.emptyUpdate([]);
		try {
			return this.rebuild([path]);
		} catch (error) {
			this.filesByPath.set(path, previous);
			throw error;
		}
	}

	private rebuild(changedPaths: string[]): ThemeBuildUpdate {
		const previous = this.build;
		const recomputedPaths = buildRecomputationClosure(
			this.files(),
			changedPaths,
		);
		const rebuilt = buildNazareThemeWorkspace(this.files(), this.options);
		this.build = shareUnchangedOutputSnapshots(previous, rebuilt);
		this.replaceOutputOwnership(this.build);
		this.revision += 1;
		return diffBuilds(
			this.revision,
			previous,
			this.build,
			changedPaths,
			recomputedPaths,
		);
	}

	private replaceOutputOwnership(build: ThemeBuildResult): void {
		const ownership = buildOutputOwnership(build);
		this.outputPathsBySourcePath = ownership.outputPathsBySourcePath;
		this.sourcePathsByOutputPath = ownership.sourcePathsByOutputPath;
	}

	private emptyUpdate(changedPaths: string[]): ThemeBuildUpdate {
		return diffBuilds(this.revision, this.build, this.build, changedPaths, []);
	}

	private files(): ThemeInputFile[] {
		return [...this.filesByPath.values()].sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}
}

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
	};
}
