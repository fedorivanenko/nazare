#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { SourceLanguage } from "@nazare/source";
import { analyzeSource, DEFAULT_SOURCE_ANALYSIS_LANGUAGE } from "./analysis.js";

export {
	analyzeSource,
	DEFAULT_SOURCE_ANALYSIS_LANGUAGE,
	type LiquidSourceAnalysisResult,
	type NazareSourceAnalysisResult,
	SOURCE_ANALYSIS_SCHEMA_VERSION,
	type SourceAnalysisResult,
} from "./analysis.js";

type Output = {
	log: (...values: unknown[]) => void;
	error: (...values: unknown[]) => void;
};

type MainOptions = {
	cwd?: string;
	input?: Readable;
	output?: Output;
};

type ParsedOptions = {
	command?: string;
	target?: string;
	stdin: boolean;
	language: SourceLanguage;
	format: "json";
};

export async function main(
	args = process.argv.slice(2),
	options: MainOptions = {},
): Promise<number> {
	const output = options.output ?? console;
	if (args[0] === "--version" || args[0] === "version") {
		output.log(readCliVersion());
		return 0;
	}
	if (
		args.length === 0 ||
		args[0] === "help" ||
		args[0] === "--help" ||
		args[0] === "-h"
	) {
		printHelp(output);
		return 0;
	}
	try {
		const parsed = parseOptions(args);
		if (parsed.command !== "analyze") {
			throw new Error(`Unknown command ${parsed.command ?? "<missing>"}`);
		}
		if (parsed.stdin && parsed.target !== undefined) {
			throw new Error("Analyze accepts either a file or --stdin, not both");
		}
		if (!parsed.stdin && parsed.target === undefined) {
			throw new Error("Analyze requires a file or --stdin");
		}
		const projectRoot = options.cwd ?? process.cwd();
		const sourceInput = parsed.stdin
			? {
					file: "<stdin>",
					source: await readUtf8Stream(options.input ?? process.stdin),
				}
			: await readSourceFile(projectRoot, parsed.target as string);
		const result = analyzeSource({
			...sourceInput,
			language: parsed.language,
		});
		output.log(JSON.stringify(result, null, 2));
		return result.authoritative ? 0 : 1;
	} catch (error) {
		output.error(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

function parseOptions(args: string[]): ParsedOptions {
	const positionals: string[] = [];
	let stdin = false;
	let language = DEFAULT_SOURCE_ANALYSIS_LANGUAGE;
	let format: "json" = "json";
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index] as string;
		if (argument === "--stdin") {
			stdin = true;
			continue;
		}
		const languageOption = readValueOption(args, index, "--language");
		if (languageOption) {
			if (
				languageOption.value !== "liquid" &&
				languageOption.value !== "nazare-liquid"
			) {
				throw new Error(
					`Invalid --language ${languageOption.value ?? "<missing>"}; expected liquid or nazare-liquid`,
				);
			}
			language = languageOption.value;
			index += languageOption.consumed - 1;
			continue;
		}
		const formatOption = readValueOption(args, index, "--format");
		if (formatOption) {
			if (formatOption.value !== "json") {
				throw new Error(
					`Unsupported format ${formatOption.value ?? "<missing>"}; expected json`,
				);
			}
			format = formatOption.value;
			index += formatOption.consumed - 1;
			continue;
		}
		if (argument.startsWith("--")) {
			throw new Error(`Unknown option ${argument}`);
		}
		positionals.push(argument);
	}
	if (positionals.length > 2) {
		throw new Error("Analyze accepts at most one file");
	}
	return {
		command: positionals[0],
		target: positionals[1],
		stdin,
		language,
		format,
	};
}

function readValueOption(
	args: string[],
	index: number,
	name: string,
): { value: string | undefined; consumed: number } | undefined {
	const argument = args[index] as string;
	if (argument === name) return { value: args[index + 1], consumed: 2 };
	if (argument.startsWith(`${name}=`)) {
		return { value: argument.slice(name.length + 1), consumed: 1 };
	}
	return undefined;
}

async function readSourceFile(
	projectRoot: string,
	target: string,
): Promise<{ file: string; source: string }> {
	const resolvedFile = resolve(projectRoot, target);
	const projectRelative = relative(projectRoot, resolvedFile);
	if (
		isAbsolute(projectRelative) ||
		projectRelative === ".." ||
		projectRelative.startsWith(`..${sep}`)
	) {
		throw new Error(`${target} is outside the project root ${projectRoot}`);
	}
	return {
		file: projectRelative.split(sep).join("/"),
		source: await readFile(resolvedFile, "utf8"),
	};
}

async function readUtf8Stream(input: Readable): Promise<string> {
	input.setEncoding("utf8");
	let source = "";
	for await (const chunk of input) source += chunk;
	return source;
}

function readCliVersion(): string {
	for (const url of [
		new URL("../../../VERSION", import.meta.url),
		new URL("../package.json", import.meta.url),
	]) {
		try {
			const value = readFileSync(fileURLToPath(url), "utf8").trim();
			if (!url.pathname.endsWith("package.json")) {
				if (value.length > 0) return value;
				continue;
			}
			const packageMetadata = JSON.parse(value) as { version?: unknown };
			if (typeof packageMetadata.version === "string") {
				return packageMetadata.version;
			}
			throw new Error("Source CLI package version must be a string");
		} catch (error) {
			if (isMissingFileError(error)) continue;
			throw error;
		}
	}
	throw new Error("Unable to determine Nazare source CLI version");
}

function isMissingFileError(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === "ENOENT"
	);
}

function printHelp(output: Output): void {
	output.log(`Usage:
  nazare-source analyze [file] [--stdin] [--language liquid|nazare-liquid]

Options:
  --stdin                            read UTF-8 source from stdin
  --language liquid|nazare-liquid   grammar (default liquid)
  --format json                     versioned JSON output
  --version                         print installed release version`);
}

function isCliEntrypoint(argument: string | undefined): boolean {
	if (!argument) return false;
	return (
		realpathSync(fileURLToPath(import.meta.url)) ===
		realpathSync(resolve(argument))
	);
}

if (isCliEntrypoint(process.argv[1])) {
	process.exit(await main());
}
