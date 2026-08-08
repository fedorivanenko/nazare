import { posix } from "node:path";
import {
	type ComputationContext,
	type ComputationGraph,
	type ComputationUncertainty,
	defineComputation,
	defineProduct,
	productKeyCodec,
} from "@nazare/compiler/computation";
import {
	normalizeProjectPath,
	type ProjectFileId,
	projectFileId,
	serializeProjectFileId,
} from "@nazare/compiler/project";
import {
	PROJECT_SOURCE_CATALOG_KEY,
	sourceProducts,
} from "@nazare/compiler/source-products";
import type { Diagnostic } from "@nazare/core";
import {
	mapWithConcurrency,
	SHOPIFY_PRODUCT_CONCURRENCY,
} from "./concurrency.js";
import {
	type ShopifyDeclaration,
	type ShopifyReference,
	shopifyProducts,
} from "./products.js";
import {
	classifyShopifyFile,
	type ShopifyFileRole,
	shopifyResourceName,
} from "./role.js";

export type ShopifySymbolQuery = {
	role: ShopifyFileRole;
	name: string;
};

export type ShopifyReferenceQuery = {
	owner: ProjectFileId;
	referenceId: string;
};

export type ShopifyResolutionPlan = {
	file: ProjectFileId;
};

export type ShopifyWorkspaceIndex = {
	files: readonly ProjectFileId[];
	byPath: Readonly<Record<string, ProjectFileId>>;
	bySymbol: Readonly<Record<string, readonly ProjectFileId[]>>;
};

export type ShopifyReferenceResolution = {
	reference: ShopifyReference;
	status: "resolved" | "missing" | "ambiguous" | "dynamic";
	declarations: readonly ShopifyDeclaration[];
	targetFiles: readonly ProjectFileId[];
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly ComputationUncertainty[];
};

export const shopifyResolutionProducts = {
	workspaceIndex: defineProduct<string, ShopifyWorkspaceIndex>({
		namespace: "nazare.target.shopify.resolve",
		id: "workspace-index",
		version: 1,
	}),
	declarationsBySymbol: defineProduct<
		ShopifySymbolQuery,
		readonly ShopifyDeclaration[]
	>({
		namespace: "nazare.target.shopify",
		id: "declarations-by-symbol",
		version: 1,
	}),
	referenceResolution: defineProduct<
		ShopifyReferenceQuery,
		ShopifyReferenceResolution
	>({
		namespace: "nazare.target.shopify",
		id: "reference-resolution",
		version: 1,
	}),
	fileResolutions: defineProduct<
		ShopifyResolutionPlan,
		readonly ShopifyReferenceResolution[]
	>({
		namespace: "nazare.target.shopify",
		id: "file-resolutions",
		version: 1,
	}),
};

export function registerShopifyResolutionComputations(
	graph: ComputationGraph,
): void {
	graph.register(
		defineComputation(
			shopifyResolutionProducts.workspaceIndex,
			async (context) => {
				const files = await context.get(
					sourceProducts.catalog.product(PROJECT_SOURCE_CATALOG_KEY),
				);
				const byPath: Record<string, ProjectFileId> = {};
				const bySymbol: Record<string, ProjectFileId[]> = {};
				for (const file of files) {
					byPath[serializeProjectFileId(file)] = file;
					const role = classifyShopifyFile(file.path);
					const name = shopifyResourceName(file.path);
					if (!name) continue;
					const key = symbolKey(role, name);
					const candidates = bySymbol[key] ?? [];
					candidates.push(file);
					bySymbol[key] = candidates;
				}
				return { files, byPath, bySymbol };
			},
			{ cache: productKeyCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyResolutionProducts.declarationsBySymbol,
			async (context, query) => {
				const index = await context.get(
					shopifyResolutionProducts.workspaceIndex.product(
						PROJECT_SOURCE_CATALOG_KEY,
					),
				);
				const candidateFiles =
					index.bySymbol[symbolKey(query.role, query.name)] ?? [];
				const declarations = await mapWithConcurrency(
					candidateFiles,
					SHOPIFY_PRODUCT_CONCURRENCY,
					(file) => context.get(shopifyProducts.declarations.product(file)),
				);
				return declarations
					.flat()
					.filter(
						(declaration) =>
							declaration.role === query.role &&
							declaration.name === query.name,
					)
					.sort((left, right) => left.id.localeCompare(right.id));
			},
			{ cache: productKeyCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyResolutionProducts.referenceResolution,
			async (context, query) => {
				const references = await context.get(
					shopifyProducts.references.product(query.owner),
				);
				const reference = references.find(
					(candidate) => candidate.id === query.referenceId,
				);
				if (!reference) {
					throw new Error(
						`Shopify reference ${query.referenceId} is not owned by ${query.owner.path}`,
					);
				}
				return resolveReference(context, reference);
			},
			{
				cache: productKeyCodec(),
				diagnostics: (result) => result.diagnostics,
				uncertainty: (result) => result.uncertainty,
			},
		),
	);

	graph.register(
		defineComputation(
			shopifyResolutionProducts.fileResolutions,
			async (context, plan) => {
				const references = await context.get(
					shopifyProducts.references.product(plan.file),
				);
				return mapWithConcurrency(
					references,
					SHOPIFY_PRODUCT_CONCURRENCY,
					(reference) =>
						context.get(
							shopifyResolutionProducts.referenceResolution.product({
								owner: plan.file,
								referenceId: reference.id,
							}),
						),
				);
			},
			{ cache: productKeyCodec() },
		),
	);
}

async function resolveReference(
	context: ComputationContext,
	reference: ShopifyReference,
): Promise<ShopifyReferenceResolution> {
	if (!reference.static) {
		return resolution(
			reference,
			"dynamic",
			[],
			[],
			[],
			[
				{
					code: "SHOPIFY_DYNAMIC_REFERENCE",
					message: `Dynamic ${reference.referenceKind} reference cannot be resolved statically`,
				},
			],
		);
	}
	const index = await context.get(
		shopifyResolutionProducts.workspaceIndex.product(
			PROJECT_SOURCE_CATALOG_KEY,
		),
	);
	if (reference.targetPath) {
		const target = resolveTargetFile(reference, index);
		if (!target) return unresolved(reference);
		return resolution(reference, "resolved", [], [target]);
	}
	if (reference.targetRole && reference.targetName) {
		const declarations = await context.get(
			shopifyResolutionProducts.declarationsBySymbol.product({
				role: reference.targetRole,
				name: reference.targetName,
			}),
		);
		if (declarations.length === 0) return unresolved(reference);
		if (declarations.length > 1) {
			return resolution(
				reference,
				"ambiguous",
				declarations,
				declarations.map((declaration) => declaration.owner),
				[
					{
						severity: "error",
						code: "SHOPIFY_REFERENCE_AMBIGUOUS",
						message: `Ambiguous ${reference.referenceKind} reference ${reference.targetName}`,
						phase: "resolve",
					},
				],
			);
		}
		return resolution(reference, "resolved", declarations, [
			declarations[0]?.owner as ProjectFileId,
		]);
	}
	return unresolved(reference);
}

function resolveTargetFile(
	reference: ShopifyReference,
	index: ShopifyWorkspaceIndex,
): ProjectFileId | undefined {
	if (!reference.targetPath) return undefined;
	const path = reference.targetRelative
		? normalizeProjectPath(
				posix.join(posix.dirname(reference.owner.path), reference.targetPath),
			)
		: normalizeProjectPath(reference.targetPath);
	const expected = projectFileId({ ...reference.owner, path });
	return index.byPath[serializeProjectFileId(expected)];
}

function symbolKey(role: ShopifyFileRole, name: string): string {
	return `${role}\0${name}`;
}

function unresolved(reference: ShopifyReference): ShopifyReferenceResolution {
	const target =
		reference.targetName ?? reference.targetPath ?? "unknown target";
	return resolution(
		reference,
		"missing",
		[],
		[],
		[
			{
				severity: "error",
				code: "SHOPIFY_REFERENCE_NOT_FOUND",
				message: `Unresolved ${reference.referenceKind} reference ${target}`,
				phase: "resolve",
			},
		],
	);
}

function resolution(
	reference: ShopifyReference,
	status: ShopifyReferenceResolution["status"],
	declarations: readonly ShopifyDeclaration[],
	targetFiles: readonly ProjectFileId[],
	diagnostics: readonly Diagnostic[] = [],
	uncertainty: readonly ComputationUncertainty[] = [],
): ShopifyReferenceResolution {
	return {
		reference,
		status,
		declarations,
		targetFiles,
		diagnostics,
		uncertainty,
	};
}
