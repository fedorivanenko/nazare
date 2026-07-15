import { readFileSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import {
	basename,
	dirname,
	extname,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type {
	EmittedFile,
	NazareComponent,
	NazareExtensionRegistration,
} from "@nazare/compiler";
import {
	buildNazareTheme,
	checkComponentScripts,
	parseNazareLiquid,
	themeSchemaFromIR,
} from "@nazare/compiler";
import type { Diagnostic } from "@nazare/core";
import { mergeLocale } from "./locales.js";
import {
	applyMigrationsToData,
	applyMigrationsToManifest,
	type Migration,
	parseMigrations,
} from "./migrations.js";
import {
	checkOutputOwnership,
	OUTPUT_OWNERSHIP_MANIFEST,
	type OutputOwnershipManifest,
	readOutputFileHashes,
	readOutputOwnershipManifest,
	sha256,
	writeOutputOwnershipManifest,
} from "./ownership.js";
import {
	type DriftEntry,
	diffSchemaManifests,
	readSchemaManifest,
	type SchemaManifest,
	sortSchemaManifest,
} from "./schema-lock.js";

// Committed alongside the source: a fingerprint of every generated section's
// schema (setting ids/types, accepted block types). Diffing it across builds
// surfaces schema drift that would break saved merchant data.
const DEFAULT_MANIFEST = "nazare.schema-lock.json";
// Committed alongside the source: an append-only list of rename/remove ops that
// rewrite saved merchant data so it survives schema renames.
const DEFAULT_MIGRATIONS = "nazare.migrations.json";
// Committed alongside the source: which migration ids have been applied to each
// target theme, so each migration runs exactly once per target.
const DEFAULT_MIGRATIONS_LEDGER = "nazare.migrations-applied.json";
// Committed alongside the source: the source locale strings as of the last
// build, the common ancestor for the 3-way locale merge.
const DEFAULT_LOCALE_BASE = "nazare.locales-base.json";
const THEME_DIRS = new Set([
	"layout",
	"templates",
	"sections",
	"snippets",
	"assets",
	"config",
	"locales",
]);

export type ThemeBuildOptions = {
	projectRoot: string;
	/** Source root, relative to projectRoot. Required — no default. */
	sourceRoot: string;
	/** Build output directory, relative to projectRoot. Required — no default. */
	outDir: string;
	strictness?: "loose" | "strict";
	/** Schema-lock path, relative to projectRoot. Default nazare.schema-lock.json. */
	manifestPath?: string;
	/** Migrations file path, relative to projectRoot. Default nazare.migrations.json. */
	migrationsPath?: string;
	/** Applied-migrations ledger path, relative to projectRoot. Default nazare.migrations-applied.json. */
	migrationsLedgerPath?: string;
	/** Identity of the target theme for the migrations ledger. Default is the output dir. */
	targetId?: string;
	/** Locale merge base path, relative to projectRoot. Default nazare.locales-base.json. */
	localeBasePath?: string;
	/** Project extension modules loaded by the CLI or caller. */
	extensions?: NazareExtensionRegistration[];
};

/** A single schema-drift finding between the prior and current schema lock. */
export type { DriftEntry };

export type ThemeBuildResult = {
	compiled: string[];
	copied: string[];
	seeded: string[];
	preserved: string[];
	written: string[];
	issues: Diagnostic[];
	notes: Diagnostic[];
	conflicts: string[];
	/** Breaking schema changes vs the committed schema lock. */
	drift: DriftEntry[];
	/** Path (relative to projectRoot) the schema lock was written to. */
	manifestPath: string;
	/** Merchant-data files rewritten by migrations. */
	migrated: string[];
	/** Migration ids applied this build (empty when all were already applied). */
	applied: string[];
	/** Storefront locale files reconciled by the 3-way merge. */
	mergedLocales: string[];
};

type PlannedFile = { contents: string; from: string };

export async function buildTheme(
	options: ThemeBuildOptions,
): Promise<ThemeBuildResult> {
	const projectRoot = requireStringOption(options.projectRoot, "projectRoot");
	const sourceRoot = requireStringOption(options.sourceRoot, "sourceRoot");
	const outDir = requireStringOption(options.outDir, "outDir");
	assertSafeOutDir(projectRoot, sourceRoot, outDir);
	const rootAbs = resolve(projectRoot, sourceRoot);
	const rootStat = await stat(rootAbs).catch(() => undefined);
	if (!rootStat) throw new Error(`Source path not found: ${sourceRoot}`);

	const sourceFiles = rootStat.isFile()
		? [toRootRelativePosix(projectRoot, rootAbs)]
		: await collectSourceFiles(projectRoot, sourceRoot);

	const readProjectFile = (path: string): string | undefined => {
		try {
			return readFileSync(join(projectRoot, path), "utf8");
		} catch {
			return undefined;
		}
	};

	const planned = new Map<string, PlannedFile>();
	// Merchant-owned data files (settings values, section instances, block
	// values) discovered in the source tree. These are only seeds: they populate
	// the output when the target has no value yet, but an existing target's copy
	// wins so a rebuild never resets live theme state edited in the Shopify admin.
	const seeds = new Map<string, PlannedFile>();
	// Storefront locale files from source. These are the developer's translations,
	// merged field-by-field with the merchant's edits rather than copied over.
	const sourceLocales = new Map<string, PlannedFile>();
	const conflicts: string[] = [];
	const issues: Diagnostic[] = [];
	const notes: Diagnostic[] = [];
	const compiled: string[] = [];
	const components: NazareComponent[] = [];
	const copied: string[] = [];
	const manifest: SchemaManifest = { version: 1, sections: {} };

	for (const file of sourceFiles) {
		const sourceRelative = relativeSourcePath(sourceRoot, file);
		const contents = await readFile(join(projectRoot, file), "utf8");

		if (file.endsWith(".nz.liquid")) {
			compiled.push(file);
			const built = buildNazareTheme(contents, file, {
				name: artifactBaseName(file),
				readFile: readProjectFile,
				strictness: options.strictness,
			});
			components.push({
				file,
				source: contents,
				schema: built.ast.schema,
				ir: built.ir,
				contract: built.contract,
				importedContracts: built.contracts,
				canEmit: built.canEmit,
			});
			issues.push(
				...built.issues,
				...checkComponentScripts(built.ir, { readFile: readProjectFile }),
			);
			notes.push(...built.notes);
			for (const themeFile of built.emitted.files) {
				planFile(planned, conflicts, themeFile.path, themeFile.contents, file);
			}
			// Fingerprint the generated schema for sections and blocks (the only
			// kinds that carry one) so drift against saved merchant data is visible.
			const schemaBearing = built.emitted.files.find(
				(themeFile) =>
					(themeFile.path.startsWith("sections/") ||
						themeFile.path.startsWith("blocks/")) &&
					themeFile.path.endsWith(".liquid"),
			);
			if (schemaBearing) {
				const schema = themeSchemaFromIR(built.ir, {
					name: artifactBaseName(file),
					contracts: built.contracts,
				});
				manifest.sections[schemaBearing.path] = {
					settings: schema.settings
						.filter(
							(setting): setting is typeof setting & { id: string } =>
								typeof setting.id === "string",
						)
						.map((setting) => ({ id: setting.id, type: setting.type })),
					blocks: (schema.blocks ?? []).map((block) => ({ type: block.type })),
				};
			}
			continue;
		}

		if (isPlainLiquidThemeFile(sourceRelative)) {
			const parsed = parseNazareLiquid(contents, file);
			issues.push(
				...parsed.diagnostics.map((issue) => ({
					...issue,
					phase: "parse" as const,
				})),
			);
			notes.push(
				...parsed.notes.map((note) => ({ ...note, phase: "parse" as const })),
			);
		}

		if (file.endsWith(".json")) {
			const invalid = validateJson(contents, file);
			if (invalid) issues.push(invalid);
		}

		const outputPath = outputPathForSource(sourceRelative);
		if (outputPath) {
			if (isMerchantDataPath(outputPath)) {
				seeds.set(outputPath, { contents, from: file });
			} else if (isLocaleMergePath(outputPath)) {
				sourceLocales.set(outputPath, { contents, from: file });
			} else {
				copied.push(file);
				planFile(planned, conflicts, outputPath, contents, file);
			}
		}
	}

	for (const extensionResult of await runExtensions(options.extensions ?? [], {
		projectRoot,
		sourceRoot,
		outDir,
		components,
	})) {
		issues.push(...extensionResult.issues);
		for (const file of extensionResult.files) {
			const pathIssue = validateExtensionOutputPath(
				file.path,
				extensionResult.name,
			);
			if (pathIssue) {
				issues.push(pathIssue);
				continue;
			}
			planFile(
				planned,
				conflicts,
				file.path,
				file.contents,
				`extension:${extensionResult.name}`,
			);
		}
	}

	const outputRoot = resolve(projectRoot, outDir);
	const ownershipManifest = await readOutputOwnershipManifest(outputRoot);
	const existingOutputFiles = await readOutputFileHashes(outputRoot);

	// Snapshot merchant-owned data + storefront locales already in the target
	// before clearing it, so the rebuild carries live theme state forward.
	let existingData = await readExistingData(outputRoot);
	const existingLocales = await readExistingLocales(outputRoot);

	// Author-written migrations rewrite that data so saved values survive a
	// section/setting rename. The same migrations are applied to the prior schema
	// lock below, so a migrated rename stops registering as drift.
	const migrationsPath = options.migrationsPath ?? DEFAULT_MIGRATIONS;
	const migrationsRaw = await readFile(
		join(projectRoot, migrationsPath),
		"utf8",
	).catch(() => undefined);
	let migrations: Migration[] = [];
	if (migrationsRaw !== undefined) {
		const parsed = parseMigrations(migrationsRaw, migrationsPath);
		issues.push(...parsed.issues);
		// Refuse to apply a partially-invalid migration set — all or nothing.
		if (!parsed.issues.some((issue) => issue.severity === "error")) {
			migrations = parsed.migrations;
		}
	}

	// Run-once ledger: skip migrations already applied to THIS target theme, so a
	// stale rename never re-fires on a later setting that reuses an old name. The
	// ledger is keyed per target (a store/theme pulls its own history); data
	// application uses only the unapplied set, while drift silencing below still
	// applies the full list (idempotent on the schema lock).
	const ledgerPath = options.migrationsLedgerPath ?? DEFAULT_MIGRATIONS_LEDGER;
	const targetId = options.targetId ?? outDir;
	const ledger = await readLedger(join(projectRoot, ledgerPath));
	const alreadyApplied = new Set(ledger.applied[targetId] ?? []);
	const unapplied = migrations.filter((m) => !alreadyApplied.has(m.id));

	const migratedData = applyMigrationsToData(existingData, unapplied);
	existingData = migratedData.data;
	issues.push(...migratedData.issues);
	const migrated = migratedData.changed;
	const applied = unapplied.map((m) => m.id);

	const seeded: string[] = [];
	const preserved: string[] = [];
	for (const path of new Set([...existingData.keys(), ...seeds.keys()])) {
		const live = existingData.get(path);
		if (live !== undefined) {
			planned.set(path, { contents: live, from: "<target>" });
			preserved.push(path);
			if (seeds.has(path)) {
				notes.push({
					severity: "info",
					phase: "emit",
					code: "THEME_DATA_PRESERVED",
					message: `${path}: kept the target's data; source is only a seed once the theme exists`,
				});
			}
			continue;
		}
		const seed = seeds.get(path);
		if (seed) {
			planned.set(path, seed);
			seeded.push(path);
		}
	}

	// 3-way merge storefront locales: developer source, merchant edits pulled into
	// the target, and the committed base (last build's source) as ancestor. The
	// base is then rewritten to the current source for next time.
	const localeBasePath = options.localeBasePath ?? DEFAULT_LOCALE_BASE;
	const localeBase = await readLocaleBase(join(projectRoot, localeBasePath));
	const nextLocaleBase: Record<string, unknown> = {};
	const mergedLocales: string[] = [];
	for (const path of new Set([
		...sourceLocales.keys(),
		...existingLocales.keys(),
	])) {
		const source = parseLocale(sourceLocales.get(path)?.contents, path, issues);
		const target = parseLocale(existingLocales.get(path), path, issues);

		// A locale only the merchant has (added in the admin) is preserved as-is
		// and not tracked as a base — it is not the developer's to own.
		if (source === undefined) {
			if (existingLocales.has(path)) {
				planned.set(path, {
					contents: existingLocales.get(path) ?? "",
					from: "<target>",
				});
			}
			continue;
		}

		const { value, conflicts: localeConflicts } = mergeLocale(
			localeBase[path],
			source,
			target,
		);
		nextLocaleBase[path] = source;
		if (existingLocales.has(path)) mergedLocales.push(path);
		for (const key of localeConflicts) {
			issues.push({
				severity: "warning",
				phase: "emit",
				code: "THEME_LOCALE_CONFLICT",
				message: `${path}: "${key}" changed in both source and target; kept the target's value`,
			});
		}
		planned.set(path, {
			contents: `${JSON.stringify(value, null, 2)}\n`,
			from: sourceLocales.get(path)?.from ?? path,
		});
	}

	const ownership = checkOutputOwnership(
		planned,
		existingOutputFiles,
		ownershipManifest,
		isGeneratedOwnedPath,
	);
	conflicts.push(...ownership.conflicts);
	if (conflicts.length > 0) {
		return {
			compiled: compiled.sort(),
			copied: copied.sort(),
			seeded: seeded.sort(),
			preserved: preserved.sort(),
			written: [],
			issues,
			notes,
			conflicts,
			drift: [],
			manifestPath: options.manifestPath ?? DEFAULT_MANIFEST,
			migrated: migrated.sort(),
			applied: [],
			mergedLocales: mergedLocales.sort(),
		};
	}

	for (const path of ownership.staleOwned) {
		await rm(join(outputRoot, path), { force: true });
	}

	const written: string[] = [];
	const nextOwnership: OutputOwnershipManifest = { version: 1, files: {} };
	for (const path of [...planned.keys()].sort()) {
		const full = join(outputRoot, path);
		const contents = planned.get(path)?.contents ?? "";
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, contents);
		written.push(join(outDir, path));
		if (isGeneratedOwnedPath(path)) {
			nextOwnership.files[path] = {
				hash: sha256(contents),
				source: planned.get(path)?.from ?? "<unknown>",
			};
		}
	}
	await writeOutputOwnershipManifest(outputRoot, nextOwnership);

	// Diff the current schema against the committed lock, warn on breaking drift,
	// then rewrite the lock as the new baseline. Warnings do not fail the build.
	const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST;
	const prior = await readSchemaManifest(join(projectRoot, manifestPath));
	const migratedPrior = prior
		? applyMigrationsToManifest(prior, migrations)
		: undefined;
	const drift = diffSchemaManifests(migratedPrior, manifest);
	for (const entry of drift) {
		issues.push({
			severity: "warning",
			phase: "emit",
			code: entry.code,
			message: entry.message,
		});
	}
	await writeFile(
		join(projectRoot, manifestPath),
		`${JSON.stringify(sortSchemaManifest(manifest), null, 2)}\n`,
	);

	// Record the migrations applied this build so they never re-run on this
	// target. Recorded regardless of whether they changed data — the rename is a
	// one-time schema event. Only written when migrations are defined.
	if (migrations.length > 0 && applied.length > 0) {
		ledger.applied[targetId] = [...alreadyApplied, ...applied];
		await writeFile(
			join(projectRoot, ledgerPath),
			`${JSON.stringify(ledger, null, 2)}\n`,
		);
	}

	// Advance the locale merge base to the current source for the next build.
	if (sourceLocales.size > 0) {
		await writeFile(
			join(projectRoot, localeBasePath),
			`${JSON.stringify({ version: 1, files: nextLocaleBase }, null, 2)}\n`,
		);
	}

	return {
		compiled: compiled.sort(),
		copied: copied.sort(),
		seeded: seeded.sort(),
		preserved: preserved.sort(),
		written,
		issues,
		notes,
		conflicts,
		drift,
		manifestPath,
		migrated: migrated.sort(),
		applied,
		mergedLocales: mergedLocales.sort(),
	};
}

// Storefront locale files the merchant can edit in the admin. Schema locales
// (*.schema.json) are editor labels the developer owns, so they stay code.
function isLocaleMergePath(path: string): boolean {
	return (
		path.startsWith("locales/") &&
		path.endsWith(".json") &&
		!path.endsWith(".schema.json")
	);
}

async function readExistingLocales(
	outputRoot: string,
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const dir = join(outputRoot, "locales");
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const dirent of entries) {
		const rel = `locales/${dirent.name}`;
		if (dirent.isFile() && isLocaleMergePath(rel)) {
			found.set(rel, await readFile(join(dir, dirent.name), "utf8"));
		}
	}
	return found;
}

// The committed merge base maps each locale path to its source tree from the
// last build. A missing or malformed base yields an empty ancestor set, which
// the merge treats as a safe 2-way (merchant-preserving) merge.
async function readLocaleBase(path: string): Promise<Record<string, unknown>> {
	const raw = await readFile(path, "utf8").catch(() => undefined);
	if (raw !== undefined) {
		try {
			const parsed = JSON.parse(raw) as { files?: Record<string, unknown> };
			if (parsed.files && typeof parsed.files === "object") return parsed.files;
		} catch {
			// fall through to an empty base
		}
	}
	return {};
}

function parseLocale(
	raw: string | undefined,
	path: string,
	issues: Diagnostic[],
): unknown {
	if (raw === undefined) return undefined;
	try {
		return JSON.parse(raw);
	} catch {
		issues.push({
			severity: "warning",
			phase: "emit",
			code: "THEME_LOCALE_INVALID_JSON",
			message: `${path}: not valid JSON, left unmerged`,
		});
		return undefined;
	}
}

type MigrationLedger = { version: 1; applied: Record<string, string[]> };

// A missing or malformed ledger is treated as "nothing applied yet".
async function readLedger(path: string): Promise<MigrationLedger> {
	const raw = await readFile(path, "utf8").catch(() => undefined);
	if (raw !== undefined) {
		try {
			const parsed = JSON.parse(raw) as Partial<MigrationLedger>;
			if (parsed.applied && typeof parsed.applied === "object") {
				return { version: 1, applied: parsed.applied };
			}
		} catch {
			// fall through to a fresh ledger
		}
	}
	return { version: 1, applied: {} };
}

// Files the Shopify theme editor writes back on the merchant's behalf: setting
// values, section instances and their order, block values, and section groups.
// These belong to the live theme, not the source repo — the compiler never
// emits them, so preserving them across a rebuild is safe.
function isMerchantDataPath(path: string): boolean {
	if (path === "config/settings_data.json") return true;
	if (path.startsWith("templates/") && path.endsWith(".json")) return true;
	// Section groups live at the top level of sections/ (e.g. header-group.json);
	// nested paths under sections/ are not a Shopify concept, so require a flat name.
	if (
		path.startsWith("sections/") &&
		path.endsWith(".json") &&
		!path.slice("sections/".length).includes("/")
	) {
		return true;
	}
	return false;
}

// Reads the merchant-owned data files already present in the output directory.
// Returns an empty map when the directory does not exist (a first build).
async function readExistingData(
	outputRoot: string,
): Promise<Map<string, string>> {
	const found = new Map<string, string>();
	const walk = async (dir: string, base: string): Promise<void> => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const dirent of entries) {
			const full = join(dir, dirent.name);
			const rel = base ? `${base}/${dirent.name}` : dirent.name;
			if (dirent.isDirectory()) {
				await walk(full, rel);
			} else if (dirent.isFile() && isMerchantDataPath(rel)) {
				found.set(rel, await readFile(full, "utf8"));
			}
		}
	};
	await walk(outputRoot, "");
	return found;
}

async function collectSourceFiles(
	projectRoot: string,
	sourceRoot: string,
): Promise<string[]> {
	const rootAbs = resolve(projectRoot, sourceRoot);
	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		for (const dirent of await readdir(dir, { withFileTypes: true })) {
			const full = join(dir, dirent.name);
			if (dirent.isDirectory()) {
				await walk(full);
			} else if (dirent.isFile()) {
				found.push(toRootRelativePosix(projectRoot, full));
			}
		}
	};
	await walk(rootAbs);
	return found.sort();
}

function requireStringOption(value: unknown, name: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${name} must be a non-empty string`);
	}
	return value;
}

function assertSafeOutDir(
	projectRoot: string,
	sourceRoot: string,
	outDir: string,
): void {
	if (outDir.trim().length === 0) {
		throw new Error("outDir must not be empty");
	}

	const projectAbs = resolve(projectRoot);
	const sourceAbs = resolve(projectRoot, sourceRoot);
	const outputAbs = resolve(projectRoot, outDir);

	if (!isInsideOrEqual(outputAbs, projectAbs)) {
		throw new Error(
			`Refusing to delete output directory outside project root: ${outDir}`,
		);
	}
	if (outputAbs === projectAbs) {
		throw new Error("Refusing to use project root as output directory");
	}
	if (isInsideOrEqual(outputAbs, sourceAbs)) {
		throw new Error(
			`Refusing to use source directory as output directory: ${outDir}`,
		);
	}
	if (isInsideOrEqual(sourceAbs, outputAbs)) {
		throw new Error(
			`Refusing to use output directory that contains source directory: ${outDir}`,
		);
	}
}

function isInsideOrEqual(child: string, parent: string): boolean {
	const relativePath = relative(parent, child);
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !relativePath.startsWith(sep))
	);
}

function isGeneratedOwnedPath(path: string): boolean {
	return (
		path !== OUTPUT_OWNERSHIP_MANIFEST &&
		!isMerchantDataPath(path) &&
		!isLocaleMergePath(path)
	);
}

function outputPathForSource(sourceRelative: string): string | undefined {
	const [top] = sourceRelative.split("/");
	if (!top) return undefined;
	if (THEME_DIRS.has(top)) return sourceRelative;
	return undefined;
}

function isPlainLiquidThemeFile(sourceRelative: string): boolean {
	return (
		sourceRelative.endsWith(".liquid") && !sourceRelative.endsWith(".nz.liquid")
	);
}

function relativeSourcePath(sourceRoot: string, file: string): string {
	const prefix = `${sourceRoot.replace(/\/$/, "")}/`;
	return file.startsWith(prefix) ? file.slice(prefix.length) : basename(file);
}

async function runExtensions(
	extensions: NazareExtensionRegistration[],
	context: {
		projectRoot: string;
		sourceRoot: string;
		outDir: string;
		components: NazareComponent[];
	},
): Promise<
	Array<{ name: string; files: EmittedFile[]; issues: Diagnostic[] }>
> {
	const results: Array<{
		name: string;
		files: EmittedFile[];
		issues: Diagnostic[];
	}> = [];
	for (const registration of extensions) {
		const extensionName = extensionNameFromRegistration(registration);
		try {
			validateExtensionRegistration(registration);
			const { extension, options } = registration;
			if (!extension.emit) continue;
			const emitted = await extension.emit({ ...context, options });
			if (
				!emitted ||
				typeof emitted !== "object" ||
				!Array.isArray(emitted.files) ||
				!Array.isArray(emitted.issues)
			) {
				throw new Error("emit must return { files, issues } arrays");
			}
			// Validate each entry's shape here, inside the try, so a malformed one
			// becomes a THEME_EXTENSION_ERROR instead of crashing a downstream path
			// check or slipping a bogus diagnostic into the build result.
			for (const file of emitted.files) {
				if (
					!file ||
					typeof file !== "object" ||
					typeof file.path !== "string" ||
					typeof file.contents !== "string"
				) {
					throw new Error(
						"emit files must each be { path: string, contents: string }",
					);
				}
			}
			for (const issue of emitted.issues) {
				if (
					!issue ||
					typeof issue !== "object" ||
					!isDiagnosticSeverity(issue.severity) ||
					typeof issue.code !== "string" ||
					typeof issue.message !== "string" ||
					(issue.phase !== undefined && !isDiagnosticPhase(issue.phase))
				) {
					throw new Error(
						"emit issues must each be a diagnostic with severity, code, and message",
					);
				}
			}
			results.push({
				name: extension.name,
				files: emitted.files,
				issues: emitted.issues.map((issue) => ({
					...issue,
					phase: issue.phase ?? "emit",
				})),
			});
		} catch (error) {
			results.push({
				name: extensionName,
				files: [],
				issues: [
					{
						severity: "error",
						phase: "emit",
						code: "THEME_EXTENSION_ERROR",
						message: `Extension ${extensionName} failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			});
		}
	}
	return results;
}

function extensionNameFromRegistration(registration: unknown): string {
	if (
		registration &&
		typeof registration === "object" &&
		"extension" in registration
	) {
		const extension = registration.extension;
		if (
			extension &&
			typeof extension === "object" &&
			"name" in extension &&
			typeof extension.name === "string" &&
			extension.name.length > 0
		) {
			return extension.name;
		}
	}
	return "<invalid>";
}

function validateExtensionRegistration(
	registration: unknown,
): asserts registration is NazareExtensionRegistration {
	if (
		!registration ||
		typeof registration !== "object" ||
		!("extension" in registration)
	) {
		throw new Error("extension registration must include an extension object");
	}
	const extension = registration.extension;
	if (!extension || typeof extension !== "object") {
		throw new Error("extension registration must include an extension object");
	}
	if (
		!("name" in extension) ||
		typeof extension.name !== "string" ||
		extension.name.length === 0
	) {
		throw new Error("extension needs a non-empty name");
	}
	if (
		"emit" in extension &&
		extension.emit !== undefined &&
		typeof extension.emit !== "function"
	) {
		throw new Error("extension emit must be a function");
	}
}

function isDiagnosticSeverity(value: unknown): value is Diagnostic["severity"] {
	return value === "error" || value === "warning" || value === "info";
}

function isDiagnosticPhase(
	value: unknown,
): value is NonNullable<Diagnostic["phase"]> {
	return (
		value === "parse" ||
		value === "resolve" ||
		value === "check" ||
		value === "validate" ||
		value === "emit"
	);
}

// A relative theme path an extension may not write: traversal/absolute/unsafe,
// or a reserved path the build owns (ownership manifest, merchant data,
// mergeable locales). Single source of truth for both checks so they can't drift.
function isUnsafeThemeOutputPath(path: string): boolean {
	if (
		path.trim().length === 0 ||
		path.startsWith("/") ||
		path.includes("\\") ||
		path.split("/").some((segment) => segment === ".." || segment === "")
	) {
		return true;
	}
	return (
		path === OUTPUT_OWNERSHIP_MANIFEST ||
		isMerchantDataPath(path) ||
		isLocaleMergePath(path)
	);
}

function validateExtensionOutputPath(
	path: string,
	extensionName: string,
): Diagnostic | undefined {
	if (!isUnsafeThemeOutputPath(path)) return undefined;
	return {
		severity: "error",
		phase: "emit",
		code: "THEME_EXTENSION_OUTPUT_PATH",
		message: `Extension ${extensionName} emitted unsafe output path "${path}"`,
	};
}

function planFile(
	planned: Map<string, PlannedFile>,
	conflicts: string[],
	path: string,
	contents: string,
	from: string,
): void {
	const existing = planned.get(path);
	if (existing && existing.contents !== contents) {
		conflicts.push(`${path}: emitted by both ${existing.from} and ${from}`);
		return;
	}
	planned.set(path, { contents, from });
}

function validateJson(contents: string, file: string): Diagnostic | undefined {
	try {
		JSON.parse(contents);
		return undefined;
	} catch (error) {
		return {
			severity: "error",
			phase: "parse",
			code: "THEME_INVALID_JSON",
			message: `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function toRootRelativePosix(projectRoot: string, abs: string): string {
	const rel = relative(projectRoot, abs).split(sep).join("/");
	if (rel.startsWith("..")) {
		throw new Error(`${abs} is outside the project root ${projectRoot}`);
	}
	return rel;
}

function artifactBaseName(entryFile: string): string {
	let name = basename(entryFile);
	while (extname(name)) name = basename(name, extname(name));
	return name;
}
