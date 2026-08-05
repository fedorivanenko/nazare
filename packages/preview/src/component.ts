// Source → previewable component. The preview always renders the *emitted*
// template, never the authored source: what the storefront gets is what the
// gallery shows, so a lowering bug is visible here instead of only on a store.
import {
	buildPlainLiquid,
	collectPlainLiquidFacts,
	compileArtifact,
	emitTheme,
} from "@nazare/compiler/compile";
import type { ArtifactContract, ComponentKind, Diagnostic } from "@nazare/core";
import { controlsFromContract, type PreviewControl } from "./controls.js";
import { plainLiquidControls } from "./plain-controls.js";

export type PreviewAsset = { path: string; contents: string };

export type PreviewComponent = {
	/** Display name — the emitted template's basename. */
	name: string;
	/** Project-relative source path. */
	file: string;
	/** Registry id when the component came from a package, e.g. "@nazare/link". */
	packageId?: string;
	frontend: "nazare" | "plain";
	/** snippet | section | block, when the frontend knows it. */
	componentKind?: ComponentKind;
	/** Emitted Liquid, the thing the preview renders. */
	template: string;
	/** Emitted assets/*: stylesheets, behavior modules, the island runtime. */
	assets: PreviewAsset[];
	contract?: ArtifactContract;
	controls: PreviewControl[];
	issues: Diagnostic[];
};

export type PreviewComponentOptions = {
	/** Resolves imports, relative to the same root the file path is relative to. */
	readFile?: (path: string) => string | undefined;
	/** Defaults to strict, matching a package author's build. */
	strictness?: "strict" | "loose";
	/** Registry id from the component's nazare.json, for the install command. */
	packageId?: string;
	/**
	 * What a plain-Liquid file is, when the caller knows — from a manifest, say.
	 * A Nazare component declares its own kind in source and ignores this. Left
	 * off, a plain file is classified by the theme directory it sits in.
	 */
	kind?: ComponentKind;
};

/**
 * Shopify addresses a theme file by the directory it lives in, and the kind
 * decides the scope its props arrive in: a section reads `section.settings.*`,
 * a snippet reads bare variables. Getting this wrong renders every value blank.
 */
function kindFromPath(file: string): ComponentKind | undefined {
	if (/(^|\/)sections\//.test(file)) return "section";
	if (/(^|\/)blocks\//.test(file)) return "block";
	if (/(^|\/)snippets\//.test(file)) return "snippet";
	return undefined;
}

const templateBaseName = (file: string): string =>
	(file.split("/").pop() ?? file).replace(/\.nz\.liquid$|\.liquid$/, "");

/**
 * The snippets a composing component can render, keyed the way
 * `{% render 'x' %}` addresses them. Emit lowers a component import to a bare
 * snippet name, so previewing a component that composes others needs the whole
 * library in scope — without it the render tag resolves nothing and the story
 * fails. Sections and blocks are excluded: the theme editor places those, and
 * `{% render %}` cannot target them.
 */
export function snippetLibrary(
	components: PreviewComponent[],
): Record<string, string> {
	const snippets: Record<string, string> = {};
	for (const component of components) {
		if (component.componentKind && component.componentKind !== "snippet") {
			continue;
		}
		if (component.template) snippets[component.name] = component.template;
	}
	return snippets;
}

function splitEmitted(files: { path: string; contents: string }[]): {
	template: string;
	assets: PreviewAsset[];
} {
	let template = "";
	let templatePath: string | undefined;
	const assets: PreviewAsset[] = [];
	for (const file of files) {
		if (file.path.endsWith(".liquid")) {
			if (templatePath !== undefined) {
				throw new Error(
					`Preview expected one emitted template, but output contains both ${templatePath} and ${file.path}`,
				);
			}
			templatePath = file.path;
			template = file.contents;
			continue;
		}
		assets.push(file);
	}
	return { template, assets };
}

export function previewComponentFromSource(
	source: string,
	file: string,
	options: PreviewComponentOptions = {},
): PreviewComponent {
	const name = templateBaseName(file);
	const readFile = options.readFile ?? (() => undefined);

	if (!file.endsWith(".nz.liquid")) {
		const built = buildPlainLiquid(source, file, { emitOnError: true });
		const { template, assets } = splitEmitted(built.emitted.files);
		// Plain Liquid has no Nazare contract, but it does declare an interface:
		// `{% schema %}` settings for a section, `{% doc %}` @param lines for a
		// snippet. Both are the author's own statement, and both are already
		// parsed — reading them is what makes a plain component previewable with
		// props rather than blank.
		const { facts } = collectPlainLiquidFacts(file, source);
		return {
			name,
			file,
			packageId: options.packageId,
			frontend: "plain",
			componentKind: options.kind ?? kindFromPath(file),
			template: template || source,
			assets,
			controls: plainLiquidControls(facts, built.ast.schema?.source),
			issues: built.issues,
		};
	}

	// Preview is a direct one-artifact utility. Imports resolve through readFile,
	// but project analysis and publication remain outside this path.
	const compiled = compileArtifact({
		source,
		file,
		readFile,
		strictness: options.strictness ?? "strict",
	});
	if (!compiled.ok || !compiled.ast) {
		return {
			name,
			file,
			packageId: options.packageId,
			frontend: "nazare",
			template: "",
			assets: [],
			controls: [],
			issues: compiled.issues,
		};
	}
	const emitted = emitTheme(
		source,
		{ ...compiled, ast: compiled.ast },
		{ name, readFile },
	);
	const { template, assets } = splitEmitted(emitted.files);
	return {
		name,
		file,
		packageId: options.packageId,
		frontend: "nazare",
		componentKind: compiled.contract.kind,
		template,
		assets,
		contract: compiled.contract,
		controls: controlsFromContract(compiled.contract),
		issues: [...compiled.issues, ...emitted.issues],
	};
}
