import {
	createDefaultSourceParserRegistry,
	htmlSyntaxIssues,
	liquidSyntaxFacts,
	parseSourceDocument,
} from "@nazare/source";
import { checkVanillaSchema } from "../check-vanilla.js";
import type { CompileInput, CompilerFrontend } from "../frontend.js";
import { fileSyntaxId } from "../ids.js";
import { markDiagnostics } from "../pipeline.js";
import {
	dependencyPath,
	invalidDependencyName,
	plainLiquidFactsSkipped,
	validateDependencyName,
} from "../plain-liquid.js";
import { rangeOfTextWithinRange, spanFromOffsets } from "../source.js";
import {
	PLAIN_LIQUID_SUPPORT,
	type PlainLiquidFrontendMetadata,
	resolvePlainLiquidOptions,
} from "./plain-liquid.js";

/** Canonical plain-Liquid frontend backed by Tree-sitter facts. */
export const treeSitterPlainLiquidFrontend: CompilerFrontend = {
	name: "tree-sitter-plain-liquid",
	accepts(file: string): boolean {
		return file.endsWith(".liquid") && !file.endsWith(".nz.liquid");
	},
	compile(input: CompileInput) {
		const optionResolution = resolvePlainLiquidOptions(input.frontendOptions);
		if (!optionResolution.valid) {
			return {
				kind: "failure" as const,
				issues: markDiagnostics(optionResolution.issues, "parse"),
				notes: [],
			};
		}
		const { parseMode } = optionResolution.options;
		if (
			parseMode === "liquid-only" &&
			!input.source.includes("{{") &&
			!input.source.includes("{%")
		) {
			return compileLiquidFreeInput(input);
		}
		const document = parseSourceDocument(
			createDefaultSourceParserRegistry(),
			input.file,
			"liquid",
			input.source,
		);
		const syntaxFacts = liquidSyntaxFacts(document);
		const htmlIssues =
			parseMode === "strict" && syntaxFacts.authoritative
				? htmlSyntaxIssues(document)
				: [];
		const authoritative = syntaxFacts.authoritative && htmlIssues.length === 0;
		const dependencies = authoritative
			? syntaxFacts.dependencies.map((dependency) => {
					const name = dependency.name;
					const valid = name
						? validateDependencyName(dependency.kind, name).valid
						: false;
					return {
						kind: dependency.kind,
						invocationKind: dependency.invocationKind,
						name,
						path:
							name && valid ? dependencyPath(dependency.kind, name) : undefined,
						source: dependencyMarkup(
							input.source.slice(dependency.range.start, dependency.range.end),
							dependency.kind,
							dependency.invocationKind,
						),
						static:
							name !== undefined ||
							(dependency.kind === "layout" &&
								/\blayout\s+none\b/.test(
									input.source.slice(
										dependency.range.start,
										dependency.range.end,
									),
								)),
						span: spanFromOffsets(input.source, input.file, dependency.range),
					};
				})
			: [];
		const dependencyIssues = dependencies.flatMap((dependency) => {
			if (!dependency.name) return [];
			const validation = validateDependencyName(
				dependency.kind,
				dependency.name,
			);
			return validation.valid
				? []
				: [
						invalidDependencyName(
							dependency.kind,
							dependency.name,
							dependency.span,
							validation.reason,
						),
					];
		});
		const settingsReads = authoritative
			? syntaxFacts.settingsReads.map((read) => {
					const range = rangeOfTextWithinRange(
						input.source,
						read.name,
						read.range,
					);
					return {
						object: read.object,
						name: read.name,
						span: spanFromOffsets(input.source, input.file, range),
					};
				})
			: [];
		const treeIssues = [...document.issues, ...htmlIssues].map((issue) => ({
			severity: "error" as const,
			code: issue.code,
			message: issue.message,
			span: spanFromOffsets(input.source, input.file, issue.range),
		}));
		const ast = {
			file: input.file,
			nodes: [] as [],
			schema: syntaxFacts.schema
				? {
						source: syntaxFacts.schema.body,
						span: spanFromOffsets(
							input.source,
							input.file,
							syntaxFacts.schema.range,
						),
					}
				: undefined,
			settingsReads,
			dependencies,
			diagnostics: treeIssues,
			notes: [] as [],
			factsCollected: authoritative,
			parseMode,
		};
		const issues = [
			...markDiagnostics(treeIssues, "parse"),
			...markDiagnostics(
				authoritative ? [] : [plainLiquidFactsSkipped(input.file)],
				"parse",
			),
			...markDiagnostics(
				[...dependencyIssues, ...checkVanillaSchema(ast)],
				"check",
			),
		];
		const syntax = [
			{
				id: fileSyntaxId(input.file),
				kind: "file" as const,
				path: input.file,
				span: spanFromOffsets(input.source, input.file, {
					start: 0,
					end: input.source.length,
				}),
			},
		];
		return {
			kind: "direct-ir" as const,
			syntax,
			ir: { syntax, symbols: [], resolutions: [] },
			contractPath: input.file,
			contracts: [],
			issues,
			notes: [],
			sourceForEmit: input.source,
			frontendSupport: PLAIN_LIQUID_SUPPORT,
			contractProvenance: "none" as const,
			metadata: {
				ast,
				dependencies,
				factsCollected: ast.factsCollected,
				parseMode: ast.parseMode,
			} satisfies PlainLiquidFrontendMetadata,
		};
	},
};

function compileLiquidFreeInput(input: CompileInput) {
	const syntax = [
		{
			id: fileSyntaxId(input.file),
			kind: "file" as const,
			path: input.file,
			span: spanFromOffsets(input.source, input.file, {
				start: 0,
				end: input.source.length,
			}),
		},
	];
	const ast = {
		file: input.file,
		nodes: [] as [],
		schema: undefined,
		settingsReads: [],
		dependencies: [],
		diagnostics: [],
		notes: [] as [],
		factsCollected: true,
		parseMode: "liquid-only" as const,
	};
	return {
		kind: "direct-ir" as const,
		syntax,
		ir: { syntax, symbols: [], resolutions: [] },
		contractPath: input.file,
		contracts: [],
		issues: [],
		notes: [],
		sourceForEmit: input.source,
		frontendSupport: PLAIN_LIQUID_SUPPORT,
		contractProvenance: "none" as const,
		metadata: {
			ast,
			dependencies: ast.dependencies,
			factsCollected: true,
			parseMode: ast.parseMode,
		} satisfies PlainLiquidFrontendMetadata,
	};
}

function dependencyMarkup(
	tag: string,
	kind: "snippet" | "section" | "section-group" | "layout",
	invocationKind: "render" | "include" | undefined,
): string {
	const name = invocationKind ?? (kind === "section-group" ? "sections" : kind);
	return tag
		.replace(new RegExp(`^{%-?\\s*${name}\\s*`), "")
		.replace(/\s*-?%}$/, "");
}
