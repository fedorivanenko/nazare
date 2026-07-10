// Emit pass: turns a compiled component back into plain Shopify theme files.
// Liquid output is span-based surgery on the authored source — Nazare tags
// removed, ref attributes rewritten to data-nz-ref, render sites lowered to
// {% render 'name', ... %}, the root element stamped with data-nz-component —
// so everything Nazare didn't model passes through byte-for-byte. Scripts
// are transpiled and wrapped for the runtime asset, which mounts one setup
// call per DOM instance.
import type {
	ArtifactIR,
	Diagnostic,
	Id,
	NazareManifest,
	PropArgumentSyntaxNode,
} from "@nazare/core";
import { NodeTypes } from "@shopify/liquid-html-parser";
import ts from "typescript";
import type { NazareAst } from "./ast.js";
import { emitScriptWithoutDefaultExport, emitScriptWithoutRoot } from "./diagnostics.js";
import { themeSchemaFromIR } from "./schema.js";
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
	const hasScript = scripts.length > 0;

	const liquid = emitLiquid(source, compiled, options, hasScript, issues);
	const directory = options.kind === "section" ? "sections" : "snippets";
	files.push({ path: `${directory}/${options.name}.liquid`, contents: liquid });

	if (hasScript) {
		files.push({
			path: `assets/${options.name}.js`,
			contents: emitComponentScript(scripts, options.name, issues),
		});
		files.push({ path: "assets/nazare-runtime.js", contents: runtimeSource });
	}

	return { files, issues };
}

function emitLiquid(
	source: string,
	compiled: CompiledComponent,
	options: EmitThemeOptions,
	hasScript: boolean,
	issues: Diagnostic[],
): string {
	const edits: SourceEdit[] = [];
	const snippetNamesByLocalName = new Map<string, string>();
	const argumentsById = new Map<Id, PropArgumentSyntaxNode>();
	const expressionsById = new Map<Id, string>();

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
		if (node.type === "NazareProps" || node.type === "NazareImport") {
			edits.push({ ...editRange(source, node.span), replacement: "" });
		}
		if (node.type === "NazareScript") {
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
			const argumentList = node.argumentIds
				.map((argumentId) => argumentsById.get(argumentId))
				.filter((argument) => argument !== undefined)
				.map(
					(argument) =>
						`${argument.name}: ${expressionsById.get(argument.expressionId) ?? ""}`,
				)
				.join(", ");
			edits.push({
				...editRange(source, node.span),
				replacement: argumentList
					? `{% render '${snippetName}', ${argumentList} %}`
					: `{% render '${snippetName}' %}`,
			});
		}
	}

	if (hasScript) {
		const rootTagEnd = rootElementStartTagEnd(source, compiled.ast);
		if (rootTagEnd === undefined) {
			issues.push(emitScriptWithoutRoot(options.name));
		} else {
			edits.push({
				start: rootTagEnd,
				end: rootTagEnd,
				replacement: ` data-nz-component="${options.name}"`,
			});
		}
	}

	let liquid = applyEdits(source, edits);
	liquid = `${liquid.replace(/\n{3,}/g, "\n\n").trim()}\n`;

	if (hasScript) {
		liquid +=
			`{{ 'nazare-runtime.js' | asset_url | script_tag }}\n` +
			`{{ '${options.name}.js' | asset_url | script_tag }}\n`;
	}

	if (options.kind === "section") {
		const schema = themeSchemaFromIR(compiled.ir, { name: options.name });
		liquid += `\n{% schema %}\n${JSON.stringify(schema, null, 2)}\n{% endschema %}\n`;
	}

	return liquid;
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

function emitComponentScript(
	scripts: Extract<ArtifactIR["syntax"][number], { kind: "script" }>[],
	name: string,
	issues: Diagnostic[],
): string {
	const bodies = scripts.map((script) => {
		if (!/\bexport\s+default\b/.test(script.source)) {
			issues.push(emitScriptWithoutDefaultExport(name, script.span));
		}
		const rewritten = script.source.replace(
			/\bexport\s+default\b/,
			"__module.default =",
		);
		return script.lang === "ts"
			? ts.transpileModule(rewritten, {
					compilerOptions: { target: ts.ScriptTarget.ES2018 },
				}).outputText
			: rewritten;
	});

	return [
		`/* Generated by Nazare. Component: ${name} */`,
		"(function () {",
		'  "use strict";',
		"  var island = window.Nazare.island;",
		"  var __module = {};",
		...bodies.map((body) => indent(body.trim(), "  ")),
		`  window.Nazare.register(${JSON.stringify(name)}, __module.default);`,
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
  function mount(name, setup) {
    var roots = document.querySelectorAll('[data-nz-component="' + name + '"]');
    roots.forEach(function (root) {
      if (root.nazareMounted) return;
      root.nazareMounted = true;
      var refs = new Proxy({}, {
        get: function (_, key) {
          if (typeof key !== "string") return undefined;
          if (root.getAttribute("data-nz-ref") === key) return root;
          return root.querySelector('[data-nz-ref="' + key + '"]');
        },
      });
      setup({ root: root, refs: refs });
    });
  }
  function register(name, setup) {
    if (typeof setup !== "function") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        mount(name, setup);
      });
    } else {
      mount(name, setup);
    }
  }
  window.Nazare = { island: island, register: register, mount: mount };
})();
`;
