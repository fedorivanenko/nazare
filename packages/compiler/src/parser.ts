// Parse pass: runs Shopify's tolerant LiquidHTML parser, then walks the tree
// once to lift Nazare tags into NazareNodes (see ast.ts). Owns only surface
// syntax concerns — tag markup shapes, spans, and which Liquid constructs are
// not yet lowered (control flow, HTML). No symbols, no types beyond what the
// props DSL literally declares.
import type { SourceSpan } from "@nazare/core";
import {
	type LiquidHtmlNode,
	NodeTypes,
	toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import type {
	AuthoredSchema,
	NazareAssetImportNode,
	NazareAst,
	NazareDataBinding,
	NazareImportNode,
	NazareNode,
	NazarePassedProp,
	NazarePropDeclaration,
	NazareReferenceNode,
	NazareScriptNode,
	NazareStyleNode,
} from "./ast.js";
import {
	controlFlowNotLowered,
	htmlNotPromoted,
	importBareSpecifier,
	importBindingCase,
	importComponentCase,
	importOutsideProject,
	importUnsupportedExtension,
	parseDuplicateComponent,
	parseDuplicateImport,
	parseDuplicatePropDeclaration,
	parseDuplicateRenderArgument,
	parseInvalidBlocksSlot,
	parseInvalidComponentKind,
	parseInvalidImport,
	parseInvalidRefAttribute,
	parseInvalidRender,
	parseInvalidStylesheetBinding,
	parseInvalidTypeExpression,
	parseMalformedPropDeclaration,
	parseMalformedRenderArgument,
	parseUnclosedRawBlock,
} from "./diagnostics.js";
import { isRelativeSpecifier, resolveImportPath } from "./paths.js";
import { type LiquidRegion, scanRegionReferences } from "./references.js";
import { scanScript } from "./script-scan.js";
import { scanSettingsReadsFromLiquidAst } from "./settings-reads.js";
import { spanFromOffsets } from "./source.js";
import { parseTypeExpression } from "./type-expression.js";

const importPattern = /^([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']$/;
const renderPattern = /^([A-Za-z_$][\w$]*)\s*\{([\s\S]*)\}$/;
const scriptOpenTagPattern = /{%-?\s*script\b([^%]*?)-?%}/g;
const styleOpenTagPattern = /{%-?\s*stylesheet\b([^%]*?)-?%}/g;
const refIdentifierPattern = /^[A-Za-z_$][\w$]*$/;

type SourceRange = { start: number; end: number };

type LiquidTagLike = LiquidHtmlNode & {
	name?: unknown;
	markup?: unknown;
	position: SourceRange;
};

type UnsupportedSyntaxCategory = "control-flow" | "html";

export function parseNazareLiquid(source: string, file: string): NazareAst {
	const nodes: NazareNode[] = [];
	const diagnostics: NazareAst["diagnostics"] = [];
	const unsupportedSyntax = new Map<
		UnsupportedSyntaxCategory,
		LiquidHtmlNode
	>();
	const controlFlowRanges: SourceRange[] = [];

	// Script and stylesheet bodies are TS/CSS, which the HTML parser would
	// misread (comparisons look like open tags). Extract them first, then
	// blank each block — newlines kept — so every other span stays valid.
	const scriptExtraction = extractScriptBlocks(source, file, diagnostics);
	nodes.push(...scriptExtraction.scripts);
	const styleExtraction = extractStyleBlocks(
		scriptExtraction.blankedSource,
		source,
		file,
		diagnostics,
	);
	nodes.push(...styleExtraction.styles);

	let ast: ReturnType<typeof toLiquidHtmlAST>;
	try {
		ast = toLiquidHtmlAST(styleExtraction.blankedSource, {
			mode: "tolerant",
			allowUnclosedDocumentNode: true,
		});
	} catch (error) {
		// Broken Liquid is a diagnostic, not a crash: report it and continue
		// with an empty document (scripts/styles were already extracted).
		diagnostics.push(parseLiquidError(error, source, file));
		ast = toLiquidHtmlAST("", {
			mode: "tolerant",
			allowUnclosedDocumentNode: true,
		});
	}

	walk(ast, (node) => {
		collectUnsupportedSyntax(node, unsupportedSyntax);
		collectControlFlowRange(node, controlFlowRanges);
		collectElementAttributes(node, source, file, nodes, diagnostics);
	});

	let componentDeclared = false;
	const importLocalNames = new Set<string>();

	walk(ast, (node) => {
		if (node.type !== NodeTypes.LiquidTag) return;

		const tag = node as LiquidTagLike;
		if (typeof tag.name !== "string") return;

		const span = spanFromOffsets(source, file, tag.position);

		if (tag.name === "render") {
			const render = parseNazareRenderTag(
				tag,
				source,
				file,
				span,
				controlFlowRanges,
				diagnostics,
			);
			if (render) nodes.push(render);
			return;
		}

		if (typeof tag.markup !== "string") return;

		if (tag.name === "component") {
			const markup = tag.markup.trim();
			if (markup !== "section" && markup !== "block" && markup !== "snippet") {
				diagnostics.push(parseInvalidComponentKind(markup, span));
				return;
			}
			if (componentDeclared) {
				diagnostics.push(parseDuplicateComponent(span));
				return;
			}
			componentDeclared = true;
			nodes.push({ type: "NazareComponent", componentKind: markup, span });
			return;
		}

		if (tag.name === "import") {
			const importNode = parseNazareImportTag(
				tag.markup,
				file,
				span,
				diagnostics,
			);
			if (importNode) {
				if (importLocalNames.has(importNode.localName)) {
					diagnostics.push(parseDuplicateImport(importNode.localName, span));
				} else {
					importLocalNames.add(importNode.localName);
				}
				nodes.push(importNode);
			}
			return;
		}

		if (tag.name === "props") {
			nodes.push({
				type: "NazareProps",
				props: parseProps(
					tag.markup,
					source,
					file,
					tag.position.start,
					diagnostics,
				),
				span,
			});
			return;
		}

		if (tag.name === "blocks") {
			const markup = tag.markup.trim();
			const blockNames: string[] = [];
			let valid = true;
			if (markup.length > 0) {
				for (const part of markup.split(",")) {
					const name = part.trim();
					if (!isIdentifier(name)) {
						valid = false;
						break;
					}
					blockNames.push(name);
				}
			}
			if (!valid) {
				diagnostics.push(parseInvalidBlocksSlot(tag.markup, span));
				return;
			}
			nodes.push({ type: "NazareBlocks", blockNames, span });
			return;
		}
	});

	// props.x / styles.class references are located from Liquid expression
	// regions once the style bindings are known, so emit can lower them by
	// span instead of textually (see references.ts).
	nodes.push(...collectReferences(ast, source, file, nodes));

	// What Nazare did not model (control flow, HTML) is a note, not a
	// diagnostic — a separate channel, never mixed into issues.
	const notes = unsupportedSyntaxDiagnostics(unsupportedSyntax, source, file);

	// Scripts/styles are extracted before the walk, so restore source order —
	// declaration order is meaningful (it is mount order for behaviors).
	nodes.sort(
		(a, b) =>
			a.span.start.line - b.span.start.line ||
			a.span.start.column - b.span.start.column,
	);

	const schema = extractAuthoredSchema(ast, source, file);
	const settingsScan = scanSettingsReadsFromLiquidAst(ast, source, file);
	diagnostics.push(...settingsScan.diagnostics);
	const settingsReads = settingsScan.reads;

	return {
		file,
		liquidAst: ast,
		nodes,
		settingsReads,
		schema,
		diagnostics,
		notes,
	};
}

type RawBlockLanguage = "script" | "style";

type RawBlockLanguageRules = {
	name: RawBlockLanguage;
	supportsTemplateLiterals: boolean;
	supportsLineComments: boolean;
	supportsRegexLiterals: boolean;
	tracksPreviousTokenForRegex: boolean;
};

// Raw block lexer only models syntax that can hide a Liquid closing tag.
// Script bodies need JavaScript template literals, line comments, and regex
// literals. Stylesheet bodies need CSS strings and block comments only.
const scriptRawBlockRules: RawBlockLanguageRules = {
	name: "script",
	supportsTemplateLiterals: true,
	supportsLineComments: true,
	supportsRegexLiterals: true,
	tracksPreviousTokenForRegex: true,
};

const styleRawBlockRules: RawBlockLanguageRules = {
	name: "style",
	supportsTemplateLiterals: false,
	supportsLineComments: false,
	supportsRegexLiterals: false,
	tracksPreviousTokenForRegex: false,
};

type RawBlockMatch = {
	blockStart: number;
	bodyStart: number;
	markup: string;
	body: string;
	block: string;
};

type UnclosedRawBlock = {
	blockStart: number;
	bodyStart: number;
};

type RawBlockScan = {
	blocks: RawBlockMatch[];
	unclosed?: UnclosedRawBlock;
};

// Raw blocks contain TS/CSS, so the closing Liquid tag must be found with a
// lexical scan that ignores tag-looking text inside strings and comments.
function extractRawBlocks(
	source: string,
	openTagPattern: RegExp,
	closeTagName: "endscript" | "endstylesheet",
	rules: RawBlockLanguageRules,
): RawBlockScan {
	const blocks: RawBlockMatch[] = [];
	openTagPattern.lastIndex = 0;

	let match = openTagPattern.exec(source);
	while (match) {
		const openTag = match[0];
		const markup = match[1];
		const blockStart = match.index;
		const bodyStart = blockStart + openTag.length;
		const closingTag = findRawBlockClosingTag(
			source,
			bodyStart,
			closeTagName,
			rules,
		);
		if (!closingTag) {
			return { blocks, unclosed: { blockStart, bodyStart } };
		}

		blocks.push({
			blockStart,
			bodyStart,
			markup,
			body: source.slice(bodyStart, closingTag.start),
			block: source.slice(blockStart, closingTag.end),
		});
		openTagPattern.lastIndex = closingTag.end;
		match = openTagPattern.exec(source);
	}

	return { blocks };
}

function findRawBlockClosingTag(
	source: string,
	start: number,
	closeTagName: "endscript" | "endstylesheet",
	rules: RawBlockLanguageRules,
): SourceRange | undefined {
	let state:
		| "code"
		| "single"
		| "double"
		| "template"
		| "line"
		| "block"
		| "regex" = "code";
	let previousToken: string | undefined;
	let escaped = false;

	for (let index = start; index < source.length; index++) {
		const char = source[index];
		const next = source[index + 1];

		if (state === "code") {
			const closingTag = matchLiquidClosingTagAt(source, index, closeTagName);
			if (closingTag) return { start: index, end: closingTag };

			if (char === "'") {
				state = "single";
				continue;
			}
			if (char === '"') {
				state = "double";
				continue;
			}
			if (rules.supportsTemplateLiterals && char === "`") {
				state = "template";
				continue;
			}
			if (char === "/" && next === "*") {
				state = "block";
				index++;
				continue;
			}
			if (rules.supportsLineComments && char === "/" && next === "/") {
				state = "line";
				index++;
				continue;
			}
			if (
				rules.supportsRegexLiterals &&
				char === "/" &&
				mayStartRegexLiteral(previousToken)
			) {
				state = "regex";
				continue;
			}
			if (rules.tracksPreviousTokenForRegex) {
				const identifier = readIdentifierAt(source, index);
				if (identifier) {
					previousToken = identifier;
					index += identifier.length - 1;
					continue;
				}
				if (!/\s/.test(char)) previousToken = char;
			}
			continue;
		}

		if (state === "line") {
			if (char === "\n" || char === "\r") state = "code";
			continue;
		}

		if (state === "block") {
			if (char === "*" && next === "/") {
				state = "code";
				index++;
			}
			continue;
		}

		if (
			state === "single" ||
			state === "double" ||
			state === "template" ||
			state === "regex"
		) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (
				(state === "single" && char === "'") ||
				(state === "double" && char === '"') ||
				(state === "template" && char === "`") ||
				(state === "regex" && char === "/")
			) {
				const closedState = state;
				state = "code";
				previousToken = closedState === "regex" ? "/" : "literal";
			}
		}
	}

	return undefined;
}

function matchLiquidClosingTagAt(
	source: string,
	index: number,
	closeTagName: "endscript" | "endstylesheet",
): number | undefined {
	const match = source
		.slice(index)
		.match(new RegExp(`^\\{%-?\\s*${closeTagName}\\s*-?%}`));
	return match ? index + match[0].length : undefined;
}

function readIdentifierAt(source: string, index: number): string | undefined {
	const match = source.slice(index).match(/^[A-Za-z_$][\w$]*/);
	return match?.[0];
}

const regexPrefixOperators = "([{=,:;!&|?+-*~^<>";
const regexPrefixKeywords =
	/^(return|throw|case|delete|void|typeof|instanceof|in|of|yield|await)$/;

function mayStartRegexLiteral(previousToken: string | undefined): boolean {
	return (
		previousToken === undefined ||
		regexPrefixOperators.includes(previousToken) ||
		regexPrefixKeywords.test(previousToken)
	);
}

function blankPreservingNewlines(
	source: string,
	start: number,
	end: number,
): string {
	return (
		source.slice(0, start) +
		source.slice(start, end).replace(/[^\n]/g, " ") +
		source.slice(end)
	);
}

function reportUnclosedRawBlock(
	diagnostics: NazareAst["diagnostics"],
	source: string,
	file: string,
	blockName: "script" | "stylesheet",
	closingTagName: "endscript" | "endstylesheet",
	block: UnclosedRawBlock,
): void {
	diagnostics.push(
		parseUnclosedRawBlock(
			blockName,
			closingTagName,
			spanFromOffsets(source, file, {
				start: block.blockStart,
				end: block.bodyStart,
			}),
		),
	);
}

function extractScriptBlocks(
	source: string,
	file: string,
	diagnostics: NazareAst["diagnostics"],
): { scripts: NazareScriptNode[]; blankedSource: string } {
	const scripts: NazareScriptNode[] = [];
	let blankedSource = source;
	const rawBlockScan = extractRawBlocks(
		source,
		scriptOpenTagPattern,
		"endscript",
		scriptRawBlockRules,
	);

	if (rawBlockScan.unclosed) {
		reportUnclosedRawBlock(
			diagnostics,
			source,
			file,
			"script",
			"endscript",
			rawBlockScan.unclosed,
		);
		blankedSource = blankPreservingNewlines(
			blankedSource,
			rawBlockScan.unclosed.blockStart,
			source.length,
		);
	}

	for (const match of rawBlockScan.blocks) {
		const { block, markup, body, blockStart, bodyStart } = match;
		const scan = scanScript(body);

		scripts.push({
			type: "NazareScript",
			lang: /\blang\s*=\s*["']?js["']?/.test(markup) ? "js" : "ts",
			source: body,
			refAccesses: scan.refAccesses.map((access) => ({
				name: access.name,
				span: spanFromOffsets(source, file, {
					start: bodyStart + access.start,
					end: bodyStart + access.end,
				}),
			})),
			dataAccesses: scan.dataAccesses.map((access) => ({
				ref: access.ref,
				property: access.property,
				span: spanFromOffsets(source, file, {
					start: bodyStart + access.start,
					end: bodyStart + access.end,
				}),
			})),
			span: spanFromOffsets(source, file, {
				start: blockStart,
				end: blockStart + block.length,
			}),
			bodySpan: spanFromOffsets(source, file, {
				start: bodyStart,
				end: bodyStart + body.length,
			}),
		});

		blankedSource = blankPreservingNewlines(
			blankedSource,
			blockStart,
			blockStart + block.length,
		);
	}

	return { scripts, blankedSource };
}

function liquidTagMarkup(
	source: string,
	position: SourceRange,
	name: string,
): string {
	const raw = source.slice(position.start, position.end);
	return raw
		.replace(new RegExp(`^\\s*\\{%-?\\s*${name}\\b`), "")
		.replace(/-?%}\s*$/, "")
		.trim();
}

function parseNazareRenderTag(
	tag: LiquidTagLike,
	source: string,
	file: string,
	span: SourceSpan,
	controlFlowRanges: SourceRange[],
	diagnostics: NazareAst["diagnostics"],
): NazareNode | undefined {
	const markup = liquidTagMarkup(source, tag.position, "render");
	const match = markup.match(renderPattern);
	if (!match) {
		if (/^[A-Z][\w$]*\b/.test(markup)) {
			diagnostics.push(parseInvalidRender(markup, span));
		}
		return undefined;
	}

	const bodyOffset = source.indexOf(match[2], tag.position.start);
	return {
		type: "NazareRender",
		target: match[1],
		props: parsePassedProps(
			match[2],
			source,
			file,
			bodyOffset >= 0 ? bodyOffset : tag.position.start,
			diagnostics,
		),
		reachability: isInsideControlFlow(tag.position, controlFlowRanges)
			? "conditional-unmodeled"
			: "unconditional",
		span,
	};
}

function parseNazareImportTag(
	markup: string,
	file: string,
	span: SourceSpan,
	diagnostics: NazareAst["diagnostics"],
): NazareImportNode | NazareAssetImportNode | undefined {
	const match = markup.trim().match(importPattern);
	if (!match) {
		diagnostics.push(parseInvalidImport(markup, span));
		return undefined;
	}
	const [, localName, specifier] = match;

	if (!isRelativeSpecifier(specifier)) {
		diagnostics.push(importBareSpecifier(specifier, span));
		return undefined;
	}
	const path = resolveImportPath(file, specifier);
	if (path === undefined) {
		diagnostics.push(importOutsideProject(specifier, span));
		return undefined;
	}

	if (specifier.endsWith(".nz.liquid")) {
		if (!/^[A-Z]/.test(localName)) {
			diagnostics.push(importComponentCase(localName, span));
			return undefined;
		}
		return { type: "NazareImport", localName, path, span };
	}

	if (/\.(ts|js|css)$/.test(specifier)) {
		if (/^[A-Z]/.test(localName)) {
			diagnostics.push(importBindingCase(localName, span));
			return undefined;
		}
		return { type: "NazareAssetImport", localName, path, span };
	}

	diagnostics.push(importUnsupportedExtension(specifier, span));
	return undefined;
}

function parseLiquidError(
	error: unknown,
	_source: string,
	file: string,
): NazareAst["diagnostics"][number] {
	const loc = (error as { loc?: { start?: { line: number; column: number } } })
		.loc;
	const start = loc?.start ?? { line: 1, column: 1 };
	return {
		severity: "error",
		code: "NAZARE_PARSE_LIQUID",
		message: `Liquid parse error: ${error instanceof Error ? error.message : String(error)}`,
		span: { file, start, end: start },
	};
}

function extractAuthoredSchema(
	ast: ReturnType<typeof toLiquidHtmlAST>,
	source: string,
	file: string,
): AuthoredSchema | undefined {
	for (const node of ast.children) {
		if (node.type !== NodeTypes.LiquidRawTag || node.name !== "schema") {
			continue;
		}
		return {
			source: node.body.value,
			span: spanFromOffsets(source, file, node.position),
		};
	}
	return undefined;
}

function extractStyleBlocks(
	scanSource: string,
	originalSource: string,
	file: string,
	diagnostics: NazareAst["diagnostics"],
): { styles: NazareStyleNode[]; blankedSource: string } {
	const styles: NazareStyleNode[] = [];
	let blankedSource = scanSource;
	const rawBlockScan = extractRawBlocks(
		scanSource,
		styleOpenTagPattern,
		"endstylesheet",
		styleRawBlockRules,
	);

	if (rawBlockScan.unclosed) {
		reportUnclosedRawBlock(
			diagnostics,
			originalSource,
			file,
			"stylesheet",
			"endstylesheet",
			rawBlockScan.unclosed,
		);
		blankedSource = blankPreservingNewlines(
			blankedSource,
			rawBlockScan.unclosed.blockStart,
			scanSource.length,
		);
	}

	for (const match of rawBlockScan.blocks) {
		const { block, markup, body, blockStart, bodyStart } = match;
		const span = spanFromOffsets(originalSource, file, {
			start: blockStart,
			end: blockStart + block.length,
		});

		// {% stylesheet styles %} binds the sheet's class map (a css module);
		// a bare {% stylesheet %} passes through unscoped, as vanilla Shopify.
		let bindingName: string | undefined;
		const trimmedMarkup = markup.trim();
		if (trimmedMarkup.length > 0) {
			if (!refIdentifierPattern.test(trimmedMarkup)) {
				diagnostics.push(parseInvalidStylesheetBinding(trimmedMarkup, span));
			} else if (/^[A-Z]/.test(trimmedMarkup)) {
				diagnostics.push(importBindingCase(trimmedMarkup, span));
				bindingName = trimmedMarkup;
			} else {
				bindingName = trimmedMarkup;
			}
		}

		styles.push({
			type: "NazareStyle",
			source: originalSource.slice(bodyStart, bodyStart + body.length),
			bindingName,
			span,
			bodySpan: spanFromOffsets(originalSource, file, {
				start: bodyStart,
				end: bodyStart + body.length,
			}),
		});

		blankedSource = blankPreservingNewlines(
			blankedSource,
			blockStart,
			blockStart + block.length,
		);
	}

	return { styles, blankedSource };
}

function collectElementAttributes(
	node: LiquidHtmlNode,
	source: string,
	file: string,
	nodes: NazareNode[],
	diagnostics: NazareAst["diagnostics"],
): void {
	if (
		node.type !== NodeTypes.HtmlElement &&
		node.type !== NodeTypes.HtmlVoidElement &&
		node.type !== NodeTypes.HtmlSelfClosingElement
	) {
		return;
	}

	for (const attribute of node.attributes) {
		if (
			attribute.type !== NodeTypes.AttrDoubleQuoted &&
			attribute.type !== NodeTypes.AttrSingleQuoted &&
			attribute.type !== NodeTypes.AttrUnquoted &&
			attribute.type !== NodeTypes.AttrEmpty
		) {
			continue;
		}
		const attributeName = staticText(attribute.name);
		if (
			attributeName !== "ref" &&
			attributeName !== "island" &&
			attributeName !== "nz-root"
		) {
			continue;
		}

		const span = spanFromOffsets(source, file, attribute.position);
		if (attributeName === "nz-root") {
			nodes.push({
				type: "NazareRootMarker",
				tagName: elementTagName(node),
				span,
			});
			continue;
		}

		const value =
			attribute.type === NodeTypes.AttrEmpty
				? undefined
				: staticText(attribute.value);

		if (value === undefined) {
			diagnostics.push(
				parseInvalidRefAttribute(
					`${attributeName} value must be a static string, not Liquid output`,
					span,
				),
			);
			continue;
		}
		if (!refIdentifierPattern.test(value)) {
			diagnostics.push(
				parseInvalidRefAttribute(
					`${attributeName} value "${value}" is not a valid identifier`,
					span,
				),
			);
			continue;
		}

		if (attributeName === "island") {
			nodes.push({
				type: "NazareIsland",
				name: value,
				tagName: elementTagName(node),
				span,
			});
			continue;
		}

		nodes.push({
			type: "NazareElementRef",
			name: value,
			tagName: elementTagName(node),
			dataBindings: collectDataBindings(node, source, file),
			span,
		});
	}
}

/**
 * data-* attributes on a ref'd element whose value is a single {{ expr }}
 * output become typed data bindings; static or mixed values stay plain HTML.
 */
function collectDataBindings(
	node: LiquidHtmlNode & { attributes?: unknown },
	source: string,
	file: string,
): NazareDataBinding[] {
	type AttributeLike = {
		type: string;
		name: { type: string; value?: unknown }[];
		value: { type: string; position: SourceRange }[];
		position: SourceRange;
	};
	const bindings: NazareDataBinding[] = [];
	const attributes = (
		Array.isArray(node.attributes) ? node.attributes : []
	) as AttributeLike[];

	for (const attribute of attributes) {
		if (
			attribute.type !== NodeTypes.AttrDoubleQuoted &&
			attribute.type !== NodeTypes.AttrSingleQuoted &&
			attribute.type !== NodeTypes.AttrUnquoted
		) {
			continue;
		}
		const attributeName = staticText(attribute.name);
		if (!attributeName?.startsWith("data-") || attributeName === "data-nz-ref")
			continue;

		const values = attribute.value;
		if (
			values.length !== 1 ||
			values[0].type !== NodeTypes.LiquidVariableOutput
		) {
			continue;
		}

		const raw = source.slice(values[0].position.start, values[0].position.end);
		const expression = raw
			.match(/^\s*{{-?\s*([\s\S]*?)\s*-?}}\s*$/)?.[1]
			?.trim();
		if (!expression) continue;

		const suffix = attributeName.slice("data-".length);
		bindings.push({
			attribute: suffix,
			property: suffix.replace(/-([a-z])/g, (_, letter: string) =>
				letter.toUpperCase(),
			),
			expression,
			span: spanFromOffsets(source, file, attribute.position),
		});
	}

	return bindings;
}

/** Joined text of a name/value node list, or undefined when any part is Liquid. */
function staticText(
	parts: { type: string; value?: unknown }[] | undefined,
): string | undefined {
	if (!parts || parts.length === 0) return undefined;
	let text = "";
	for (const part of parts) {
		if (part.type !== NodeTypes.TextNode || typeof part.value !== "string") {
			return undefined;
		}
		text += part.value;
	}
	return text;
}

function elementTagName(node: LiquidHtmlNode): string {
	const name = (node as { name?: unknown }).name;
	if (typeof name === "string") return name;
	if (Array.isArray(name)) return staticText(name) ?? "unknown";
	return "unknown";
}

// Tags whose markup never carries a props/style read (structural Nazare tags
// and the schema/comment raw blocks). Everything else — output tags, control
// flow, render, assign/echo — is scanned for references.
const nonReferenceTags = new Set([
	"component",
	"import",
	"props",
	"blocks",
	"schema",
	"comment",
	"endcomment",
]);

/**
 * Locates every props/style reference in the file's Liquid expression
 * regions. Style binding names come from the already-collected style nodes
 * and css imports, so this runs after the main walk.
 */
function collectReferences(
	ast: ReturnType<typeof toLiquidHtmlAST>,
	source: string,
	file: string,
	nodes: NazareNode[],
): NazareReferenceNode[] {
	const styleBindings = new Set<string>();
	for (const node of nodes) {
		if (node.type === "NazareStyle" && node.bindingName) {
			styleBindings.add(node.bindingName);
		}
		if (node.type === "NazareAssetImport" && node.path.endsWith(".css")) {
			styleBindings.add(node.localName);
		}
	}

	// A block tag and its first branch share the same {% … %} opening, so the
	// same token is scanned twice; a source span is one location, so dedupe.
	const references: NazareReferenceNode[] = [];
	const seen = new Set<string>();
	walk(ast, (node) => {
		const region = liquidRegion(node, source);
		if (!region) return;
		for (const raw of scanRegionReferences(region, styleBindings)) {
			const key = `${raw.start}:${raw.end}`;
			if (seen.has(key)) continue;
			seen.add(key);
			references.push({
				type: "NazareReference",
				target: raw.target,
				binding: raw.binding,
				name: raw.name,
				form: raw.form,
				span: spanFromOffsets(source, file, {
					start: raw.start,
					end: raw.end,
				}),
			});
		}
	});
	return references;
}

/** The source range of a structured tag markup (a Liquid condition), if any. */
function markupPosition(
	markup: unknown,
): { start: number; end: number } | undefined {
	const position = (markup as { position?: unknown } | undefined)?.position;
	if (
		position &&
		typeof (position as SourceRange).start === "number" &&
		typeof (position as SourceRange).end === "number"
	) {
		return position as SourceRange;
	}
	return undefined;
}

/** The scannable Liquid region for a node, or undefined if there is none. */
function liquidRegion(
	node: LiquidHtmlNode,
	source: string,
): LiquidRegion | undefined {
	if (node.type === NodeTypes.LiquidVariableOutput) {
		const position = (node as LiquidTagLike).position;
		const raw = source.slice(position.start, position.end);
		const match = raw.match(/^\s*{{-?\s*([\s\S]*?)\s*-?}}\s*$/);
		const inner = match?.[1];
		if (!inner) return undefined;
		return {
			kind: "output",
			inner,
			innerOffset: position.start + raw.indexOf(inner),
			outputStart: position.start,
			outputEnd: position.end,
		};
	}

	if (
		node.type === NodeTypes.LiquidTag ||
		node.type === NodeTypes.LiquidBranch
	) {
		const tag = node as LiquidTagLike & { markup?: unknown };
		if (typeof tag.name === "string" && nonReferenceTags.has(tag.name)) {
			return undefined;
		}
		// Leaf tags (render, assign, echo) expose their markup as a string.
		if (typeof tag.markup === "string") {
			if (tag.markup.length === 0) return undefined;
			const innerOffset = source.indexOf(tag.markup, tag.position.start);
			if (innerOffset < 0) return undefined;
			return { kind: "markup", inner: tag.markup, innerOffset };
		}
		// Control-flow conditions (if/unless/elsif/when/case) parse into a
		// structured node that carries the condition's exact source range —
		// scan only that, never the block body (which is its own nodes).
		const position = markupPosition(tag.markup);
		if (!position) return undefined;
		return {
			kind: "markup",
			inner: source.slice(position.start, position.end),
			innerOffset: position.start,
		};
	}

	return undefined;
}

function parseProps(
	markup: string,
	source: string,
	file: string,
	nodeStart: number,
	diagnostics: NazareAst["diagnostics"],
): NazarePropDeclaration[] {
	const body = trimBraces(markup);
	const props: NazarePropDeclaration[] = [];
	const seen = new Set<string>();

	for (const entry of splitTopLevel(body)) {
		const separator = entry.indexOf(":");
		const name = separator === -1 ? "" : entry.slice(0, separator).trim();
		const typeExpression =
			separator === -1 ? "" : entry.slice(separator + 1).trim();

		const offset = source.indexOf(name || entry, nodeStart);
		const span = spanFromOffsets(source, file, {
			start: offset >= 0 ? offset : nodeStart,
			end: offset >= 0 ? offset + (name || entry).length : nodeStart,
		});

		if (!isIdentifier(name) || !typeExpression) {
			diagnostics.push(parseMalformedPropDeclaration(entry, span));
			continue;
		}
		if (seen.has(name)) {
			diagnostics.push(parseDuplicatePropDeclaration(name, span));
		} else {
			seen.add(name);
		}

		const parsed = parseTypeExpression(typeExpression);
		if (parsed.error) {
			diagnostics.push(parseInvalidTypeExpression(name, parsed.error, span));
		}

		props.push({
			name,
			typeExpression,
			typeInfo: parsed.typeInfo,
			required: parsed.required,
			hasDefault: parsed.hasDefault,
			span,
		});
	}

	return props;
}

function parsePassedProps(
	body: string,
	source: string,
	file: string,
	bodyStart: number,
	diagnostics: NazareAst["diagnostics"],
): NazarePassedProp[] {
	const props: NazarePassedProp[] = [];
	const seen = new Set<string>();

	for (const entry of splitTopLevelWithOffsets(body)) {
		const entryStart = bodyStart + entry.start;
		const span = spanFromOffsets(source, file, {
			start: entryStart,
			end: bodyStart + entry.end,
		});
		const separator = entry.text.indexOf(":");
		if (separator === -1) {
			diagnostics.push(parseMalformedRenderArgument(entry.text.trim(), span));
			continue;
		}

		const rawName = entry.text.slice(0, separator);
		const rawExpression = entry.text.slice(separator + 1);
		const name = rawName.trim();
		const expression = rawExpression.trim();
		if (!isIdentifier(name) || !expression) {
			diagnostics.push(parseMalformedRenderArgument(entry.text.trim(), span));
			continue;
		}

		const nameStart = entryStart + rawName.search(/\S/);
		const expressionLeadingWhitespace = rawExpression.search(/\S/);
		const expressionStart =
			entryStart + separator + 1 + Math.max(expressionLeadingWhitespace, 0);

		if (seen.has(name)) {
			diagnostics.push(parseDuplicateRenderArgument(name, span));
		} else {
			seen.add(name);
		}

		props.push({
			name,
			expression,
			span,
			nameSpan: spanFromOffsets(source, file, {
				start: nameStart,
				end: nameStart + name.length,
			}),
			expressionSpan: spanFromOffsets(source, file, {
				start: expressionStart,
				end: expressionStart + expression.length,
			}),
		});
	}

	return props;
}

function trimBraces(markup: string): string {
	const trimmed = markup.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		return trimmed.slice(1, -1);
	}

	return trimmed;
}

function splitTopLevel(input: string): string[] {
	return splitTopLevelWithOffsets(input).map((part) => part.text);
}

function splitTopLevelWithOffsets(
	input: string,
): { text: string; start: number; end: number }[] {
	const parts: { text: string; start: number; end: number }[] = [];
	let start = 0;
	let depth = 0;
	let quote: string | undefined;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		const previous = input[index - 1];

		if (quote) {
			if (char === quote && previous !== "\\") quote = undefined;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}

		if (char === "{" || char === "(" || char === "[") depth += 1;
		if (char === "}" || char === ")" || char === "]") depth -= 1;

		if (char === "," && depth === 0) {
			pushTrimmedPart(parts, input, start, index);
			start = index + 1;
		}
	}

	pushTrimmedPart(parts, input, start, input.length);

	return parts;
}

function pushTrimmedPart(
	parts: { text: string; start: number; end: number }[],
	input: string,
	start: number,
	end: number,
): void {
	const raw = input.slice(start, end);
	const leadingWhitespace = raw.search(/\S/);
	if (leadingWhitespace === -1) return;
	const trailingWhitespace = raw.match(/\s*$/)?.[0].length ?? 0;
	const trimmedStart = start + leadingWhitespace;
	const trimmedEnd = end - trailingWhitespace;
	parts.push({
		text: input.slice(trimmedStart, trimmedEnd),
		start: trimmedStart,
		end: trimmedEnd,
	});
}

function collectControlFlowRange(
	node: LiquidHtmlNode,
	controlFlowRanges: SourceRange[],
): void {
	if (node.type !== NodeTypes.LiquidTag) return;
	const tag = node as LiquidTagLike;
	if (tag.name === "if" || tag.name === "unless" || tag.name === "case") {
		controlFlowRanges.push(tag.position);
	}
}

function isInsideControlFlow(
	position: SourceRange,
	controlFlowRanges: SourceRange[],
): boolean {
	return controlFlowRanges.some(
		(range) => range.start < position.start && range.end > position.end,
	);
}

function collectUnsupportedSyntax(
	node: LiquidHtmlNode,
	unsupportedSyntax: Map<UnsupportedSyntaxCategory, LiquidHtmlNode>,
): void {
	const category = unsupportedSyntaxCategory(node);
	if (!category || unsupportedSyntax.has(category)) return;
	unsupportedSyntax.set(category, node);
}

function unsupportedSyntaxCategory(
	node: LiquidHtmlNode,
): UnsupportedSyntaxCategory | undefined {
	if (node.type === NodeTypes.LiquidBranch) return "control-flow";
	if (node.type === NodeTypes.LiquidTag) {
		const tag = node as LiquidTagLike;
		if (tag.name === "if" || tag.name === "unless" || tag.name === "case") {
			return "control-flow";
		}
	}
	if (
		node.type === NodeTypes.HtmlElement ||
		node.type === NodeTypes.HtmlVoidElement ||
		node.type === NodeTypes.HtmlSelfClosingElement
	) {
		return "html";
	}
	return undefined;
}

function unsupportedSyntaxDiagnostics(
	unsupportedSyntax: Map<UnsupportedSyntaxCategory, LiquidHtmlNode>,
	source: string,
	file: string,
): NazareAst["diagnostics"] {
	return Array.from(unsupportedSyntax.entries()).map(([category, node]) => {
		const span = spanFromOffsets(source, file, node.position);
		return category === "control-flow"
			? controlFlowNotLowered(span)
			: htmlNotPromoted(span);
	});
}

function isIdentifier(value: string): boolean {
	return /^[A-Za-z_$][\w$]*$/.test(value);
}

export function scanRefAccesses(
	source: string,
	file: string,
): { name: string; span: SourceSpan }[] {
	return scanScript(source).refAccesses.map((access) => ({
		name: access.name,
		span: spanFromOffsets(source, file, {
			start: access.start,
			end: access.end,
		}),
	}));
}

export function scanDataAccesses(
	source: string,
	file: string,
): { ref: string; property: string; span: SourceSpan }[] {
	return scanScript(source).dataAccesses.map((access) => ({
		ref: access.ref,
		property: access.property,
		span: spanFromOffsets(source, file, {
			start: access.start,
			end: access.end,
		}),
	}));
}
