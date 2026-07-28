// What a command loads before it does anything.
//
// Importing the compiler costs about ten seconds cold, and importing the
// preview brings liquidjs with it. Loaded statically they are paid by every
// command, so `nazare --help` spent seconds building a compiler in order to
// print a page of text. This asserts the property directly — which modules the
// process actually resolved — rather than timing the command, because a timing
// test on a loaded machine measures the machine.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = resolve("packages/cli-client/dist/index.js");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Runs the CLI under a resolve hook that records every specifier the process
 * asks for, and answers with the list.
 */
async function specifiersLoadedBy(args, cwd = repoRoot) {
	const dir = mkdtempSync(join(tmpdir(), "nazare-startup-"));
	const log = join(dir, "specifiers.txt");
	const hook = join(dir, "hook.mjs");
	const setup = join(dir, "setup.mjs");
	try {
		await writeFile(
			hook,
			`import { appendFileSync } from "node:fs";
let log;
export function initialize(data) { log = data.log; }
export function resolve(specifier, context, next) {
  appendFileSync(log, specifier + "\\n");
  return next(specifier, context);
}
`,
		);
		await writeFile(
			setup,
			`import { register } from "node:module";
register(${JSON.stringify(pathToFileURL(hook).href)}, import.meta.url, {
  data: { log: ${JSON.stringify(log)} },
});
`,
		);
		await writeFile(log, "");
		await run(process.execPath, ["--import", setup, cli, ...args], {
			cwd,
			env: { ...process.env, NAZARE_REGISTRY: undefined },
		}).catch(() => undefined);
		const { readFile } = await import("node:fs/promises");
		return (await readFile(log, "utf8")).split("\n").filter(Boolean);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const loadsCompiler = (specifiers) =>
	specifiers.some((one) => one.includes("@nazare/compiler"));
const loadsPreview = (specifiers) =>
	specifiers.some((one) => one.includes("@nazare/preview"));

test("printing help loads neither the compiler nor the preview", async () => {
	const specifiers = await specifiersLoadedBy(["--help"]);

	// The list is only meaningful if the hook saw anything at all.
	assert.ok(specifiers.length > 0, "the resolve hook recorded nothing");
	assert.equal(loadsCompiler(specifiers), false);
	assert.equal(loadsPreview(specifiers), false);
});

test("an unknown command does not load them either", async () => {
	// It prints help and exits, so it should cost what help costs.
	const specifiers = await specifiersLoadedBy(["wat"]);

	assert.equal(loadsCompiler(specifiers), false);
	assert.equal(loadsPreview(specifiers), false);
});

test("a command that needs the compiler still loads it", async () => {
	// The other half of the claim: lazy means later, not never.
	const specifiers = await specifiersLoadedBy([
		"check",
		"registry/components/button/button.nz.liquid",
	]);

	assert.equal(loadsCompiler(specifiers), true);
});
