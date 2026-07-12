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
	ComponentKind,
	Diagnostic,
	Id,
	PropArgumentSyntaxNode,
} from "@nazare/core";
import { NodeTypes } from "@shopify/liquid-html-parser";
import type { NazareAst } from "./ast.js";
import { bundleScript } from "./bundle.js";
import { rewriteCssClasses, scopedClassName } from "./css-modules.js";
import { dataChannelFromIR } from "./data-channel.js";
import {
	emitAmbiguousRoot,
	emitMultipleRootMarkers,
	emitScriptWithoutDefaultExport,
	emitScriptWithoutRoot,
} from "./diagnostics.js";
import { type HoistedSetting, resolveHoistedSettings } from "./hoist.js";
import { lowerPropsReads, lowerStyleReads } from "./liquid-lowering.js";
import { baseNameOf, directoryOf } from "./paths.js";
import { themeSchemaFromIR } from "./schema.js";
import { hasDefaultExport } from "./script-scan.js";
import { offsetFromPosition } from "./source.js";
import { componentKindFromIR } from "./symbols.js";

export type EmitThemeOptions = {
	name: string;
	/** Reads project files (see index.ts); enables bundling of script imports. */
	readFile?: (path: string) => string | undefined;
};

export type EmittedFile = {
	path: string;
	contents: string;
};

export type EmitResult = {
	files: EmittedFile[];
	issues: Diagnostic[];
};

export type CompiledComponent = {
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

export function checkEmitPreconditions(
	source: string,
	compiled: CompiledComponent,
	options: { name: string },
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const scripts = compiled.ir.syntax.filter((node) => node.kind === "script");
	const hasScript = scripts.length > 0;
	const kind = componentKindFromIR(compiled.ir);

	if (hasScript || kind === "block") {
		const root = rootElement(source, compiled.ast);
		if (!root) {
			if (hasScript) issues.push(emitScriptWithoutRoot(options.name));
		} else {
			if (root.markerCount > 1) {
				issues.push(emitMultipleRootMarkers(options.name, root.markerCount));
			}
			if (root.topLevelCount > 1) {
				issues.push(
					emitAmbiguousRoot(options.name, root.tagName, root.topLevelCount),
				);
			}
		}
	}

	for (const script of scripts) {
		if (!hasDefaultExport(script.source)) {
			issues.push(emitScriptWithoutDefaultExport(options.name, script.span));
		}
	}

	return issues;
}

export function emitTheme(
	source: string,
	compiled: CompiledComponent,
	options: EmitThemeOptions,
): EmitResult {
	const parts = [
		{
			files: [],
			issues: checkEmitPreconditions(source, compiled, { name: options.name }),
		},
		emitLiquidFile(source, compiled, options),
		emitCssFiles(compiled, options),
		emitScriptFiles(compiled, options),
	];

	return {
		files: parts.flatMap((part) => part.files),
		issues: parts.flatMap((part) => part.issues),
	};
}

export function emitLiquidFile(
	source: string,
	compiled: CompiledComponent,
	options: EmitThemeOptions,
): EmitResult {
	const scripts = compiled.ir.syntax.filter((node) => node.kind === "script");
	const styles = compiled.ir.syntax.filter((node) => node.kind === "style");
	const kind = componentKindFromIR(compiled.ir);
	const directory =
		kind === "section" ? "sections" : kind === "block" ? "blocks" : "snippets";
	return {
		files: [
			{
				path: `${directory}/${options.name}.liquid`,
				contents: emitLiquid(source, compiled, options, kind, {
					hasScript: scripts.length > 0,
					hasStyle: styles.length > 0,
				}),
			},
		],
		issues: [],
	};
}

export function emitCssFiles(
	compiled: CompiledComponent,
	options: EmitThemeOptions,
): EmitResult {
	const styles = compiled.ir.syntax.filter((node) => node.kind === "style");
	if (styles.length === 0) return { files: [], issues: [] };

	// Bound sheets (css modules) scope by class rewrite; unbound sheets pass
	// through untouched, as vanilla Shopify would.
	const css = styles
		.map((style) =>
			style.bindingName
				? rewriteCssClasses(style.source, (className) =>
						scopedClassName(options.name, className),
					)
				: style.source,
		)
		.join("\n\n");

	return {
		files: [{ path: `assets/${options.name}.css`, contents: `${css}\n` }],
		issues: [],
	};
}

export function emitScriptFiles(
	compiled: CompiledComponent,
	options: EmitThemeOptions,
): EmitResult {
	const scripts = compiled.ir.syntax.filter((node) => node.kind === "script");
	if (scripts.length === 0) return { files: [], issues: [] };

	const placedBehaviors = new Set(
		compiled.ir.syntax
			.filter((node) => node.kind === "island-placement")
			.map((node) => node.name),
	);
	const componentScript = emitComponentScript(
		scripts,
		compiled.ast.file,
		options,
		dataDescriptor(compiled.ir),
		placedBehaviors,
	);

	return {
		files: [
			{ path: `assets/${options.name}.js`, contents: componentScript.contents },
			{ path: "assets/nazare-runtime.js", contents: runtimeSource },
		],
		issues: componentScript.issues,
	};
}

function emitLiquid(
	source: string,
	compiled: CompiledComponent,
	options: EmitThemeOptions,
	kind: ComponentKind,
	{ hasScript, hasStyle }: { hasScript: boolean; hasStyle: boolean },
): string {
	const edits: SourceEdit[] = [];
	const snippetNamesByLocalName = new Map<string, string>();
	const argumentsById = new Map<Id, PropArgumentSyntaxNode>();
	const expressionsById = new Map<Id, string>();
	const hoistedBySiteId = new Map<Id, HoistedSetting[]>();
	for (const setting of resolveHoistedSettings(compiled.ir, compiled.contracts)
		.hoisted) {
		const bucket = hoistedBySiteId.get(setting.renderSiteId);
		if (bucket) bucket.push(setting);
		else hoistedBySiteId.set(setting.renderSiteId, [setting]);
	}

	for (const node of compiled.ir.syntax) {
		if (node.kind === "import") {
			// The imported file's own build emits snippets/<basename>.liquid.
			snippetNamesByLocalName.set(node.localName, baseNameOf(node.path));
		}
		if (node.kind === "prop-argument") argumentsById.set(node.id, node);
		if (node.kind === "expression") expressionsById.set(node.id, node.source);
	}

	for (const node of compiled.ast.nodes) {
		if (
			node.type === "NazareComponent" ||
			node.type === "NazareProps" ||
			node.type === "NazareImport" ||
			node.type === "NazareAssetImport" ||
			node.type === "NazareScript" ||
			node.type === "NazareStyle"
		) {
			edits.push({ ...editRange(source, node.span), replacement: "" });
		}
		if (node.type === "NazareBlocks") {
			edits.push({
				...editRange(source, node.span),
				replacement: "{% content_for 'blocks' %}",
			});
		}
	}

	for (const node of compiled.ir.syntax) {
		if (node.kind === "element-ref" && node.span) {
			edits.push({
				...editRange(source, node.span),
				replacement: `data-nz-ref="${node.name}"`,
			});
		}
		if (node.kind === "island-placement" && node.span) {
			edits.push({
				...editRange(source, node.span),
				replacement: `data-nz-island="${node.name}"`,
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
						kind === "section"
							? `section.settings.${setting.settingId}`
							: kind === "block"
								? `block.settings.${setting.settingId}`
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

	// data-nz-component is only the island mount hook now — styles scope by
	// class rewrite and need no root attribute.
	if (hasScript || kind === "block") {
		const root = rootElement(source, compiled.ast);
		if (root) {
			if (root.marker) {
				edits.push({ ...root.marker, replacement: "" });
			}
			const stamps = [
				...(hasScript ? [` data-nz-component="${options.name}"`] : []),
				// The editor needs this to map a block instance to its DOM.
				...(kind === "block" ? [" {{ block.shopify_attributes }}"] : []),
			];
			edits.push({
				start: root.tagEnd,
				end: root.tagEnd,
				replacement: stamps.join(""),
			});
		}
	}

	let liquid = applyEdits(source, edits);
	liquid = lowerPropsReads(liquid, compiled.ir, kind);
	liquid = lowerStyleReads(liquid, compiled.ir, options.name);
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

	if (kind === "section" || kind === "block") {
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
				`  ${entry.settingId} <- prop "${entry.sourcePropName}" of ${entry.sourcePath} (via ${entry.alias})`,
			);
		}
	}
	return `{%- comment -%}\n${lines.join("\n")}\n{%- endcomment -%}\n`;
}

type RootElement = {
	tagEnd: number;
	tagName: string;
	topLevelCount: number;
	markerCount: number;
	marker?: { start: number; end: number };
};

/** Explicit nz-root if present, otherwise the first top-level element. */
function rootElement(source: string, ast: NazareAst): RootElement | undefined {
	let first: RootElement | undefined;
	let explicit: RootElement | undefined;
	let count = 0;
	let markerCount = 0;

	for (const node of ast.liquidAst.children) {
		if (!isHtmlElementLike(node)) continue;
		count += 1;

		const candidate = rootElementCandidate(source, node);
		if (candidate.marker) markerCount += 1;
		first ??= candidate;
		if (candidate.marker && !explicit) explicit = candidate;
	}

	const selected = explicit ?? first;
	if (!selected) return undefined;
	return {
		...selected,
		markerCount,
		// Explicit marker resolves the root intentionally; multiple top-level
		// elements are no longer ambiguous for runtime stamping.
		topLevelCount: explicit ? 1 : count,
	};
}

function isHtmlElementLike(
	node: NazareAst["liquidAst"]["children"][number],
): boolean {
	return (
		node.type === NodeTypes.HtmlElement ||
		node.type === NodeTypes.HtmlVoidElement ||
		node.type === NodeTypes.HtmlSelfClosingElement
	);
}

function rootElementCandidate(source: string, node: unknown): RootElement {
	const tagEnd = (node as { blockStartPosition: { end: number } })
		.blockStartPosition.end;
	const name = (node as { name?: unknown }).name;
	const tagName =
		typeof name === "string"
			? name
			: Array.isArray(name) &&
					typeof (name[0] as { value?: unknown })?.value === "string"
				? String((name[0] as { value: string }).value)
				: "unknown";
	return {
		tagEnd: source[tagEnd - 2] === "/" ? tagEnd - 2 : tagEnd - 1,
		tagName,
		topLevelCount: 0,
		markerCount: 0,
		marker: rootMarkerRange(source, node),
	};
}

function rootMarkerRange(
	source: string,
	node: unknown,
): { start: number; end: number } | undefined {
	for (const attribute of (node as { attributes?: unknown[] }).attributes ??
		[]) {
		if (!isAttributeLike(attribute)) continue;
		if (attributeName(attribute) !== "nz-root") continue;
		let start = attribute.position.start;
		while (start > 0 && /[ \t]/.test(source[start - 1])) start -= 1;
		return { start, end: attribute.position.end };
	}
	return undefined;
}

function isAttributeLike(attribute: unknown): attribute is {
	type: string;
	name: { type: string; value?: unknown }[];
	position: { start: number; end: number };
} {
	return (
		typeof attribute === "object" &&
		attribute !== null &&
		"type" in attribute &&
		"name" in attribute &&
		"position" in attribute
	);
}

function attributeName(attribute: {
	name: { type: string; value?: unknown }[];
}): string | undefined {
	let text = "";
	for (const part of attribute.name) {
		if (part.type !== NodeTypes.TextNode || typeof part.value !== "string") {
			return undefined;
		}
		text += part.value;
	}
	return text;
}

/** Descriptor telling the runtime how to parse each ref's data-* strings. */
function dataDescriptor(
	ir: ArtifactIR,
): Record<string, Record<string, string>> {
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
	componentFile: string,
	options: EmitThemeOptions,
	descriptor: Record<string, Record<string, string>>,
	placedBehaviors: Set<string>,
): { contents: string; issues: Diagnostic[] } {
	const issues: Diagnostic[] = [];
	const componentDir = directoryOf(componentFile);

	// Each behavior registers separately so declaration order is mount order
	// and one default export cannot clobber another.
	const registrations = scripts.map((script, index) => {
		// Imported behaviors bundle under their own path; inline scripts get a
		// synthetic entry beside the component so relative imports resolve.
		const entryFile =
			script.bodySpan && script.bodySpan.file !== componentFile
				? script.bodySpan.file
				: `${componentDir ? `${componentDir}/` : ""}inline-${index + 1}.ts`;

		const bundle = bundleScript(script.source, entryFile, options.readFile);
		issues.push(...bundle.issues);

		// A placed behavior (island="name") mounts on its subtree; everything
		// else mounts on the component root.
		const placement =
			script.bindingName && placedBehaviors.has(script.bindingName)
				? JSON.stringify(script.bindingName)
				: "null";
		return `window.Nazare.register(${JSON.stringify(options.name)}, ${placement}, ${bundle.code}, __data);`;
	});

	return {
		contents: [
			`/* Generated by Nazare. Component: ${options.name} */`,
			"(function () {",
			'  "use strict";',
			"  var island = window.Nazare.island;",
			`  var __data = ${JSON.stringify(descriptor)};`,
			...registrations.map((registration) => indent(registration, "  ")),
			"})();",
			"",
		].join("\n"),
		issues,
	};
}

function editRange(
	source: string,
	span:
		| {
				start: { line: number; column: number };
				end: { line: number; column: number };
		  }
		| undefined,
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
  function mountRoots(componentRoot, placement) {
    if (!placement) return [componentRoot];
    var targets = [];
    if (componentRoot.getAttribute("data-nz-island") === placement) {
      targets.push(componentRoot);
    }
    var placed = componentRoot.querySelectorAll(
      '[data-nz-island="' + placement + '"]'
    );
    placed.forEach(function (element) { targets.push(element); });
    return targets;
  }
  function mount(name, placement, setup, descriptor) {
    var componentRoots = document.querySelectorAll(
      '[data-nz-component="' + name + '"]'
    );
    componentRoots.forEach(function (componentRoot) {
      mountRoots(componentRoot, placement).forEach(function (root) {
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
    });
  }
  function register(name, placement, setup, descriptor) {
    if (typeof setup !== "function") return;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        mount(name, placement, setup, descriptor);
      });
    } else {
      mount(name, placement, setup, descriptor);
    }
  }
  window.Nazare = { island: island, register: register, mount: mount };
})();
`;
