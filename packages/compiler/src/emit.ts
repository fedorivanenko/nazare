// Emit pass: turns a compiled component back into plain Shopify theme files.
// Liquid output is span-based surgery on the authored source — Nazare tags
// removed, ref attributes rewritten to data-nz-ref, render sites lowered to
// {% render 'name', ... %}, the root element stamped with data-nz-component —
// so everything Nazare didn't model passes through byte-for-byte. Scripts
// are transpiled and wrapped for the runtime asset, which mounts one setup
// call per DOM instance.
import type {
	ArtifactContract,
	ArtifactIR,
	Diagnostic,
	Id,
	NazareManifest,
	PropArgumentSyntaxNode,
} from "@nazare/core";
import { NodeTypes } from "@shopify/liquid-html-parser";
import ts from "typescript";
import type { NazareAst } from "./ast.js";
import { dataChannelFromIR } from "./data-channel.js";
import { emitScriptWithoutDefaultExport, emitScriptWithoutRoot } from "./diagnostics.js";
import { type HoistedSetting, resolveHoistedSettings } from "./hoist.js";
import { themeSchemaFromIR } from "./schema.js";
import { scopeCss } from "./scope-css.js";
import { offsetFromPosition } from "./source.js";

export type EmitThemeOptions = {
	name: string;
	kind?: NazareManifest["kind"];
};

export type EmittedFile = {
	path: string;
	contents: string;
};

export type EmitResult = {
	files: EmittedFile[];
	issues: Diagnostic[];
};

type CompiledComponent = {
	ast: NazareAst;
	ir: ArtifactIR;
	/** Dependency contracts; enables hoisted settings in schema and lowering. */
	contracts?: ArtifactContract[];
};

type SourceEdit = {
	start: number;
	end: number;
	replacement: string;
};

export function emitTheme(
	source: string,
	compiled: CompiledComponent,
	options: EmitThemeOptions,
): EmitResult {
	const issues: Diagnostic[] = [];
	const files: EmittedFile[] = [];
	const scripts = compiled.ir.syntax.filter((node) => node.kind === "script");
	const styles = compiled.ir.syntax.filter((node) => node.kind === "style");
	const hasScript = scripts.length > 0;
	const hasStyle = styles.length > 0;

	const liquid = emitLiquid(
		source,
		compiled,
		options,
		{ hasScript, hasStyle },
		issues,
	);
	const directory = options.kind === "section" ? "sections" : "snippets";
	files.push({ path: `${directory}/${options.name}.liquid`, contents: liquid });

	if (hasStyle) {
		const scope = `[data-nz-component="${options.name}"]`;
		const css = styles
			.map((style) => scopeCss(style.source, scope))
			.join("\n\n");
		files.push({ path: `assets/${options.name}.css`, contents: `${css}\n` });
	}

	if (hasScript) {
		files.push({
			path: `assets/${options.name}.js`,
			contents: emitComponentScript(
				scripts,
				options.name,
				dataDescriptor(compiled.ir),
				issues,
			),
		});
		files.push({ path: "assets/nazare-runtime.js", contents: runtimeSource });
	}

	return { files, issues };
}

function emitLiquid(
	source: string,
	compiled: CompiledComponent,
	options: EmitThemeOptions,
	{ hasScript, hasStyle }: { hasScript: boolean; hasStyle: boolean },
	issues: Diagnostic[],
): string {
	const edits: SourceEdit[] = [];
	const snippetNamesByLocalName = new Map<string, string>();
	const argumentsById = new Map<Id, PropArgumentSyntaxNode>();
	const expressionsById = new Map<Id, string>();
	const hoistedBySiteId = new Map<Id, HoistedSetting[]>();
	for (const setting of resolveHoistedSettings(
		compiled.ir,
		compiled.contracts,
	).hoisted) {
		const bucket = hoistedBySiteId.get(setting.renderSiteId);
		if (bucket) bucket.push(setting);
		else hoistedBySiteId.set(setting.renderSiteId, [setting]);
	}

	for (const node of compiled.ir.syntax) {
		if (node.kind === "import") {
			snippetNamesByLocalName.set(
				node.localName,
				node.packageId.split("/").at(-1) ?? node.localName,
			);
		}
		if (node.kind === "prop-argument") argumentsById.set(node.id, node);
		if (node.kind === "expression") expressionsById.set(node.id, node.source);
	}

	for (const node of compiled.ast.nodes) {
		if (
			node.type === "NazareProps" ||
			node.type === "NazareImport" ||
			node.type === "NazareAssetImport" ||
			node.type === "NazareScript" ||
			node.type === "NazareStyle"
		) {
			edits.push({ ...editRange(source, node.span), replacement: "" });
		}
	}

	for (const node of compiled.ir.syntax) {
		if (node.kind === "element-ref" && node.span) {
			edits.push({
				...editRange(source, node.span),
				replacement: `data-nz-ref="${node.name}"`,
			});
		}
		if (node.kind === "render-site" && node.span) {
			const snippetName =
				snippetNamesByLocalName.get(node.targetName) ??
				node.targetName.toLowerCase();
			const authored = node.argumentIds
				.map((argumentId) => argumentsById.get(argumentId))
				.filter((argument) => argument !== undefined)
				.map(
					(argument) =>
						`${argument.name}: ${expressionsById.get(argument.expressionId) ?? ""}`,
				);
			// Hoisted settings become generated pass-through arguments: read
			// from our own schema in a section, from our own implicit render
			// args in a snippet (whose consumer hoists them further).
			const generated = (hoistedBySiteId.get(node.id) ?? []).map(
				(setting) =>
					`${setting.argName}: ${
						options.kind === "section"
							? `section.settings.${setting.settingId}`
							: setting.settingId
					}`,
			);
			const argumentList = [...authored, ...generated].join(", ");
			edits.push({
				...editRange(source, node.span),
				replacement: argumentList
					? `{% render '${snippetName}', ${argumentList} %}`
					: `{% render '${snippetName}' %}`,
			});
		}
	}

	if (hasScript || hasStyle) {
		const rootTagEnd = rootElementStartTagEnd(source, compiled.ast);
		if (rootTagEnd === undefined) {
			if (hasScript) issues.push(emitScriptWithoutRoot(options.name));
		} else {
			edits.push({
				start: rootTagEnd,
				end: rootTagEnd,
				replacement: ` data-nz-component="${options.name}"`,
			});
		}
	}

	let liquid = applyEdits(source, edits);
	liquid = lowerPropsReads(liquid, compiled.ir);
	liquid = `${liquid.replace(/\n{3,}/g, "\n\n").trim()}\n`;
	liquid =
		generatedHeader(
			compiled.ast.file,
			Array.from(hoistedBySiteId.values()).flat(),
		) + liquid;

	if (hasStyle) {
		liquid += `{{ '${options.name}.css' | asset_url | stylesheet_tag }}\n`;
	}
	if (hasScript) {
		liquid +=
			`{{ 'nazare-runtime.js' | asset_url | script_tag }}\n` +
			`{{ '${options.name}.js' | asset_url | script_tag }}\n`;
	}

	if (options.kind === "section") {
		const schema = themeSchemaFromIR(compiled.ir, {
			name: options.name,
			contracts: compiled.contracts,
		});
		liquid += `\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}\n`;
	}

	return liquid;
}

/**
 * Every generated file names its source, and every piece of generated
 * wiring is listed — hoisted settings are the one thing in the output that
 * exists in no authored file, so the header answers "where does this come
 * from" without archaeology.
 */
function generatedHeader(
	sourceFile: string,
	hoisted: HoistedSetting[],
): string {
	const lines = [`Generated by Nazare from ${sourceFile} — do not edit.`];
	if (hoisted.length > 0) {
		lines.push("Hoisted settings (declared by dependencies):");
		for (const entry of hoisted) {
			lines.push(
				`  ${entry.settingId} <- prop "${entry.sourcePropName}" of ${entry.sourcePackageId} (via ${entry.alias})`,
			);
		}
	}
	return `{%- comment -%}\n${lines.join("\n")}\n{%- endcomment -%}\n`;
}

/**
 * Lowers canonical props.x reads to their provenance: setting props read
 * section.settings.x, render-passed props read the bare argument name.
 * Textual over the whole output so control-flow Liquid (which Nazare does
 * not model) lowers too; undeclared names are left for check to report.
 */
function lowerPropsReads(liquid: string, ir: ArtifactIR): string {
	const accessByProp = new Map<string, string>();
	for (const node of ir.syntax) {
		if (node.kind !== "prop-declaration") continue;
		accessByProp.set(
			node.name,
			node.typeInfo.setting ? `section.settings.${node.name}` : node.name,
		);
	}

	return liquid.replace(
		/\bprops\.([A-Za-z_$][\w$]*)/g,
		(match, name: string) => accessByProp.get(name) ?? match,
	);
}

/** Offset just before the closing ">" of the first top-level element's start tag. */
function rootElementStartTagEnd(
	source: string,
	ast: NazareAst,
): number | undefined {
	for (const node of ast.liquidAst.children) {
		if (
			node.type !== NodeTypes.HtmlElement &&
			node.type !== NodeTypes.HtmlVoidElement &&
			node.type !== NodeTypes.HtmlSelfClosingElement
		) {
			continue;
		}
		const tagEnd = (node as { blockStartPosition: { end: number } })
			.blockStartPosition.end;
		return source[tagEnd - 2] === "/" ? tagEnd - 2 : tagEnd - 1;
	}
	return undefined;
}

/** Descriptor telling the runtime how to parse each ref's data-* strings. */
function dataDescriptor(ir: ArtifactIR): Record<string, Record<string, string>> {
	const descriptor: Record<string, Record<string, string>> = {};
	for (const [refName, bindings] of dataChannelFromIR(ir)) {
		descriptor[refName] = {};
		for (const binding of bindings.values()) {
			descriptor[refName][binding.property] = binding.kind;
		}
	}
	return descriptor;
}

function emitComponentScript(
	scripts: Extract<ArtifactIR["syntax"][number], { kind: "script" }>[],
	name: string,
	descriptor: Record<string, Record<string, string>>,
	issues: Diagnostic[],
): string {
	// Each behavior registers separately so declaration order is mount order
	// and one default export cannot clobber another.
	const registrations = scripts.map((script) => {
		if (!/\bexport\s+default\b/.test(script.source)) {
			issues.push(emitScriptWithoutDefaultExport(name, script.span));
		}
		const rewritten = script.source.replace(
			/\bexport\s+default\b/,
			"__module.default =",
		);
		const body =
			script.lang === "ts"
				? ts.transpileModule(rewritten, {
						compilerOptions: { target: ts.ScriptTarget.ES2018 },
					}).outputText
				: rewritten;

		return [
			"(function () {",
			"  var __module = {};",
			indent(body.trim(), "  "),
			`  window.Nazare.register(${JSON.stringify(name)}, __module.default, __data);`,
			"})();",
		].join("\n");
	});

	return [
		`/* Generated by Nazare. Component: ${name} */`,
		"(function () {",
		'  "use strict";',
		"  var island = window.Nazare.island;",
		`  var __data = ${JSON.stringify(descriptor)};`,
		...registrations.map((registration) => indent(registration, "  ")),
		"})();",
		"",
	].join("\n");
}

function editRange(
	source: string,
	span: { start: { line: number; column: number }; end: { line: number; column: number } } | undefined,
): { start: number; end: number } {
	if (!span) return { start: 0, end: 0 };
	return {
		start: offsetFromPosition(source, span.start),
		end: offsetFromPosition(source, span.end),
	};
}

function applyEdits(source: string, edits: SourceEdit[]): string {
	const ordered = [...edits].sort((a, b) => b.start - a.start);
	let output = source;
	for (const edit of ordered) {
		output =
			output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
	}
	return output;
}

function indent(text: string, prefix: string): string {
	return text
		.split("\n")
		.map((line) => (line ? prefix + line : line))
		.join("\n");
}

// Mount-per-instance DOM runtime, emitted verbatim as a theme asset. Grows
// into @nazare/runtime once it needs its own build.
const runtimeSource = `/* Nazare runtime */
(function () {
  "use strict";
  if (window.Nazare) return;
  function island(setup) { return setup; }
  function refLookup(root, key) {
    if (root.getAttribute("data-nz-ref") === key) return root;
    return root.querySelector('[data-nz-ref="' + key + '"]');
  }
  function parseValue(raw, kind) {
    if (raw === undefined) return undefined;
    if (kind === "number") return Number(raw);
    if (kind === "boolean") return raw === "true";
    return raw;
  }
  function buildData(root, descriptor) {
    var data = {};
    Object.keys(descriptor || {}).forEach(function (refName) {
      var element = refLookup(root, refName);
      var entry = {};
      Object.keys(descriptor[refName]).forEach(function (property) {
        var raw = element ? element.dataset[property] : undefined;
        entry[property] = parseValue(raw, descriptor[refName][property]);
      });
      data[refName] = entry;
    });
    return data;
  }
  function mount(name, setup, descriptor) {
    var roots = document.querySelectorAll('[data-nz-component="' + name + '"]');
    roots.forEach(function (root) {
      if (!root.nazareMounted) root.nazareMounted = [];
      if (root.nazareMounted.indexOf(setup) !== -1) return;
      root.nazareMounted.push(setup);
      var refs = new Proxy({}, {
        get: function (_, key) {
          if (typeof key !== "string") return undefined;
          return refLookup(root, key);
        },
      });
      setup({ root: root, refs: refs, data: buildData(root, descriptor) });
    });
  }
  function register(name, setup, descriptor) {
    if (typeof setup !== "function") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        mount(name, setup, descriptor);
      });
    } else {
      mount(name, setup, descriptor);
    }
  }
  window.Nazare = { island: island, register: register, mount: mount };
})();
`;
