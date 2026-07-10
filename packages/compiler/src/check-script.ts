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

const virtualFileName = "component.ts";

export function checkComponentScripts(ir: ArtifactIR): Diagnostic[] {
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

		for (const diagnostic of typescriptDiagnostics(virtualSource)) {
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

function typescriptDiagnostics(virtualSource: string): readonly ts.Diagnostic[] {
	const options: ts.CompilerOptions = {
		target: ts.ScriptTarget.ES2018,
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

	host.getSourceFile = (fileName, ...rest) =>
		fileName === virtualFileName
			? virtualSourceFile
			: defaultGetSourceFile(fileName, ...rest);
	host.fileExists = (fileName) =>
		fileName === virtualFileName || ts.sys.fileExists(fileName);
	host.readFile = (fileName) =>
		fileName === virtualFileName ? virtualSource : ts.sys.readFile(fileName);
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
