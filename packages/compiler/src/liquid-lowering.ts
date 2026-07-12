// Liquid reference lowering owned by emit. These are intentionally textual over
// the final Liquid output so preserved/unmodeled Liquid regions behave the same
// as modeled expression nodes. Keep this module small and heavily tested.
import type { ArtifactIR, ComponentKind } from "@nazare/core";
import { scopedClassName } from "./css-modules.js";

/**
 * Lowers canonical props.x reads to their provenance: setting props read
 * section.settings.x / block.settings.x, render-passed props read the bare
 * render argument name. Undeclared props are left for diagnostics/runtime.
 */
export function lowerPropsReads(
	liquid: string,
	ir: ArtifactIR,
	kind: ComponentKind,
): string {
	const settingsObject =
		kind === "block" ? "block.settings" : "section.settings";
	const accessByProp = new Map<string, string>();
	for (const node of ir.syntax) {
		if (node.kind !== "prop-declaration") continue;
		accessByProp.set(
			node.name,
			node.typeInfo.setting ? `${settingsObject}.${node.name}` : node.name,
		);
	}

	return liquid.replace(
		/\bprops\.([A-Za-z_$][\w$]*)/g,
		(match, name: string) => accessByProp.get(name) ?? match,
	);
}

/**
 * Lowers css-module reads to generated class names. Output tags become bare
 * literals; expression-position reads become quoted strings.
 */
export function lowerStyleReads(
	liquid: string,
	ir: ArtifactIR,
	componentName: string,
): string {
	const bindingNames = ir.syntax
		.filter((node) => node.kind === "style")
		.map((node) => node.bindingName)
		.filter((name): name is string => name !== undefined);

	let output = liquid;
	for (const binding of new Set(bindingNames)) {
		const dotOutput = new RegExp(
			`\\{\\{-?\\s*${binding}\\.([A-Za-z_$][\\w$]*)\\s*-?\\}\\}`,
			"g",
		);
		const bracketOutput = new RegExp(
			`\\{\\{-?\\s*${binding}\\[\\s*["']([^"']+)["']\\s*\\]\\s*-?\\}\\}`,
			"g",
		);
		const dotExpression = new RegExp(
			`\\b${binding}\\.([A-Za-z_$][\\w$]*)\\b`,
			"g",
		);
		const bracketExpression = new RegExp(
			`\\b${binding}\\[\\s*["']([^"']+)["']\\s*\\]`,
			"g",
		);
		const scoped = (className: string) =>
			scopedClassName(componentName, className);

		output = output
			.replace(dotOutput, (_, className: string) => scoped(className))
			.replace(bracketOutput, (_, className: string) => scoped(className))
			.replace(
				dotExpression,
				(_, className: string) => `"${scoped(className)}"`,
			)
			.replace(
				bracketExpression,
				(_, className: string) => `"${scoped(className)}"`,
			);
	}
	return output;
}
