import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const cliPath = new URL(
	"../../../packages/nazare/bin/nazare.js",
	import.meta.url,
);
const devCliPath = new URL(
	"../../../packages/nazare-dev/bin/nazare-dev.js",
	import.meta.url,
);
const tempRoots = [];
const children = [];

async function makeTempDir(prefix = "nazare-dev-test-") {
	const root = await mkdtemp(join(tmpdir(), prefix));
	tempRoots.push(root);
	return root;
}

function sha256(value) {
	return createHash("sha256").update(value).digest("hex");
}

async function writeRegistry(root, { themeVersion = "1.0.0", themeSource = "layout\n" } = {}) {
	const componentSource = "button\n";
	await mkdir(join(root, "components", "c-button"), { recursive: true });
	await mkdir(join(root, "theme", "default", "layout"), { recursive: true });
	await writeFile(
		join(root, "components", "c-button", "c-button.liquid"),
		componentSource,
	);
	await writeFile(
		join(root, "theme", "default", "layout", "theme.liquid"),
		themeSource,
	);
	await writeFile(
		join(root, "nazare.registry.yml"),
		`schemaVersion: 1

registry:
  name: nazare

components:
  c-button:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-button/c-button.liquid
        to: snippets/c-button.liquid
        checksum:
          algorithm: sha256
          value: ${sha256(componentSource)}

theme:
  version: ${themeVersion}
  source: theme/default
  files:
    - from: theme/default/layout/theme.liquid
      to: layout/theme.liquid
      checksum:
        algorithm: sha256
        value: ${sha256(themeSource)}
`,
	);
}

function request(url, options = {}) {
	return new Promise((resolve, reject) => {
		const requestOptions = { method: options.method ?? "GET" };
		if (options.path) requestOptions.path = options.path;
		const req = http.request(url, requestOptions, (res) => {
			let body = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => {
				body += chunk;
			});
			res.on("end", () => resolve({ statusCode: res.statusCode, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

function startServer(root, options = {}) {
	return new Promise((resolve, reject) => {
		const args = [
			devCliPath.pathname,
			"registry",
			"serve",
			"--root",
			root,
			"--port",
			"0",
		];
		if (options.gitRefs) args.push("--git-refs");
		const child = spawn(process.execPath, args, { encoding: "utf8" });
		children.push(child);
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			reject(
				new Error(
					`Timed out waiting for server. stdout=${stdout} stderr=${stderr}`,
				),
			);
		}, 5000);

		child.stdout.on("data", (chunk) => {
			stdout += chunk;
			const match = stdout.match(/Registry URL: (http:\/\/127\.0\.0\.1:\d+)/);
			if (match && stdout.includes("Consumer init:")) {
				clearTimeout(timeout);
				resolve({
					child,
					url: match[1],
					stdout: () => stdout,
					stderr: () => stderr,
				});
			}
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("exit", (code) => {
			clearTimeout(timeout);
			if (!stdout.includes("Registry URL:")) {
				reject(
					new Error(`Server exited ${code}. stdout=${stdout} stderr=${stderr}`),
				);
			}
		});
	});
}

async function stopServer(child) {
	if (child.exitCode !== null) return child.exitCode;
	child.kill("SIGTERM");
	return new Promise((resolve) => {
		child.on("exit", (code) => resolve(code));
	});
}

async function git(args, cwd) {
	return execFileAsync("git", args, { cwd, encoding: "utf8" });
}

async function runCli(args, options = {}) {
	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			[cliPath.pathname, ...args],
			{
				cwd: options.cwd,
				encoding: "utf8",
				env: { ...process.env, ...options.env },
			},
		);
		return { code: 0, stdout, stderr };
	} catch (error) {
		return {
			code: error.code,
			stdout: error.stdout ?? "",
			stderr: error.stderr ?? "",
		};
	}
}

afterEach(async () => {
	await Promise.all(children.splice(0).map((child) => stopServer(child)));
	await Promise.all(
		tempRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("nazare-dev registry serve", () => {
	it("serves health, manifest, and source files from an ephemeral port", async () => {
		const registry = await makeTempDir();
		await writeRegistry(registry);
		const server = await startServer(registry);

		expect(server.stdout()).toContain("Consumer init: nazare init --repo");
		expect(await request(`${server.url}/healthz`)).toMatchObject({
			statusCode: 200,
			body: "ok",
		});
		expect(
			await request(
				`${server.url}/raw/nazare.registry.yml?ref=refs%2Fheads%2Fmain`,
			),
		).toMatchObject({ statusCode: 200 });
		expect(
			await request(
				`${server.url}/raw/components/c-button/c-button.liquid?ref=refs%2Fheads%2Fmain`,
			),
		).toMatchObject({ statusCode: 200, body: "button\n" });
	});

	it("rejects unsafe paths, missing files, directories, and unsupported methods", async () => {
		const registry = await makeTempDir();
		await writeRegistry(registry);
		const server = await startServer(registry);

		expect(
			await request(server.url, { path: "/raw/%2e%2e/package.json" }),
		).toMatchObject({
			statusCode: 400,
		});
		expect(
			await request(server.url, { path: "/raw/%2Ftmp/file" }),
		).toMatchObject({
			statusCode: 400,
		});
		expect(await request(server.url, { path: "/raw/a%5Cb" })).toMatchObject({
			statusCode: 400,
		});
		expect(await request(`${server.url}/raw/missing.txt`)).toMatchObject({
			statusCode: 404,
		});
		expect(await request(`${server.url}/raw/components`)).toMatchObject({
			statusCode: 400,
		});
		expect(
			await request(`${server.url}/healthz`, { method: "POST" }),
		).toMatchObject({
			statusCode: 405,
		});
	});

	it("fails before listening when registry manifest is missing", async () => {
		const registry = await makeTempDir();
		const result = await execFileAsync(
			process.execPath,
			[devCliPath.pathname, "registry", "serve", "--root", registry],
			{ encoding: "utf8" },
		).catch((error) => error);

		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("Missing registry manifest");
	});

	it("lets nazare init, list, add, and theme pull consume the local HTTP registry", async () => {
		const registry = await makeTempDir();
		const consumer = await makeTempDir();
		await writeRegistry(registry);
		const server = await startServer(registry);

		const init = await runCli(
			["init", "--repo", server.url, "--ref", "refs/heads/main"],
			{ cwd: consumer },
		);
		expect(init).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(consumer, "nazare.config.yml"), "utf8"),
		).toContain(`repo: ${server.url}`);

		const list = await runCli(["list"], { cwd: consumer });
		expect(list).toMatchObject({ code: 0, stderr: "" });
		expect(list.stdout).toContain("c-button");

		const add = await runCli(["add", "c-button"], { cwd: consumer });
		expect(add).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(consumer, "snippets", "c-button.liquid"), "utf8"),
		).toBe("button\n");

		const pull = await runCli(["theme", "pull"], { cwd: consumer });
		expect(pull).toMatchObject({ code: 0, stderr: "" });
		expect(
			await readFile(join(consumer, "layout", "theme.liquid"), "utf8"),
		).toBe("layout\n");
	}, 15_000);

	it("serves files from requested stable and dev git refs", async () => {
		const registry = await makeTempDir();
		await writeRegistry(registry);
		await git(["init"], registry);
		await git(["config", "user.email", "test@example.com"], registry);
		await git(["config", "user.name", "Test User"], registry);
		await git(["add", "."], registry);
		await git(["commit", "-m", "stable"], registry);
		await git(["tag", "v0.14.0"], registry);
		await writeFile(
			join(registry, "components", "c-button", "c-button.liquid"),
			"dev button\n",
		);
		await git(["add", "."], registry);
		await git(["commit", "-m", "dev"], registry);
		await git(["tag", "v0.14.1-dev.0"], registry);
		await writeFile(
			join(registry, "components", "c-button", "c-button.liquid"),
			"working tree\n",
		);
		const server = await startServer(registry, { gitRefs: true });

		expect(
			await request(
				`${server.url}/raw/components/c-button/c-button.liquid?ref=v0.14.0`,
			),
		).toMatchObject({ statusCode: 200, body: "button\n" });
		expect(
			await request(
				`${server.url}/raw/components/c-button/c-button.liquid?ref=v0.14.1-dev.0`,
			),
		).toMatchObject({ statusCode: 200, body: "dev button\n" });
		expect(
			await request(
				`${server.url}/raw/components/c-button/c-button.liquid?ref=missing`,
			),
		).toMatchObject({ statusCode: 404 });
	});

	it("exits cleanly on SIGTERM", async () => {
		const registry = await makeTempDir();
		await writeRegistry(registry);
		const server = await startServer(registry);

		await expect(stopServer(server.child)).resolves.toBe(0);
	});

	it("serves /tags as 501 without --git-refs", async () => {
		const registry = await makeTempDir();
		await writeRegistry(registry);
		const server = await startServer(registry);

		expect(await request(`${server.url}/tags`)).toMatchObject({ statusCode: 501 });
	});

	it("serves /tags listing git version tags with --git-refs", async () => {
		const registry = await makeTempDir();
		await writeRegistry(registry);
		await git(["init"], registry);
		await git(["config", "user.email", "test@example.com"], registry);
		await git(["config", "user.name", "Test User"], registry);
		await git(["add", "."], registry);
		await git(["commit", "-m", "initial"], registry);
		await git(["tag", "v1.0.0"], registry);
		await git(["tag", "v1.1.0-dev.0"], registry);
		const server = await startServer(registry, { gitRefs: true });

		const response = await request(`${server.url}/tags`);
		expect(response.statusCode).toBe(200);
		expect(JSON.parse(response.body)).toEqual(
			expect.arrayContaining(["v1.0.0", "v1.1.0-dev.0"]),
		);
	});

	it("update theme --latest resolves latest stable tag from HTTP registry", async () => {
		const registry = await makeTempDir();
		const consumer = await makeTempDir();

		await writeRegistry(registry, { themeVersion: "1.0.0", themeSource: "old layout\n" });
		await git(["init"], registry);
		await git(["config", "user.email", "test@example.com"], registry);
		await git(["config", "user.name", "Test User"], registry);
		await git(["add", "."], registry);
		await git(["commit", "-m", "v1.0.0"], registry);
		await git(["tag", "v1.0.0"], registry);

		await writeRegistry(registry, { themeVersion: "1.1.0", themeSource: "new layout\n" });
		await git(["add", "."], registry);
		await git(["commit", "-m", "v1.1.0"], registry);
		await git(["tag", "v1.1.0"], registry);
		await git(["tag", "v1.2.0-dev.0"], registry);

		const server = await startServer(registry, { gitRefs: true });

		const init = await runCli(["init", "--repo", server.url, "--ref", "v1.0.0"], { cwd: consumer });
		expect(init).toMatchObject({ code: 0, stderr: "" });

		const pull = await runCli(["theme", "pull"], { cwd: consumer });
		expect(pull).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(consumer, "layout", "theme.liquid"), "utf8")).toBe("old layout\n");

		const update = await runCli(["update", "theme", "--latest"], { cwd: consumer });
		expect(update).toMatchObject({ code: 0, stderr: "" });
		expect(await readFile(join(consumer, "nazare.config.yml"), "utf8")).toContain("ref: v1.1.0");
		expect(await readFile(join(consumer, "layout", "theme.liquid"), "utf8")).toBe("new layout\n");
	}, 20_000);
});
