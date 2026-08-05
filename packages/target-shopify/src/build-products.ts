import {
	type CapabilityProvider,
	type CompiledComponent,
	type ComputationContext,
	type ComputationGraph,
	compileArtifact,
	createOwnedOutputPlan,
	defineCapability,
	defineCapabilityProvider,
	defineComputation,
	defineProduct,
	emitTheme,
	jsonComputationCodec,
	type OwnedOutputFile,
	type OwnedOutputPlan,
	type PortableApplicationModel,
	type ProjectFileId,
	portableApplicationModel,
	serializeProjectFileId,
	sourceProducts,
} from "@nazare/compiler";
import type { Diagnostic } from "@nazare/core";
import { shopifyResolutionProducts } from "./resolution.js";

export type ShopifyBuildScope =
	| { kind: "workspace" }
	| { kind: "closure"; root: ProjectFileId }
	| { kind: "file"; file: ProjectFileId }
	| { kind: "files"; files: readonly ProjectFileId[] };

export type ShopifyBuildPlan = {
	scope: ShopifyBuildScope;
	files: readonly ProjectFileId[];
	emitOnError: boolean;
	checkOnly: boolean;
	previouslyOwnedPaths: readonly string[];
};

export type ShopifyBuildModel = {
	version: 1;
	scope: ShopifyBuildScope;
	files: readonly ProjectFileId[];
	roots: readonly ProjectFileId[];
	application: PortableApplicationModel;
	diagnostics: readonly Diagnostic[];
	canEmit: boolean;
};

export type ShopifyEmissionPlan = {
	version: 1;
	files: readonly OwnedOutputFile[];
	diagnostics: readonly Diagnostic[];
	checkOnly: boolean;
};

export const shopifyBuildProducts = {
	model: defineProduct<ShopifyBuildPlan, ShopifyBuildModel>({
		namespace: "nazare.target.shopify.build",
		id: "model",
		version: 1,
	}),
	emission: defineProduct<ShopifyBuildPlan, ShopifyEmissionPlan>({
		namespace: "nazare.target.shopify.build",
		id: "emission-plan",
		version: 1,
	}),
	ownedOutput: defineProduct<ShopifyBuildPlan, OwnedOutputPlan>({
		namespace: "nazare.target.shopify.build",
		id: "owned-output-plan",
		version: 1,
	}),
};

export type ShopifyBuildCapability = {
	products: typeof shopifyBuildProducts;
};

export const shopifyBuildCapability = defineCapability<ShopifyBuildCapability>(
	"nazare.build.shopify",
);

export function shopifyBuildOutput(): CapabilityProvider<ShopifyBuildCapability> {
	return defineCapabilityProvider({
		capability: shopifyBuildCapability,
		id: "nazare.build.shopify",
		version: 1,
		value: { products: shopifyBuildProducts },
		registerComputations: registerShopifyBuildComputations,
	});
}

export function registerShopifyBuildComputations(
	graph: ComputationGraph,
): void {
	graph.register(
		defineComputation(
			shopifyBuildProducts.model,
			async (context, plan) => {
				const selected = await selectBuildFiles(context, plan);
				const roots = buildRoots(plan.scope, selected);
				const application = await context.get(
					portableApplicationModel.product({ files: selected, roots }),
				);
				const diagnostics = application.diagnostics;
				return {
					version: 1 as const,
					scope: plan.scope,
					files: selected,
					roots,
					application,
					diagnostics,
					canEmit: !diagnostics.some(
						(diagnostic) => diagnostic.severity === "error",
					),
				};
			},
			{
				cache: jsonComputationCodec(),
				diagnostics: (model) => model.diagnostics,
			},
		),
	);

	graph.register(
		defineComputation(
			shopifyBuildProducts.emission,
			async (context, plan) => {
				const model = await context.get(
					shopifyBuildProducts.model.product(plan),
				);
				const sources = await Promise.all(
					model.files.map((file) =>
						context.get(sourceProducts.classified.product(file)),
					),
				);
				const sourceByPath = new Map(
					sources.map((source) => [source.id.path, source.contents]),
				);
				const files: OwnedOutputFile[] = [];
				const diagnostics: Diagnostic[] = [...model.diagnostics];
				for (const source of sources) {
					if (source.language !== "nazare-liquid") {
						files.push({
							path: source.id.path,
							contents: source.contents,
							ownerId: `source:${serializeProjectFileId(source.id)}`,
						});
						continue;
					}
					const compiled = compileArtifact({
						source: source.contents,
						file: source.id.path,
						readFile: (path) => sourceByPath.get(path),
					});
					if (!compiled.ok || !compiled.ast) {
						diagnostics.push(...compiled.issues);
						continue;
					}
					const emitted = emitTheme(
						source.contents,
						compiled as CompiledComponent,
						{
							name: componentName(source.id.path),
							readFile: (path) => sourceByPath.get(path),
						},
					);
					diagnostics.push(...emitted.issues);
					files.push(
						...emitted.files.map((file) => ({
							...file,
							ownerId: `source:${serializeProjectFileId(source.id)}`,
						})),
					);
				}
				const hasErrors = diagnostics.some(
					(diagnostic) => diagnostic.severity === "error",
				);
				return {
					version: 1 as const,
					files:
						plan.checkOnly || (hasErrors && !plan.emitOnError) ? [] : files,
					diagnostics,
					checkOnly: plan.checkOnly,
				};
			},
			{
				cache: jsonComputationCodec(),
				diagnostics: (emission) => emission.diagnostics,
			},
		),
	);

	graph.register(
		defineComputation(
			shopifyBuildProducts.ownedOutput,
			async (context, plan) => {
				const emission = await context.get(
					shopifyBuildProducts.emission.product(plan),
				);
				const owned = createOwnedOutputPlan({
					writes: emission.files,
					previouslyOwnedPaths: emission.checkOnly
						? []
						: plan.previouslyOwnedPaths,
				});
				return {
					...owned,
					diagnostics: [...emission.diagnostics, ...owned.diagnostics],
				};
			},
			{
				cache: jsonComputationCodec(),
				diagnostics: (plan) => plan.diagnostics,
			},
		),
	);
}

async function selectBuildFiles(
	context: ComputationContext,
	plan: ShopifyBuildPlan,
): Promise<ProjectFileId[]> {
	if (plan.scope.kind === "workspace")
		return [...plan.files].sort(compareFiles);
	if (plan.scope.kind === "file") return [plan.scope.file];
	if (plan.scope.kind === "files")
		return [...plan.scope.files].sort(compareFiles);
	const selected = new Map<string, ProjectFileId>();
	const pending = [plan.scope.root];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file) continue;
		const identity = serializeProjectFileId(file);
		if (selected.has(identity)) continue;
		selected.set(identity, file);
		const resolutions = await context.get(
			shopifyResolutionProducts.fileResolutions.product({
				file,
				files: plan.files,
			}),
		);
		for (const resolution of resolutions) {
			for (const target of resolution.targetFiles) pending.push(target);
		}
	}
	return [...selected.values()].sort(compareFiles);
}

function buildRoots(
	scope: ShopifyBuildScope,
	selected: readonly ProjectFileId[],
): ProjectFileId[] {
	if (scope.kind === "closure") return [scope.root];
	if (scope.kind === "file") return [scope.file];
	if (scope.kind === "files") return [...scope.files].sort(compareFiles);
	return [...selected];
}

function componentName(path: string): string {
	return (path.split("/").at(-1) ?? path).replace(/\.nz\.liquid$/, "");
}

function compareFiles(left: ProjectFileId, right: ProjectFileId): number {
	return serializeProjectFileId(left).localeCompare(
		serializeProjectFileId(right),
	);
}
