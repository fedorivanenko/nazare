import type { SourceSpan } from "@nazare/core";
import type {
	NazareAssetImportNode,
	NazareAst,
	NazareImportNode,
	NazarePassedProp,
	NazarePropDeclaration,
} from "./ast.js";
import {
	importBareSpecifier,
	importBindingCase,
	importComponentCase,
	importOutsideProject,
	importUnsupportedExtension,
	parseDuplicatePropDeclaration,
	parseDuplicateRenderArgument,
	parseInvalidImport,
	parseInvalidTypeExpression,
	parseMalformedPropDeclaration,
	parseMalformedRenderArgument,
} from "./diagnostics.js";
import { isRelativeSpecifier, resolveImportPath } from "./paths.js";
import { spanFromOffsets } from "./source.js";
import { parseTypeExpression } from "./type-expression.js";

const importPattern = /^([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["']$/;

export function parseNazareImportTag(
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

	if (/\.(js|css)$/.test(specifier)) {
		if (/^[A-Z]/.test(localName)) {
			diagnostics.push(importBindingCase(localName, span));
			return undefined;
		}
		return { type: "NazareAssetImport", localName, path, span };
	}

	diagnostics.push(importUnsupportedExtension(specifier, span));
	return undefined;
}

export function parseProps(
	markup: string,
	source: string,
	file: string,
	nodeStart: number,
	diagnostics: NazareAst["diagnostics"],
): NazarePropDeclaration[] {
	if (source.slice(nodeStart, nodeStart + markup.length) !== markup) {
		throw new Error(
			"Nazare props payload range does not match authored source",
		);
	}
	const markupStart = nodeStart;
	const trimmed = markup.trim();
	const hasBraces = trimmed.startsWith("{") && trimmed.endsWith("}");
	const leadingWhitespace = markup.length - markup.trimStart().length;
	const body = hasBraces ? trimmed.slice(1, -1) : trimmed;
	const bodyStart = markupStart + leadingWhitespace + (hasBraces ? 1 : 0);
	const props: NazarePropDeclaration[] = [];
	const seen = new Set<string>();

	for (const entry of splitTopLevelWithOffsets(body)) {
		const separator = entry.text.indexOf(":");
		const name = separator === -1 ? "" : entry.text.slice(0, separator).trim();
		const typeExpression =
			separator === -1 ? "" : entry.text.slice(separator + 1).trim();

		// The entry text is already trimmed, so the name starts exactly at the
		// entry's offset.
		const start = bodyStart + entry.start;
		const length = (name || entry.text).length;
		const span = spanFromOffsets(source, file, {
			start,
			end: start + length,
		});

		if (!isIdentifier(name) || !typeExpression) {
			diagnostics.push(parseMalformedPropDeclaration(entry.text, span));
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

export function parsePassedProps(
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

function isIdentifier(value: string): boolean {
	return /^[A-Za-z_$][\w$]*$/.test(value);
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
