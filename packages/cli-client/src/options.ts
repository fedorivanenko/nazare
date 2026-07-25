import type { Output } from "./output.js";

export type CliOptions = {
	strictness?: "loose" | "strict";
	version?: string;
	sourceRoot?: string;
	outDir?: string;
	pull?: boolean;
	force?: boolean;
	store?: string;
	theme?: string;
	json?: boolean;
	format?: string;
	positionals: string[];
};

// A value option is either `--name value` (consuming the next arg) or
// `--name=value`. Returns the value, and how many args it consumed so the
// caller can advance past a consumed `value`.
function readValueOption(
	args: string[],
	index: number,
	name: string,
): { value: string | undefined; consumed: number } | undefined {
	const arg = args[index];
	if (arg === name) return { value: args[index + 1], consumed: 2 };
	if (arg.startsWith(`${name}=`)) {
		return { value: arg.slice(name.length + 1), consumed: 1 };
	}
	return undefined;
}

export function parseCliOptions(args: string[]): CliOptions {
	const options: CliOptions = { positionals: [] };

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		const strictness = readValueOption(args, index, "--strictness");
		if (strictness) {
			options.strictness = parseStrictness(strictness.value);
			index += strictness.consumed - 1;
			continue;
		}
		const version = readValueOption(args, index, "--version");
		if (version) {
			options.version = version.value;
			index += version.consumed - 1;
			continue;
		}
		const sourceRoot = readValueOption(args, index, "--source-root");
		if (sourceRoot) {
			options.sourceRoot = sourceRoot.value;
			index += sourceRoot.consumed - 1;
			continue;
		}
		const outDir = readValueOption(args, index, "--out-dir");
		if (outDir) {
			options.outDir = outDir.value;
			index += outDir.consumed - 1;
			continue;
		}
		const store = readValueOption(args, index, "--store");
		if (store) {
			options.store = store.value;
			index += store.consumed - 1;
			continue;
		}
		const theme = readValueOption(args, index, "--theme");
		if (theme) {
			options.theme = theme.value;
			index += theme.consumed - 1;
			continue;
		}
		const format = readValueOption(args, index, "--format");
		if (format) {
			options.format = format.value;
			index += format.consumed - 1;
			continue;
		}
		if (arg === "--pull") {
			options.pull = true;
			continue;
		}
		if (arg === "--force") {
			options.force = true;
			continue;
		}
		if (arg === "--json") {
			options.json = true;
			continue;
		}
		if (arg.startsWith("--")) {
			throw new Error(`Unknown option ${arg}`);
		}
		options.positionals.push(arg);
	}

	return options;
}

function parseStrictness(value: string | undefined): "loose" | "strict" {
	if (value === "loose" || value === "strict") return value;
	throw new Error(
		`Invalid --strictness ${value ?? "<missing>"}; expected loose or strict`,
	);
}

export function printHelp(output: Output = console): void {
	output.error(`Usage:
  nazare ast <file>
  nazare ir <file>
  nazare graph <file>
  nazare validate <file>
  nazare schema <file>
  nazare init                       scaffold build config in nazare.theme.json (prompts for src/out dirs)
  nazare build [source-root|file]   source root from arg or nazare.theme.json build.sourceRoot
                                    --pull reconciles against a live theme first
  nazare inspect theme [dir]        inspect a theme and print semantic graph JSON (dir defaults to build.sourceRoot)
  nazare graph-server [dir]         serve graph queries over newline-delimited JSON stdio
                                    dir defaults to nazare.theme.json build.sourceRoot; unset is an error
  nazare add <@scope/name>          copy a component + deps into the source root
  nazare update [@scope/name]       re-fetch latest; all installed if omitted
  nazare diff <@scope/name>         show registry update vs local installed files
  nazare registry add <name> <url>  save a project registry in nazare.theme.json
  nazare registry use <name>        select a saved project registry
  nazare registry list              list saved project registries
  nazare pack [dir]                 write publishable payload to .nazare-out/pack
  nazare publish [dir]              publish component folder (default .)
  nazare artifact <file>
  nazare dump <file>

Options:
  --strictness loose|strict
  --version x.y.z                   add/update/diff: exact version (default latest)
  --force                           update: overwrite local component edits
  --source-root <dir>               add/update/build source root (else nazare.theme.json build.sourceRoot)
  --out-dir <dir>                   build output directory (else nazare.theme.json build.outDir)
  --pull                            build: fetch live theme data before building
  --store <domain>                  build --pull: Shopify store to pull from
  --theme <id|name>                 build --pull: theme to pull from
  --json                            build: print the raw result as JSON
  --format json|text|dot            inspect: output JSON, human report, or Graphviz DOT

Env:
  NAZARE_REGISTRY                   registry base URL, or file:<dir> for a local one
  NAZARE_TOKEN                      bearer token for publish (file: registries ignore it)`);
}
