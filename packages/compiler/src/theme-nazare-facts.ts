import type { Diagnostic } from "@nazare/core";
import { nazareLiquidFrontend } from "./frontends/nazare-liquid.js";
import { compileArtifact } from "./index.js";
import type { ReadFile } from "./resolver.js";
import type { ThemeBuiltArtifact, ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";

export function collectNazareThemeFacts(
	path: string,
	contents: string,
	options: { readFile?: ReadFile; strictness?: "strict" | "loose" } = {},
): { facts: ThemeFact[]; issues: Diagnostic[]; artifact?: ThemeBuiltArtifact } {
	const facts: ThemeFact[] = [];
	const compiled = compileArtifact({
		source: contents,
		file: path,
		readFile: options.readFile,
		strictness: options.strictness,
		frontend: nazareLiquidFrontend,
	});
	if (!compiled.ok || !compiled.ast) return { facts, issues: compiled.issues };
	const artifact: ThemeBuiltArtifact = {
		path,
		source: contents,
		ast: compiled.ast,
		ir: compiled.ir,
		contract: compiled.contract,
		contracts: compiled.contracts,
		canEmit: compiled.canEmit,
		notes: compiled.notes,
	};

	for (const node of compiled.syntax) {
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
	if (compiled.ast?.schema) {
		const schemaPath = "schema";
		facts.push({
			kind: "definesSchema",
			path,
			schemaPath,
			span: compiled.ast.schema.span,
		});
		for (const node of compiled.ast.nodes) {
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
	return { facts, issues: compiled.issues, artifact };
}
