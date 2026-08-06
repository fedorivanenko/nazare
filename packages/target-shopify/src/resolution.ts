import { posix } from "node:path";
import {
	type ComputationContext,
	type ComputationGraph,
	type ComputationUncertainty,
	defineComputation,
	defineProduct,
	productKeyValueCodec,
} from "@nazare/compiler/computation";
import {
	normalizeProjectPath,
	type ProjectFileId,
	projectFileId,
	serializeProjectFileId,
} from "@nazare/compiler/project";
import type { Diagnostic } from "@nazare/core";
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
	files: readonly ProjectFileId[];
};

export type ShopifyReferenceQuery = {
	owner: ProjectFileId;
	referenceId: string;
	files: readonly ProjectFileId[];
};

export type ShopifyResolutionPlan = {
	file: ProjectFileId;
	files: readonly ProjectFileId[];
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
			shopifyResolutionProducts.declarationsBySymbol,
			async (context, query) => {
				const candidateFiles = query.files.filter(
					(file) =>
						classifyShopifyFile(file.path) === query.role &&
						shopifyResourceName(file.path) === query.name,
				);
				const declarations = await Promise.all(
					candidateFiles.map((file) =>
						context.get(shopifyProducts.declarations.product(file)),
					),
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
			{ cache: productKeyValueCodec() },
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
				return resolveReference(context, reference, query.files);
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
			shopifyResolutionProducts.fileResolutions,
			async (context, plan) => {
				const references = await context.get(
					shopifyProducts.references.product(plan.file),
				);
				return Promise.all(
					references.map((reference) =>
						context.get(
							shopifyResolutionProducts.referenceResolution.product({
								owner: plan.file,
								referenceId: reference.id,
								files: plan.files,
							}),
						),
					),
				);
			},
			{ cache: productKeyValueCodec() },
		),
	);
}

async function resolveReference(
	context: ComputationContext,
	reference: ShopifyReference,
	files: readonly ProjectFileId[],
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
	if (reference.targetPath) {
		const target = resolveTargetFile(reference, files);
		if (!target) return unresolved(reference);
		return resolution(reference, "resolved", [], [target]);
	}
	if (reference.targetRole && reference.targetName) {
		const declarations = await context.get(
			shopifyResolutionProducts.declarationsBySymbol.product({
				role: reference.targetRole,
				name: reference.targetName,
				files,
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
	files: readonly ProjectFileId[],
): ProjectFileId | undefined {
	if (!reference.targetPath) return undefined;
	const path = reference.targetRelative
		? normalizeProjectPath(
				posix.join(posix.dirname(reference.owner.path), reference.targetPath),
			)
		: normalizeProjectPath(reference.targetPath);
	const expected = projectFileId({ ...reference.owner, path });
	const identity = serializeProjectFileId(expected);
	return files.find((file) => serializeProjectFileId(file) === identity);
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
