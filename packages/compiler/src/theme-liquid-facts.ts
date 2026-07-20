import type { Diagnostic } from "@nazare/core";
import { type PlainLiquidAst, parsePlainLiquid } from "./plain-liquid.js";
import type { ThemeFact } from "./theme-facts.js";
import { themeNameFromPath } from "./theme-file-classifier.js";

export function collectPlainLiquidThemeFacts(
	path: string,
	contents: string,
): { facts: ThemeFact[]; issues: Diagnostic[] } {
	const ast = parsePlainLiquid(contents, path, { parseMode: "tolerant" });
	const facts: ThemeFact[] = [];
	const name = themeNameFromPath(path);
	if (path.startsWith("sections/") && path.endsWith(".liquid")) {
		facts.push({ kind: "declaresSection", path, name });
	}
	if (path.startsWith("snippets/") && path.endsWith(".liquid")) {
		facts.push({ kind: "declaresSnippet", path, name });
	}
	if (path.startsWith("templates/") && path.endsWith(".liquid")) {
		facts.push({ kind: "declaresTemplate", path, name });
	}
	for (const dependency of ast.dependencies) {
		if (dependency.kind === "snippet") {
			facts.push({
				kind: "rendersSnippet",
				fromPath: path,
				targetName: dependency.name,
				static: dependency.static,
				span: dependency.span,
			});
		}
		if (dependency.kind === "section") {
			facts.push({
				kind: "containsSection",
				fromPath: path,
				targetName: dependency.name,
				static: dependency.static,
				span: dependency.span,
			});
		}
	}
	facts.push(...schemaFacts(path, ast));
	return { facts, issues: ast.diagnostics };
}

function schemaFacts(path: string, ast: PlainLiquidAst): ThemeFact[] {
	if (!ast.schema) return [];
	const schemaPath = "schema";
	const facts: ThemeFact[] = [
		{ kind: "definesSchema", path, schemaPath, span: ast.schema.span },
	];
	try {
		const parsed = JSON.parse(ast.schema.source) as { settings?: unknown };
		if (Array.isArray(parsed.settings)) {
			for (const setting of parsed.settings) {
				if (!setting || typeof setting !== "object") continue;
				const id = (setting as { id?: unknown }).id;
				if (typeof id !== "string") continue;
				const type = (setting as { type?: unknown }).type;
				facts.push({
					kind: "definesSetting",
					path,
					schemaPath,
					settingId: id,
					settingType: typeof type === "string" ? type : undefined,
					span: ast.schema.span,
				});
			}
		}
	} catch {
		// Existing plain Liquid checks report schema JSON issues. Keep extraction best-effort.
	}
	return facts;
}
