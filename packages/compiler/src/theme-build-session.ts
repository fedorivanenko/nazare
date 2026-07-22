import type {
	BuildNazareThemeWorkspaceOptions,
	ThemeBuildResult,
	ThemeInputFile,
} from "./theme-facts.js";
import { buildNazareThemeWorkspace } from "./theme-workspace.js";

export type ThemeBuildUpdate = {
	revision: number;
	build: ThemeBuildResult;
	changedPaths: string[];
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
		return diffBuilds(this.revision, previous, this.build, changedPaths);
	}

	private emptyUpdate(changedPaths: string[]): ThemeBuildUpdate {
		return diffBuilds(this.revision, this.build, this.build, changedPaths);
	}

	private files(): ThemeInputFile[] {
		return [...this.filesByPath.values()].sort((a, b) =>
			a.path.localeCompare(b.path),
		);
	}
}

function diffBuilds(
	revision: number,
	previous: ThemeBuildResult,
	current: ThemeBuildResult,
	changedPaths: string[],
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
