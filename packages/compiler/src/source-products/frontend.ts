import type { Diagnostic } from "@nazare/core";
import type { ProductKey } from "../computation/canonical-key.js";
import type {
	ComputationPriority,
	ComputationUncertainty,
} from "../computation/computation.js";
import { registrarIdentity } from "../computation/registrar.js";
import type { ProjectFileId } from "../project/file-id.js";
import type { ProjectFile } from "../project/file-system-provider.js";

export type LanguageId = string;

export type ClassifiedSourceFile = ProjectFile & {
	language: LanguageId;
	frontendId: string;
	frontendVersion: number;
};

export type ParsedSourceSyntax = {
	value: unknown;
};

export type ParsedSourceFile = {
	file: ClassifiedSourceFile;
	syntax: ParsedSourceSyntax;
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly ComputationUncertainty[];
};

export type SourceFact = {
	id: string;
	kind: string;
	file: ProjectFileId;
	data: ProductKey;
};

export type SourceFacts = {
	file: ProjectFileId;
	facts: readonly SourceFact[];
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly ComputationUncertainty[];
};

export type SourceFrontendContext = {
	signal: AbortSignal;
	priority: ComputationPriority;
};

export type SourceFrontend = {
	id: string;
	version: number;
	language: LanguageId;
	accepts(file: ProjectFile): boolean;
	parse(
		file: ClassifiedSourceFile,
		context: SourceFrontendContext,
	): Promise<ParsedSourceFile>;
	extractFacts(
		parsed: ParsedSourceFile,
		context: SourceFrontendContext,
	): Promise<SourceFacts>;
};

export type SourceFrontendRegistry = {
	frontends: readonly SourceFrontend[];
	identity: readonly string[];
	select(file: ProjectFile): SourceFrontend;
	get(id: string, version: number): SourceFrontend;
};

export function defineSourceFrontend(frontend: SourceFrontend): SourceFrontend {
	registrarIdentity(frontend);
	if (!frontend.language)
		throw new TypeError("Source frontend language is required");
	return Object.freeze(frontend);
}

export function createSourceFrontendRegistry(
	frontends: readonly SourceFrontend[],
): SourceFrontendRegistry {
	const byIdentity = new Map<string, SourceFrontend>();
	for (const frontend of frontends) {
		const identity = registrarIdentity(frontend);
		if (byIdentity.has(identity)) {
			throw new Error(`Source frontend already registered: ${identity}`);
		}
		byIdentity.set(identity, frontend);
	}
	const stableFrontends = Object.freeze([...frontends]);
	return Object.freeze({
		frontends: stableFrontends,
		identity: Object.freeze(stableFrontends.map(registrarIdentity)),
		select(file) {
			const frontend = stableFrontends.find((candidate) =>
				candidate.accepts(file),
			);
			if (!frontend)
				throw new Error(`No source frontend accepts ${file.id.path}`);
			return frontend;
		},
		get(id, version) {
			const frontend = byIdentity.get(`${id}@${version}`);
			if (!frontend)
				throw new Error(`Source frontend not registered: ${id}@${version}`);
			return frontend;
		},
	});
}
