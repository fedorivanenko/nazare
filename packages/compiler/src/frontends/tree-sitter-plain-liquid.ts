import {
	createDefaultSourceParserRegistry,
	liquidSyntaxFacts,
	parseSourceDocument,
} from "@nazare/source";
import { checkVanillaSchema } from "../check-vanilla.js";
import type { CompileInput, CompilerFrontend } from "../frontend.js";
import { fileSyntaxId } from "../ids.js";
import { markDiagnostics } from "../pipeline.js";
import {
	dependencyPath,
	parsePlainLiquid,
	plainLiquidFactsSkipped,
	validateDependencyName,
} from "../plain-liquid.js";
import { spanFromOffsets } from "../source.js";
import {
	PLAIN_LIQUID_SUPPORT,
	type PlainLiquidFrontendMetadata,
	plainLiquidOptions,
} from "./plain-liquid.js";

/** Opt-in bridge: Tree-sitter owns mechanical facts; Shopify parser remains semantic/schema oracle. */
export const treeSitterPlainLiquidFrontend: CompilerFrontend = {
	name: "tree-sitter-plain-liquid",
	accepts(file: string): boolean {
		return file.endsWith(".liquid") && !file.endsWith(".nz.liquid");
	},
	compile(input: CompileInput) {
		const optionResolution = plainLiquidOptions(input.frontendOptions);
		const compatibilityAst = parsePlainLiquid(
			input.source,
			input.file,
			optionResolution.options,
		);
		const document = parseSourceDocument(
			createDefaultSourceParserRegistry(),
			input.file,
			"liquid",
			input.source,
		);
		const syntaxFacts = liquidSyntaxFacts(document);
		const dependencies = syntaxFacts.authoritative
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
		const settingsReads = syntaxFacts.authoritative
			? syntaxFacts.settingsReads.map((read) => {
					const text = input.source.slice(read.range.start, read.range.end);
					const nameOffset = text.lastIndexOf(read.name);
					const range =
						nameOffset < 0
							? read.range
							: {
									start: read.range.start + nameOffset,
									end: read.range.start + nameOffset + read.name.length,
								};
					return {
						object: read.object,
						name: read.name,
						span: spanFromOffsets(input.source, input.file, range),
					};
				})
			: [];
		const ast = {
			...compatibilityAst,
			schema: syntaxFacts.schema ? compatibilityAst.schema : undefined,
			settingsReads,
			dependencies,
			factsCollected: syntaxFacts.authoritative,
		};
		const treeIssues = document.issues.map((issue) => ({
			severity: "error" as const,
			code: issue.code,
			message: issue.message,
			span: spanFromOffsets(input.source, input.file, issue.range),
		}));
		const issues = [
			...markDiagnostics(optionResolution.issues, "parse"),
			...markDiagnostics(compatibilityAst.diagnostics, "parse"),
			...markDiagnostics(treeIssues, "parse"),
			...markDiagnostics(
				syntaxFacts.authoritative ? [] : [plainLiquidFactsSkipped(input.file)],
				"parse",
			),
			...markDiagnostics(checkVanillaSchema(ast), "check"),
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
