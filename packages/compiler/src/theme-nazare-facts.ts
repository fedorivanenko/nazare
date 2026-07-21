import type { Diagnostic } from "@nazare/core";
import { nazareLiquidFrontend } from "./frontends/nazare-liquid.js";
import { projectArtifact } from "./pipeline.js";
import type { DependencyResolver, ReadFile } from "./resolver.js";
import {
	renderSiteKey,
	type ThemeBuiltArtifact,
	type ThemeFact,
} from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";
import { collectSourceThemeFacts } from "./theme-source-facts.js";

export function collectNazareThemeFacts(
	path: string,
	contents: string,
	options: {
		readFile?: ReadFile;
		/** Workspace-shared dependency caches; see resolver.ts. */
		dependencyResolver?: DependencyResolver;
		strictness?: "strict" | "loose";
	} = {},
): { facts: ThemeFact[]; issues: Diagnostic[]; artifact?: ThemeBuiltArtifact } {
	const facts: ThemeFact[] = [];
	const frontendResult = nazareLiquidFrontend.compile({
		source: contents,
		file: path,
		readFile: options.readFile,
		dependencyResolver: options.dependencyResolver,
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

	const declaredComponentKind = projected.syntax.find(
		(node) => node.kind === "component",
	)?.componentKind;
	const snippetNameByImportAlias = new Map(
		projected.syntax
			.filter((node) => node.kind === "import")
			.map((node) => [node.localName, themeNameFromPath(node.path)]),
	);
	const resolvedRenderName = (targetName: string): string =>
		snippetNameByImportAlias.get(targetName) ?? targetName;

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
			if (node.componentKind === "block") {
				facts.push({
					kind: "declaresThemeBlock",
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
	}
	// Nazare render arguments come from the component's own parse — the
	// LiquidHTML AST cannot model the { prop: expr } render form.
	for (const node of frontendResult.ast.nodes) {
		if (node.type !== "NazareRender") continue;
		const siteId = renderSiteKey(path, node.span);
		facts.push({
			kind: "rendersSnippet",
			fromPath: path,
			targetName: resolvedRenderName(node.target),
			siteId,
			invocationKind: "render",
			static: true,
			span: node.span,
		});
		for (const prop of node.props) {
			facts.push({
				kind: "passesRenderArgument",
				fromPath: path,
				targetName: resolvedRenderName(node.target),
				siteId,
				argumentName: prop.name,
				valueExpression: prop.expression,
				span: prop.span,
			});
		}
	}
	// The parser already located settings reads; map, don't re-scan.
	for (const read of frontendResult.ast.settingsReads) {
		facts.push({
			kind: "readsSetting",
			fromPath: path,
			settingObject: read.object,
			settingId: read.name,
			span: read.span,
		});
	}
	// Source facts walk the component's LiquidHTML AST, which the parser built
	// from script/style-blanked text (same offsets) — behavior code can never
	// produce a data-read fact.
	facts.push(
		...collectSourceThemeFacts(path, contents, frontendResult.ast.liquidAst),
	);
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
				if (declaredComponentKind === "block") {
					facts.push({
						kind: "definesBlockSetting",
						path,
						blockType: themeNameFromPath(path),
						settingId: prop.name,
						settingType: prop.typeExpression,
						span: prop.span,
					});
					continue;
				}
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
