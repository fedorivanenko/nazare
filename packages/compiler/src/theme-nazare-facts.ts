import type { Diagnostic } from "@nazare/core";
import { nazareLiquidFrontend } from "./frontends/nazare-liquid.js";
import { projectArtifact } from "./pipeline.js";
import type { ReadFile } from "./resolver.js";
import type { ThemeBuiltArtifact, ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";

export function collectNazareThemeFacts(
	path: string,
	contents: string,
	options: { readFile?: ReadFile; strictness?: "strict" | "loose" } = {},
): { facts: ThemeFact[]; issues: Diagnostic[]; artifact?: ThemeBuiltArtifact } {
	const facts: ThemeFact[] = [];
	const frontendResult = nazareLiquidFrontend.compile({
		source: contents,
		file: path,
		readFile: options.readFile,
		strictness: options.strictness,
	});
	if (frontendResult.kind !== "nazare-ast") {
		return {
			facts,
			issues: [
				{
					severity: "error",
					code: "THEME_NAZARE_FRONTEND_RESULT_UNSUPPORTED",
					message: `Nazare Liquid frontend returned ${frontendResult.kind} for ${path}`,
					phase: "parse",
				},
			],
		};
	}
	const projected = projectArtifact(frontendResult.ast, {
		contracts: frontendResult.contracts,
		mode: options.strictness,
		resolveIssues: frontendResult.resolveIssues,
	});
	const issues = projected.issues;
	const canEmit = !issues.some((issue) => issue.severity === "error");
	const artifact: ThemeBuiltArtifact = {
		path,
		source: contents,
		ast: frontendResult.ast,
		ir: projected.ir,
		contract: projected.contract,
		contracts: frontendResult.contracts,
		canEmit,
		notes: frontendResult.notes,
	};

	for (const node of projected.syntax) {
		if (node.kind === "component") {
			facts.push({
				kind: "declaresComponent",
				path,
				name: node.name || themeNameFromPath(path),
				componentKind: node.componentKind,
			});
			if (node.componentKind === "section") {
				facts.push({
					kind: "declaresSection",
					path,
					name: themeNameFromPath(path),
				});
			}
			if (node.componentKind === "snippet") {
				facts.push({
					kind: "declaresSnippet",
					path,
					name: themeNameFromPath(path),
				});
			}
		}
		if (node.kind === "import") {
			facts.push({
				kind: "importsComponent",
				fromPath: path,
				targetPath: node.path,
				localName: node.localName,
				span: node.span,
			});
		}
		if (node.kind === "render-site") {
			facts.push({
				kind: "rendersSnippet",
				fromPath: path,
				targetName: node.targetName,
				static: true,
				span: node.span,
			});
		}
	}
	if (frontendResult.ast.schema) {
		const schemaPath = "schema";
		facts.push({
			kind: "definesSchema",
			path,
			schemaPath,
			span: frontendResult.ast.schema.span,
		});
		for (const node of frontendResult.ast.nodes) {
			if (node.type !== "NazareProps") continue;
			for (const prop of node.props) {
				facts.push({
					kind: "definesSetting",
					path,
					schemaPath,
					settingId: prop.name,
					settingType: prop.typeExpression,
					span: prop.span,
				});
			}
		}
	}
	return { facts, issues, artifact };
}
