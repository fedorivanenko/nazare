// Typed-refs pass: real TypeScript checking of {% script %} blocks. Each
// script is checked as a virtual module behind a generated prelude that
// types `refs` from the markup's ref elements (via HTMLElementTagNameMap),
// so using the wrong DOM API on a ref is a compile error. Kept separate
// from compileNazareArtifact — building a TS program is orders of magnitude
// slower than the rest of the pipeline, so callers opt in (the CLI does).
import type { ArtifactIR, Diagnostic, SourceSpan } from "@nazare/core";
import ts from "typescript";
import { type DataChannel, dataChannelFromIR } from "./data-channel.js";
import { scriptTypeError } from "./diagnostics.js";

// Rooted at "/" — TS's program-level module resolution silently skips
// resolution for rootless containing files, so the virtual component lives
// at the filesystem root and sidecars alongside it.
const virtualFileName = "/component.ts";

export type CheckComponentScriptsOptions = {
	/** Resolves ./-relative script imports so cross-module types check. */
	readAsset?: (relativePath: string) => string | undefined;
};

export function checkComponentScripts(
	ir: ArtifactIR,
	options: CheckComponentScriptsOptions = {},
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const refs = ir.syntax.filter((node) => node.kind === "element-ref");
	const scripts = ir.syntax.filter(
		(node) => node.kind === "script" && node.lang === "ts",
	);

	const channel = dataChannelFromIR(ir);

	for (const script of scripts) {
		if (script.kind !== "script") continue;
		const prelude = preludeFor(refs, channel);
		const virtualSource = `${prelude}\n${script.source}`;
		const preludeLines = prelude.split("\n").length;

		for (const diagnostic of typescriptDiagnostics(
			virtualSource,
			options.readAsset,
		)) {
			if (isRedundantUnknownRef(diagnostic)) continue;
			issues.push(
				scriptTypeError(
					ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
					diagnostic.code,
					spanForDiagnostic(diagnostic, preludeLines, script.bodySpan),
				),
			);
		}
	}

	return issues;
}

function preludeFor(
	refs: { name: string; tagName: string }[],
	channel: DataChannel,
): string {
	const seen = new Set<string>();
	const fields = refs
		.filter((ref) => !seen.has(ref.name) && seen.add(ref.name))
		.map(
			(ref) =>
				`  ${ref.name}: NazareTagType<${JSON.stringify(ref.tagName.toLowerCase())}>;`,
		)
		.join("\n");

	const dataFields = Array.from(channel.entries())
		.map(([refName, bindings]) => {
			const properties = Array.from(bindings.values())
				.map(
					(binding) =>
						`    ${binding.property}${binding.optional ? "?" : ""}: ${binding.kind};`,
				)
				.join("\n");
			return `  ${refName}: {\n${properties}\n  };`;
		})
		.join("\n");

	return `type NazareTagType<T extends string> = T extends keyof HTMLElementTagNameMap
  ? HTMLElementTagNameMap[T]
  : HTMLElement;
type NazareRefs = {
${fields}
};
type NazareData = {
${dataFields}
};
type NazareContext = { root: HTMLElement; refs: NazareRefs; data: NazareData };
declare function island(
  setup: (context: NazareContext) => void,
): (context: NazareContext) => void;`;
}

function typescriptDiagnostics(
	virtualSource: string,
	readAsset: ((relativePath: string) => string | undefined) | undefined,
): readonly ts.Diagnostic[] {
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2018,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		allowImportingTsExtensions: true,
		lib: ["lib.es2018.d.ts", "lib.dom.d.ts"],
		strict: true,
		noEmit: true,
		types: [],
		skipLibCheck: true,
	};
	const host = ts.createCompilerHost(options);
	const defaultGetSourceFile = host.getSourceFile.bind(host);
	const virtualSourceFile = ts.createSourceFile(
		virtualFileName,
		virtualSource,
		ts.ScriptTarget.ES2018,
		true,
	);
	// Relative imports resolve as component-dir files served by readAsset:
	// the virtual entry lives at "/", so "./utils.ts" becomes "/utils.ts",
	// which maps back to readAsset("./utils.ts"). Real fs paths (TS libs)
	// miss readAsset and fall through to ts.sys.
	const virtualContents = (fileName: string): string | undefined => {
		if (fileName === virtualFileName) return virtualSource;
		if (!fileName.startsWith("/") || fileName.includes("node_modules"))
			return undefined;
		return readAsset?.(`.${fileName}`);
	};

	host.getSourceFile = (fileName, languageVersion, ...rest) => {
		if (fileName === virtualFileName) return virtualSourceFile;
		const contents = virtualContents(fileName);
		if (contents !== undefined) {
			return ts.createSourceFile(fileName, contents, languageVersion, true);
		}
		return defaultGetSourceFile(fileName, languageVersion, ...rest);
	};
	host.fileExists = (fileName) =>
		virtualContents(fileName) !== undefined || ts.sys.fileExists(fileName);
	host.readFile = (fileName) =>
		virtualContents(fileName) ?? ts.sys.readFile(fileName);
	host.getCurrentDirectory = () => "/";
	host.writeFile = () => undefined;

	const program = ts.createProgram([virtualFileName], options, host);
	return ts
		.getPreEmitDiagnostics(program, virtualSourceFile)
		.filter((diagnostic) => diagnostic.file?.fileName === virtualFileName);
}

/**
 * refs.<unknown> and data.<unknown> already get CONSTRAINT_UNKNOWN_REF /
 * CONSTRAINT_UNKNOWN_DATA_ACCESS from the check pass.
 */
function isRedundantUnknownRef(diagnostic: ts.Diagnostic): boolean {
	if (diagnostic.code !== 2339) return false;
	const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
	return message.includes("NazareRefs") || message.includes("NazareData");
}

function spanForDiagnostic(
	diagnostic: ts.Diagnostic,
	preludeLines: number,
	bodySpan: SourceSpan | undefined,
): SourceSpan | undefined {
	if (!bodySpan || !diagnostic.file || diagnostic.start === undefined) {
		return bodySpan;
	}
	const start = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
	const bodyLine = start.line + 1 - preludeLines;
	if (bodyLine < 1) return bodySpan;
	const line = bodySpan.start.line + bodyLine - 1;
	const column = bodyLine === 1 ? bodySpan.start.column + start.character : start.character + 1;
	return {
		file: bodySpan.file,
		start: { line, column },
		end: { line, column: column + (diagnostic.length ?? 1) },
	};
}
