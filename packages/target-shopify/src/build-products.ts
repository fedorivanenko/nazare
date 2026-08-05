import {
	type CompiledComponent,
	compileArtifact,
	emitTheme,
} from "@nazare/compiler";
import {
	type CapabilityProvider,
	type ComputationContext,
	type ComputationGraph,
	defineCapability,
	defineCapabilityProvider,
	defineComputation,
	defineProduct,
	jsonComputationCodec,
	type ProductKey,
} from "@nazare/compiler/computation";
import {
	createOwnedOutputPlan,
	createProtectedOwnedOutputPlan,
	type ExistingOutputState,
	type OwnedOutputFile,
	type OwnedOutputPlan,
} from "@nazare/compiler/output";
import {
	type PortableApplicationModel,
	portableApplicationModel,
} from "@nazare/compiler/portable";
import {
	type ProjectFileId,
	serializeProjectFileId,
} from "@nazare/compiler/project";
import {
	type SourceFact,
	sourceProducts,
} from "@nazare/compiler/source-products";
import type { Diagnostic } from "@nazare/core";
import { shopifyProducts } from "./products.js";
import {
	applyMigrationsToMerchantData,
	applyMigrationsToSchemaLock,
	mergeShopifyLocale,
	type ShopifyMigration,
} from "./reconciliation.js";
import { shopifyResolutionProducts } from "./resolution.js";
import { shopifySemanticProducts } from "./semantic-products.js";

export type ShopifyBuildScope =
	| { kind: "workspace" }
	| { kind: "closure"; root: ProjectFileId }
	| { kind: "file"; file: ProjectFileId }
	| { kind: "files"; files: readonly ProjectFileId[] };

export type ShopifySchemaLockEntry = {
	settings: readonly { id: string; type: string }[];
	blocks: readonly { type: string }[];
};

export type ShopifySchemaLock = {
	version: 1;
	sections: Readonly<Record<string, ShopifySchemaLockEntry>>;
};

export type ShopifySchemaDrift = {
	code:
		| "SHOPIFY_SECTION_REMOVED"
		| "SHOPIFY_SETTING_REMOVED"
		| "SHOPIFY_SETTING_RETYPED"
		| "SHOPIFY_BLOCK_REMOVED";
	message: string;
};

export type ShopifyBuildPlan = {
	scope: ShopifyBuildScope;
	files: readonly ProjectFileId[];
	emitOnError: boolean;
	checkOnly: boolean;
	previouslyOwnedPaths: readonly string[];
	existingOutput: ExistingOutputState | null;
	priorSchemaLock: ShopifySchemaLock | null;
	migrations: readonly ShopifyMigration[];
	appliedMigrationIds: readonly string[];
	localeBase: Readonly<Record<string, ProductKey>>;
	additionalOutputFiles?: readonly OwnedOutputFile[];
	strictness?: "loose" | "strict";
	additionalDiagnostics?: readonly Diagnostic[];
};

export type ShopifyBuildModel = {
	version: 1;
	scope: ShopifyBuildScope;
	files: readonly ProjectFileId[];
	roots: readonly ProjectFileId[];
	application: PortableApplicationModel;
	schemaLock: ShopifySchemaLock;
	schemaDrift: readonly ShopifySchemaDrift[];
	diagnostics: readonly Diagnostic[];
	canEmit: boolean;
};

export type ShopifyEmissionPlan = {
	version: 1;
	files: readonly OwnedOutputFile[];
	diagnostics: readonly Diagnostic[];
	checkOnly: boolean;
	appliedMigrationIds: readonly string[];
	migratedPaths: readonly string[];
	mergedLocalePaths: readonly string[];
	nextLocaleBase: Readonly<Record<string, ProductKey>>;
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
				const schemaRecords = await Promise.all(
					selected.map(async (file) => ({
						file,
						schema: await context.get(
							shopifySemanticProducts.schema.product(file),
						),
						classification: await context.get(
							shopifyProducts.classification.product(file),
						),
						facts: await context.get(sourceProducts.facts.product(file)),
					})),
				);
				const schemaLock = createSchemaLock(schemaRecords);
				const diagnostics = application.diagnostics;
				return {
					version: 1 as const,
					scope: plan.scope,
					files: selected,
					roots,
					application,
					schemaLock,
					schemaDrift: diffSchemaLocks(
						plan.priorSchemaLock
							? applyMigrationsToSchemaLock(
									plan.priorSchemaLock,
									plan.migrations,
								)
							: null,
						schemaLock,
					),
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
				const diagnostics: Diagnostic[] = [
					...model.diagnostics,
					...(plan.additionalDiagnostics ?? []),
				];
				for (const source of sources) {
					if (source.language !== "nazare-liquid") {
						files.push({
							path: source.id.path,
							contents: source.contents,
							ownerId: `source:${serializeProjectFileId(source.id)}`,
							...(isMerchantOwnedPath(source.id.path)
								? { ownership: "merchant" as const }
								: {}),
						});
						continue;
					}
					const compiled = compileArtifact({
						source: source.contents,
						file: source.id.path,
						readFile: (path) => sourceByPath.get(path),
						strictness: plan.strictness,
					});
					diagnostics.push(...compiled.issues, ...compiled.notes);
					if (!compiled.ok || !compiled.ast) continue;
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
				files.push(...(plan.additionalOutputFiles ?? []));
				diagnostics.push(
					...createOwnedOutputPlan({ writes: files }).diagnostics,
				);
				const reconciled = reconcileOutput(files, plan);
				diagnostics.push(...reconciled.diagnostics);
				const hasErrors = diagnostics.some(
					(diagnostic) => diagnostic.severity === "error",
				);
				return {
					version: 1 as const,
					files:
						plan.checkOnly || (hasErrors && !plan.emitOnError)
							? []
							: reconciled.files,
					diagnostics,
					checkOnly: plan.checkOnly,
					appliedMigrationIds: reconciled.appliedMigrationIds,
					migratedPaths: reconciled.migratedPaths,
					mergedLocalePaths: reconciled.mergedLocalePaths,
					nextLocaleBase: reconciled.nextLocaleBase,
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
				const owned =
					plan.existingOutput && !emission.checkOnly
						? createProtectedOwnedOutputPlan({
								writes: emission.files,
								existing: plan.existingOutput,
							})
						: createOwnedOutputPlan({
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

function reconcileOutput(
	files: readonly OwnedOutputFile[],
	plan: ShopifyBuildPlan,
): {
	files: OwnedOutputFile[];
	diagnostics: Diagnostic[];
	appliedMigrationIds: string[];
	migratedPaths: string[];
	mergedLocalePaths: string[];
	nextLocaleBase: Record<string, ProductKey>;
} {
	const output = new Map(files.map((file) => [file.path, file]));
	const existing = plan.existingOutput?.contents ?? {};
	const alreadyApplied = new Set(plan.appliedMigrationIds);
	const unapplied = plan.migrations.filter(
		(migration) => !alreadyApplied.has(migration.id),
	);
	const existingData = Object.fromEntries(
		Object.entries(existing).filter(([path]) => isMerchantDataPath(path)),
	);
	const migrated = applyMigrationsToMerchantData(existingData, unapplied);
	const diagnostics = [...migrated.diagnostics];
	for (const path of new Set([
		...Object.keys(migrated.contents),
		...files
			.filter((file) => isMerchantDataPath(file.path))
			.map((file) => file.path),
	])) {
		const source = output.get(path);
		const target = migrated.contents[path];
		if (target !== undefined) {
			output.set(path, {
				path,
				contents: target,
				ownerId: "merchant:data",
				ownership: "merchant",
			});
		} else if (source) output.set(path, { ...source, ownership: "merchant" });
	}

	const nextLocaleBase: Record<string, ProductKey> = {};
	const mergedLocalePaths: string[] = [];
	const localePaths = new Set([
		...files
			.filter((file) => isStorefrontLocale(file.path))
			.map((file) => file.path),
		...Object.keys(existing).filter(isStorefrontLocale),
	]);
	for (const path of localePaths) {
		const sourceFile = output.get(path);
		const targetRaw = existing[path];
		if (!sourceFile) {
			if (targetRaw !== undefined) {
				output.set(path, {
					path,
					contents: targetRaw,
					ownerId: "merchant:locale",
					ownership: "merchant",
				});
			}
			continue;
		}
		const source = parseJson(sourceFile.contents, path, diagnostics);
		const target =
			targetRaw === undefined
				? undefined
				: parseJson(targetRaw, path, diagnostics);
		if (source === undefined) continue;
		nextLocaleBase[path] = source;
		const merged = mergeShopifyLocale(plan.localeBase[path], source, target);
		if (targetRaw !== undefined) mergedLocalePaths.push(path);
		for (const key of merged.conflicts) {
			diagnostics.push({
				severity: "warning",
				phase: "emit",
				code: "SHOPIFY_LOCALE_CONFLICT",
				message: `${path}: "${key}" changed in source and merchant data; kept merchant value`,
			});
		}
		output.set(path, {
			...sourceFile,
			contents: merged.contents,
			ownership: "merchant",
		});
	}
	return {
		files: [...output.values()].sort((left, right) =>
			left.path.localeCompare(right.path),
		),
		diagnostics,
		appliedMigrationIds: unapplied.map((migration) => migration.id),
		migratedPaths: [...migrated.changedPaths],
		mergedLocalePaths: mergedLocalePaths.sort(),
		nextLocaleBase,
	};
}

function parseJson(
	raw: string,
	path: string,
	diagnostics: Diagnostic[],
): ProductKey | undefined {
	try {
		return JSON.parse(raw) as ProductKey;
	} catch (error) {
		diagnostics.push({
			severity: "error",
			phase: "emit",
			code: "SHOPIFY_RECONCILIATION_JSON_INVALID",
			message: `${path}: ${error instanceof Error ? error.message : String(error)}`,
		});
		return undefined;
	}
}

function isMerchantDataPath(path: string): boolean {
	return (
		path === "config/settings_data.json" ||
		/^templates\/.+\.json$/.test(path) ||
		/^sections\/[^/]+\.json$/.test(path)
	);
}

function isStorefrontLocale(path: string): boolean {
	return /^locales\/[^/]+\.json$/.test(path) && !path.endsWith(".schema.json");
}

function isMerchantOwnedPath(path: string): boolean {
	return isMerchantDataPath(path) || isStorefrontLocale(path);
}

function createSchemaLock(
	records: readonly {
		file: ProjectFileId;
		schema: {
			settings: readonly { id: string; type: string }[];
			blocks: readonly { type: string }[];
		};
		classification: { role: string };
		facts: { facts: readonly SourceFact[] };
	}[],
): ShopifySchemaLock {
	const sections: Record<string, ShopifySchemaLockEntry> = {};
	for (const record of records) {
		const path = sectionOutputPath(record);
		if (!path) continue;
		sections[path] = {
			settings: record.schema.settings.map(({ id, type }) => ({ id, type })),
			blocks: record.schema.blocks.map(({ type }) => ({ type })),
		};
	}
	return {
		version: 1,
		sections: Object.fromEntries(
			Object.entries(sections).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	};
}

function sectionOutputPath(record: {
	file: ProjectFileId;
	classification: { role: string };
	facts: { facts: readonly SourceFact[] };
}): string | undefined {
	if (record.classification.role === "section") return record.file.path;
	const component = record.facts.facts.find(
		(fact) =>
			fact.kind === "nazare.component" &&
			isRecord(fact.data) &&
			fact.data.componentKind === "section",
	);
	return component
		? `sections/${componentName(record.file.path)}.liquid`
		: undefined;
}

function diffSchemaLocks(
	prior: ShopifySchemaLock | null,
	next: ShopifySchemaLock,
): ShopifySchemaDrift[] {
	if (!prior) return [];
	const drift: ShopifySchemaDrift[] = [];
	for (const [path, oldEntry] of Object.entries(prior.sections)) {
		const name = componentName(path);
		const nextEntry = next.sections[path];
		if (!nextEntry) {
			drift.push({
				code: "SHOPIFY_SECTION_REMOVED",
				message: `Section "${name}" was removed`,
			});
			continue;
		}
		const nextSettings = new Map(
			nextEntry.settings.map((setting) => [setting.id, setting.type]),
		);
		for (const setting of oldEntry.settings) {
			const nextType = nextSettings.get(setting.id);
			if (nextType === undefined) {
				drift.push({
					code: "SHOPIFY_SETTING_REMOVED",
					message: `Setting "${setting.id}" was removed from "${name}"`,
				});
			} else if (nextType !== setting.type) {
				drift.push({
					code: "SHOPIFY_SETTING_RETYPED",
					message: `Setting "${setting.id}" in "${name}" changed type ${setting.type} → ${nextType}`,
				});
			}
		}
		const nextBlocks = new Set(nextEntry.blocks.map((block) => block.type));
		for (const block of oldEntry.blocks) {
			if (!nextBlocks.has(block.type)) {
				drift.push({
					code: "SHOPIFY_BLOCK_REMOVED",
					message: `Block type "${block.type}" was removed from "${name}"`,
				});
			}
		}
	}
	return drift;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function componentName(path: string): string {
	return (path.split("/").at(-1) ?? path).replace(/\.nz\.liquid$/, "");
}

function compareFiles(left: ProjectFileId, right: ProjectFileId): number {
	return serializeProjectFileId(left).localeCompare(
		serializeProjectFileId(right),
	);
}
