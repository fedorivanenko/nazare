import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import {
	analyzeSource,
	DEFAULT_SOURCE_ANALYSIS_LANGUAGE,
} from "@nazare/source-cli";
import type { CliOptions } from "./options.js";
import type { Output } from "./output.js";

export async function runSourceCommand(
	projectRoot: string,
	options: CliOptions,
	output: Output,
	input: Readable,
): Promise<number> {
	const [subcommand, target, ...extraPositionals] = options.positionals;
	if (subcommand !== "analyze" || extraPositionals.length > 0) {
		output.error(
			"Usage: nazare source analyze [file] [--stdin] [--language liquid|nazare-liquid] [--format json]",
		);
		return 1;
	}
	if (options.format !== undefined && options.format !== "json") {
		output.error(
			`Unsupported source analysis format ${options.format}; expected json`,
		);
		return 1;
	}
	if (options.stdin && target !== undefined) {
		output.error("Source analysis accepts either a file or --stdin, not both");
		return 1;
	}
	if (!options.stdin && target === undefined) {
		output.error("Source analysis requires a file or --stdin");
		return 1;
	}

	const language = options.language ?? DEFAULT_SOURCE_ANALYSIS_LANGUAGE;
	const { file, source } = options.stdin
		? { file: "<stdin>", source: await readUtf8Stream(input) }
		: await readSourceFile(projectRoot, target as string);
	const result = analyzeSource({ file, source, language });
	output.log(JSON.stringify(result, null, 2));
	return result.authoritative ? 0 : 1;
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
	const file = projectRelative.split(sep).join("/");
	return { file, source: await readFile(resolvedFile, "utf8") };
}

async function readUtf8Stream(input: Readable): Promise<string> {
	input.setEncoding("utf8");
	let source = "";
	for await (const chunk of input) source += chunk;
	return source;
}
