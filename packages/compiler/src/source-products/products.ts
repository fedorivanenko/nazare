import { posix } from "node:path";
import type { Diagnostic } from "@nazare/core";
import {
	defineComputation,
	productKeyValueCodec,
} from "../computation/computation.js";
import type { ComputationGraph } from "../computation/graph.js";
import { defineProduct } from "../computation/product.js";
import {
	type ComputationRegistrar,
	defineComputationRegistrar,
} from "../computation/registrar.js";
import {
	normalizeProjectPath,
	type ProjectFileId,
	projectFileId,
	serializeProjectFileId,
} from "../project/file-id.js";
import type { ProjectFile } from "../project/file-system-provider.js";
import type { ProjectHost } from "../project/host.js";
import { projectFileRevisionInput } from "../project/session.js";
import type {
	ClassifiedSourceFile,
	ParsedSourceFile,
	SourceFact,
	SourceFacts,
	SourceFrontendRegistry,
} from "./frontend.js";

export type SourceDependencyEdge = {
	from: ProjectFileId;
	to: ProjectFileId;
	kind: string;
	factId: string;
};

export type SourceAnalysisPlan = {
	roots: readonly ProjectFileId[];
	files: readonly ProjectFileId[];
};

export type ReachableSourceClosure = {
	files: readonly ProjectFileId[];
	edges: readonly SourceDependencyEdge[];
	diagnostics: readonly Diagnostic[];
};

export const sourceProducts = {
	file: defineProduct<ProjectFileId, ProjectFile>({
		namespace: "nazare.input",
		id: "project-file",
		version: 1,
	}),
	classified: defineProduct<ProjectFileId, ClassifiedSourceFile>({
		namespace: "nazare.source",
		id: "classified-file",
		version: 1,
	}),
	parsed: defineProduct<ProjectFileId, ParsedSourceFile>({
		namespace: "nazare.source",
		id: "parsed-file",
		version: 1,
	}),
	facts: defineProduct<ProjectFileId, SourceFacts>({
		namespace: "nazare.source",
		id: "source-facts",
		version: 1,
	}),
	dependencies: defineProduct<ProjectFileId, readonly SourceDependencyEdge[]>({
		namespace: "nazare.source",
		id: "dependency-edges",
		version: 1,
	}),
	closure: defineProduct<SourceAnalysisPlan, ReachableSourceClosure>({
		namespace: "nazare.source",
		id: "reachable-closure",
		version: 1,
	}),
};

export function createSourceProductRegistrar(input: {
	host: ProjectHost<ProjectFileId, ProjectFile>;
	frontends: SourceFrontendRegistry;
}): ComputationRegistrar {
	return defineComputationRegistrar(
		{
			id: "nazare.source-products",
			version: 1,
		},
		(graph) => registerSourceProducts(graph, input),
	);
}

function registerSourceProducts(
	graph: ComputationGraph,
	input: {
		host: ProjectHost<ProjectFileId, ProjectFile>;
		frontends: SourceFrontendRegistry;
	},
): void {
	const frontendInput = "nazare.source-frontends";
	const frontendUpdate = graph.beginUpdate();
	frontendUpdate.setInput(frontendInput, input.frontends.identity);
	frontendUpdate.commit();

	graph.register(
		defineComputation(
			sourceProducts.file,
			async (context, key) => {
				const expectedFingerprint = await context.input<string>(
					projectFileRevisionInput(key),
				);
				const current = await input.host.files.read(key);
				if (current.fingerprint !== expectedFingerprint) {
					throw new Error(
						`Project file changed during computation: ${key.path}`,
					);
				}
				return current.value;
			},
			{ cache: productKeyValueCodec() },
		),
	);

	graph.register(
		defineComputation(
			sourceProducts.classified,
			async (context, key) => {
				await context.input(frontendInput);
				const file = await context.get(sourceProducts.file.product(key));
				const frontend = input.frontends.select(file);
				return {
					...file,
					language: frontend.language,
					frontendId: frontend.id,
					frontendVersion: frontend.version,
				};
			},
			{ cache: productKeyValueCodec() },
		),
	);

	graph.register(
		defineComputation(
			sourceProducts.parsed,
			async (context, key) => {
				const file = await context.get(sourceProducts.classified.product(key));
				const frontend = input.frontends.get(
					file.frontendId,
					file.frontendVersion,
				);
				return frontend.parse(file, context);
			},
			{
				diagnostics: (result) => result.diagnostics,
				uncertainty: (result) => result.uncertainty,
			},
		),
	);

	graph.register(
		defineComputation(
			sourceProducts.facts,
			async (context, key) => {
				const parsed = await context.get(sourceProducts.parsed.product(key));
				const frontend = input.frontends.get(
					parsed.file.frontendId,
					parsed.file.frontendVersion,
				);
				return frontend.extractFacts(parsed, context);
			},
			{
				cache: productKeyValueCodec(),
				diagnostics: (result) => result.diagnostics,
				uncertainty: (result) => result.uncertainty,
			},
		),
	);

	graph.register(
		defineComputation(
			sourceProducts.dependencies,
			async (context, key) => {
				const facts = await context.get(sourceProducts.facts.product(key));
				return facts.facts.flatMap((fact) => dependencyEdge(fact) ?? []);
			},
			{ cache: productKeyValueCodec() },
		),
	);

	graph.register(
		defineComputation(
			sourceProducts.closure,
			async (context, plan) => {
				const available = new Map(
					plan.files.map((file) => [serializeProjectFileId(file), file]),
				);
				const visited = new Map<string, ProjectFileId>();
				const edges: SourceDependencyEdge[] = [];
				const diagnostics: Diagnostic[] = [];
				const pending = [...plan.roots].reverse();
				while (pending.length > 0) {
					const file = projectFileId(pending.pop() as ProjectFileId);
					const identity = serializeProjectFileId(file);
					if (visited.has(identity)) continue;
					if (!available.has(identity)) {
						diagnostics.push(missingDependencyDiagnostic(file));
						continue;
					}
					visited.set(identity, file);
					const outgoing = await context.get(
						sourceProducts.dependencies.product(file),
					);
					edges.push(...outgoing);
					for (const edge of [...outgoing].reverse()) pending.push(edge.to);
				}
				return {
					files: [...visited.values()].sort((left, right) =>
						serializeProjectFileId(left).localeCompare(
							serializeProjectFileId(right),
						),
					),
					edges,
					diagnostics,
				};
			},
			{
				cache: productKeyValueCodec(),
				diagnostics: (result) => result.diagnostics,
			},
		),
	);
}

function dependencyEdge(fact: SourceFact): SourceDependencyEdge | undefined {
	if (fact.kind !== "dependency" || !isRecord(fact.data)) return undefined;
	const path = fact.data.path;
	if (typeof path !== "string") return undefined;
	const relative = fact.data.relative !== false;
	const targetPath = relative
		? normalizeProjectPath(posix.join(posix.dirname(fact.file.path), path))
		: normalizeProjectPath(path);
	return {
		from: fact.file,
		to: projectFileId({ ...fact.file, path: targetPath }),
		kind: typeof fact.data.kind === "string" ? fact.data.kind : "import",
		factId: fact.id,
	};
}

function missingDependencyDiagnostic(file: ProjectFileId): Diagnostic {
	return {
		severity: "error",
		code: "SOURCE_DEPENDENCY_NOT_FOUND",
		message: `Source dependency not found: ${file.path}`,
		phase: "resolve",
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
