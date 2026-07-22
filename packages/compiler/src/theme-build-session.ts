import { parseNazareLiquid } from "./parser.js";
import type {
	BuildNazareThemeWorkspaceOptions,
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
	private build: ThemeBuildResult;
	private revision = 0;

	constructor(
		files: ThemeInputFile[],
		options: BuildNazareThemeWorkspaceOptions = {},
	) {
		this.options = options;
		for (const file of files) this.filesByPath.set(file.path, file);
		this.build = buildNazareThemeWorkspace(this.files(), this.options);
	}

	getBuild(): ThemeBuildResult {
		return this.build;
	}

	updateFile(file: ThemeInputFile): ThemeBuildUpdate {
		if (this.filesByPath.get(file.path)?.contents === file.contents) {
			return this.emptyUpdate([]);
		}
		this.filesByPath.set(file.path, file);
		return this.rebuild([file.path]);
	}

	removeFile(path: string): ThemeBuildUpdate {
		if (!this.filesByPath.delete(path)) return this.emptyUpdate([]);
		return this.rebuild([path]);
	}

	private rebuild(changedPaths: string[]): ThemeBuildUpdate {
		const previous = this.build;
		this.build = buildNazareThemeWorkspace(this.files(), this.options);
		this.revision += 1;
		return diffBuilds(
			this.revision,
			previous,
			this.build,
			changedPaths,
			buildRecomputationClosure(this.files(), changedPaths),
		);
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
