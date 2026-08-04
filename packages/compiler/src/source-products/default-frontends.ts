import type { Diagnostic } from "@nazare/core";
import {
	createDefaultSourceParserRegistry,
	type LiquidSyntaxFacts,
	liquidSyntaxFacts,
	nazareSyntaxFacts,
	parseSourceDocument,
	type SourceDocument,
	type SourceParseIssue,
} from "@nazare/source";
import { fingerprintProductKey } from "../computation/canonical-key.js";
import { analyzeThemeCss } from "../frontends/theme-css.js";
import { analyzeThemeScript } from "../frontends/theme-script.js";
import type { ThemeFact } from "../theme-facts.js";
import {
	type ClassifiedSourceFile,
	createSourceFrontendRegistry,
	defineSourceFrontend,
	type ParsedSourceFile,
	type SourceFact,
	type SourceFacts,
	type SourceFrontend,
	type SourceFrontendRegistry,
} from "./frontend.js";

const sourceParserRegistry = createDefaultSourceParserRegistry();

export const nazareLiquidSourceFrontend = sourceDocumentFrontend({
	id: "nazare.source.nazare-liquid",
	version: 3,
	language: "nazare-liquid",
	accepts: (path) => path.endsWith(".nz.liquid"),
	extract(document, file) {
		const syntax = nazareSyntaxFacts(document);
		const facts = syntax.facts.map((fact) =>
			fact.kind === "import"
				? sourceFact(file, "dependency", {
						path: fact.specifier,
						relative: true,
						kind: "nazare-import",
						localName: fact.localName,
						range: fact.range,
					})
				: sourceFact(file, `nazare.${fact.kind}`, fact),
		);
		facts.push(...liquidNeutralFacts(syntax.liquid, file));
		return { facts, diagnostics: [], uncertainty: [] };
	},
});

export const liquidSourceFrontend = sourceDocumentFrontend({
	id: "nazare.source.liquid",
	version: 2,
	language: "liquid",
	accepts: (path) => path.endsWith(".liquid") && !path.endsWith(".nz.liquid"),
	extract(document, file) {
		const syntax = liquidSyntaxFacts(document);
		return {
			facts: liquidNeutralFacts(syntax, file),
			diagnostics: [],
			uncertainty: syntax.authoritative
				? []
				: [
						{
							code: "LIQUID_SYNTAX_NOT_AUTHORITATIVE",
							message: `Liquid syntax facts are incomplete for ${file.id.path}`,
						},
					],
		};
	},
});

export const jsonSourceFrontend = defineSourceFrontend({
	id: "nazare.source.json",
	version: 1,
	language: "json",
	accepts: (file) => file.id.path.endsWith(".json"),
	async parse(file) {
		try {
			return parsed(file, JSON.parse(file.contents), []);
		} catch (error) {
			return parsed(file, undefined, [
				{
					severity: "error",
					code: "JSON_PARSE_ERROR",
					message: `Invalid JSON in ${file.id.path}: ${errorMessage(error)}`,
					phase: "parse",
				},
			]);
		}
	},
	async extractFacts(parsedFile) {
		return emptyFacts(parsedFile.file);
	},
});

export const cssSourceFrontend = analyzedThemeFrontend({
	id: "nazare.source.css",
	language: "css",
	accepts: (path) => path.endsWith(".css"),
	analyze: analyzeThemeCss,
});

export const javaScriptSourceFrontend = analyzedThemeFrontend({
	id: "nazare.source.javascript",
	language: "javascript",
	accepts: (path) => /\.(?:js|mjs|cjs)$/.test(path),
	analyze: analyzeThemeScript,
});

export const assetSourceFrontend = defineSourceFrontend({
	id: "nazare.source.asset",
	version: 1,
	language: "asset",
	accepts: (file) =>
		/\.(?:avif|bmp|gif|ico|jpe?g|pdf|png|svg|ttf|webp|woff2?)$/i.test(
			file.id.path,
		),
	async parse(file) {
		return parsed(file, null, []);
	},
	async extractFacts(parsedFile) {
		return emptyFacts(parsedFile.file);
	},
});

export const opaqueSourceFrontend = defineSourceFrontend({
	id: "nazare.source.opaque",
	version: 1,
	language: "opaque",
	fallback: true,
	accepts: () => true,
	async parse(file) {
		return parsed(file, null, []);
	},
	async extractFacts(parsedFile) {
		return emptyFacts(parsedFile.file);
	},
});

export const DEFAULT_SOURCE_FRONTENDS: readonly SourceFrontend[] = [
	nazareLiquidSourceFrontend,
	liquidSourceFrontend,
	jsonSourceFrontend,
	cssSourceFrontend,
	javaScriptSourceFrontend,
	assetSourceFrontend,
	opaqueSourceFrontend,
];

export function createDefaultSourceFrontendRegistry(): SourceFrontendRegistry {
	return createSourceFrontendRegistry(DEFAULT_SOURCE_FRONTENDS);
}

function sourceDocumentFrontend(input: {
	id: string;
	version?: number;
	language: "liquid" | "nazare-liquid";
	accepts(path: string): boolean;
	extract(
		document: SourceDocument,
		file: ClassifiedSourceFile,
	): Omit<SourceFacts, "file">;
}): SourceFrontend {
	return defineSourceFrontend({
		id: input.id,
		version: input.version ?? 1,
		language: input.language,
		accepts: (file) => input.accepts(file.id.path),
		async parse(file) {
			const document = parseSourceDocument(
				sourceParserRegistry,
				file.id.path,
				input.language,
				file.contents,
			);
			return parsed(
				file,
				document,
				document.issues.map((issue) => sourceParseDiagnostic(file, issue)),
			);
		},
		async extractFacts(parsedFile) {
			const extracted = input.extract(
				parsedFile.syntax.value as SourceDocument,
				parsedFile.file,
			);
			return { file: parsedFile.file.id, ...extracted };
		},
	});
}

function analyzedThemeFrontend(input: {
	id: string;
	language: string;
	accepts(path: string): boolean;
	analyze(
		path: string,
		source: string,
	): {
		facts: ThemeFact[];
		issues: Diagnostic[];
		uncertainty: Array<{ code: string; message: string }>;
	};
}): SourceFrontend {
	return defineSourceFrontend({
		id: input.id,
		version: 1,
		language: input.language,
		accepts: (file) => input.accepts(file.id.path),
		async parse(file) {
			const analysis = input.analyze(file.id.path, file.contents);
			return {
				...parsed(file, analysis, analysis.issues),
				uncertainty: analysis.uncertainty,
			};
		},
		async extractFacts(parsedFile) {
			const analysis = parsedFile.syntax.value as ReturnType<
				typeof input.analyze
			>;
			return {
				file: parsedFile.file.id,
				facts: analysis.facts.map((fact) =>
					fact.kind === "referencesAsset" && fact.targetName
						? sourceFact(parsedFile.file, "dependency", {
								path: fact.targetName,
								relative: false,
								kind: "javascript-import",
							})
						: sourceFact(parsedFile.file, `source.${fact.kind}`, fact),
				),
				diagnostics: [],
				uncertainty: [],
			};
		},
	});
}

function liquidNeutralFacts(
	syntax: LiquidSyntaxFacts,
	file: ClassifiedSourceFile,
): SourceFact[] {
	return [
		...syntax.dependencies.map((dependency) =>
			sourceFact(file, "liquid.reference", dependency),
		),
		...syntax.settingsReads.map((read) =>
			sourceFact(file, "liquid.settings-read", read),
		),
		...syntax.assetReferences.map((reference) =>
			sourceFact(file, "liquid.asset-reference", reference),
		),
		...syntax.localeReferences.map((reference) =>
			sourceFact(file, "liquid.locale-reference", reference),
		),
		...syntax.renderArguments.map((argument) =>
			sourceFact(file, "liquid.render-argument", argument),
		),
		...syntax.reads.map((read) => sourceFact(file, "liquid.read", read)),
		...(syntax.schema
			? [sourceFact(file, "liquid.schema", syntax.schema)]
			: []),
	];
}

function parsed(
	file: ClassifiedSourceFile,
	value: unknown,
	diagnostics: readonly Diagnostic[],
): ParsedSourceFile {
	return { file, syntax: { value }, diagnostics, uncertainty: [] };
}

function emptyFacts(file: ClassifiedSourceFile): SourceFacts {
	return { file: file.id, facts: [], diagnostics: [], uncertainty: [] };
}

function sourceFact(
	file: ClassifiedSourceFile,
	kind: string,
	data: unknown,
): SourceFact {
	const encoded = JSON.parse(JSON.stringify(data));
	return {
		id: `source-fact:${fingerprintProductKey({ file: file.id, kind, data: encoded })}`,
		kind,
		file: file.id,
		data: encoded,
	};
}

function sourceParseDiagnostic(
	file: ClassifiedSourceFile,
	issue: SourceParseIssue,
): Diagnostic {
	return {
		severity: "error",
		code: issue.code,
		message: issue.message,
		phase: "parse",
		span: {
			file: file.id.path,
			start: offsetPosition(file.contents, issue.range.start),
			end: offsetPosition(file.contents, issue.range.end),
		},
	};
}

function offsetPosition(source: string, offset: number) {
	const before = source.slice(0, offset);
	const lines = before.split("\n");
	return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
