import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL("../bin/nazare.js", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);

async function runCli(args) {
	return execFileAsync(process.execPath, [cliPath.pathname, ...args], {
		encoding: "utf8",
	});
}

describe("nazare CLI", () => {
	it("prints help", async () => {
		const { stdout, stderr } = await runCli(["--help"]);

		expect(stderr).toBe("");
		expect(stdout).toContain("Nazare CLI");
		expect(stdout).toContain("nazare --version");
	});

	it("prints package version", async () => {
		const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
		const { stdout, stderr } = await runCli(["--version"]);

		expect(stderr).toBe("");
		expect(stdout).toBe(`${packageMetadata.version}\n`);
	});
});
