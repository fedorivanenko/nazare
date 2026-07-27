import type { Output } from "./output.js";

export type CliOptions = {
	strictness?: "loose" | "strict";
	version?: string;
	sourceRoot?: string;
	outDir?: string;
	/** build: reconcile against a live theme's merchant-owned data first. */
	pullData?: boolean;
	force?: boolean;
	/** registry publish: write the payload locally instead of uploading it. */
	pack?: boolean;
	store?: string;
	theme?: string;
	json?: boolean;
	format?: string;
	/** preview serve: the port to listen on. */
	port?: string;
	/** preview fixtures pull: the name to write it under. */
	as?: string;
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
		const port = readValueOption(args, index, "--port");
		if (port) {
			options.port = port.value;
			index += port.consumed - 1;
			continue;
		}
		const as = readValueOption(args, index, "--as");
		if (as) {
			options.as = as.value;
			index += as.consumed - 1;
			continue;
		}
		const format = readValueOption(args, index, "--format");
		if (format) {
			options.format = format.value;
			index += format.consumed - 1;
			continue;
		}
		if (arg === "--pull-data") {
			options.pullData = true;
			continue;
		}
		if (arg === "--pack") {
			options.pack = true;
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
  nazare init                        scaffold build config in nazare.theme.json (prompts for src/out dirs)
  nazare build [source-root|file]    source root from arg or nazare.theme.json build.sourceRoot
  nazare check <file>                diagnostics only; non-zero exit on errors
  nazare preview <command>           the component workbench
  nazare registry <command>          install, author, and choose registries
  nazare inspect <view> <file>       compiler facts as JSON
  nazare inspect theme [dir]         semantic graph for a whole theme
                                     dir defaults to nazare.theme.json build.sourceRoot
  nazare graph-server [dir]          serve graph queries over newline-delimited JSON stdio

Preview:
  nazare preview serve [dir]             serve the workbench, rebuilding on change
                                         --port (default 4173)
  nazare preview build [dir]             write a static workbench
                                         dir defaults to build.sourceRoot; output
                                         directory is asked once and saved to
                                         nazare.theme.json preview.outDir
  nazare preview check [dir]             render every story; non-zero exit when one
                                         fails or contradicts its declaration
  nazare preview scaffold <file>         draft a <name>.stories.json beside a
                                         template, from what it declares
  nazare preview fixtures init [dir]     copy the built-in stand-in data into
                                         the project as fixtures/*.json
  nazare preview fixtures pull <handle>  fetch a product from a live storefront
                                         --store <shop>.myshopify.com [--as name]

  A component appears once it has stories. Write them in <name>.stories.json
  beside a theme template, or in a package's nazare.json under "preview".

Registry:
  nazare registry add <@scope/name>      copy a component + deps into the source root
  nazare registry update [@scope/name]   re-fetch latest; all installed if omitted
  nazare registry diff <@scope/name>     show registry update vs local installed files
  nazare registry publish [dir]          publish a component folder (default .)
  nazare registry connect <name> <url>   save a project registry in nazare.theme.json
  nazare registry use <name>             select a saved project registry
  nazare registry list                   list saved project registries

  add, update, and publish also answer at the top level:
  \`nazare add @scope/name\` is \`nazare registry add @scope/name\`.

Inspect views:
  ast, ir, graph, schema, artifact, dump

Options:
  --strictness loose|strict
  --version x.y.z                    registry add/update/diff: exact version (default latest)
  --force                            registry update: overwrite local component edits
  --pack                             registry publish: write the payload to .nazare-out/pack instead
  --source-root <dir>                registry add/update, build (else nazare.theme.json build.sourceRoot)
  --out-dir <dir>                    build output directory (else nazare.theme.json build.outDir);
                                     preview build writes here too (preview.outDir)
  --pull-data                        build: reconcile against a live theme's merchant-owned data first
  --store <domain>                   build --pull-data: Shopify store to pull from
  --theme <id|name>                  build --pull-data: theme to pull from
  --json                             build: print the raw result as JSON
  --port <number>                    preview serve: port to listen on (default 4173)
  --as <name>                        preview fixtures pull: fixture name (default product)
  --format json|text|dot             inspect theme: JSON, human report, or Graphviz DOT

Env:
  NAZARE_REGISTRY                    registry base URL, or file:<dir> for a local one
  NAZARE_TOKEN                       bearer token for publish (file: registries ignore it)

Nazare builds a theme directory; the Shopify CLI moves it to and from a store
(\`shopify theme push --path <outDir>\`), which is why there is no push or pull.`);
}
