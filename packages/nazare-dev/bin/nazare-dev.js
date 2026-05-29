#!/usr/bin/env node

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DEFAULT_REGISTRY_PORT = 7331;

const HELP = `Nazare Dev CLI

Usage:
  nazare-dev --help
  nazare-dev registry serve [--host <host>] [--port <port>] [--root <path>] [--no-git-refs]

Commands:
  registry serve     Serve a local Nazare registry checkout over read-only HTTP

Options:
  -h, --help         Show this help
  --host <host>      Bind host (default: 127.0.0.1)
  --port <port>      Bind port, 0 picks a free port (default: 7331)
  --root <path>      Registry root directory (default: current directory)
  --no-git-refs      Disable Git ref serving and /tags endpoint
`;

function parseServeArgs(args) {
	const options = {
		host: "127.0.0.1",
		port: DEFAULT_REGISTRY_PORT,
		root: process.cwd(),
		gitRefs: true,
	};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (arg === "--host") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("Missing value for --host");
			}
			options.host = value;
			index += 1;
			continue;
		}

		if (arg === "--port") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("Missing value for --port");
			}
			if (!/^\d+$/.test(value)) {
				throw new Error("Invalid --port; expected integer 0-65535");
			}
			options.port = Number(value);
			if (options.port < 0 || options.port > 65535) {
				throw new Error("Invalid --port; expected integer 0-65535");
			}
			index += 1;
			continue;
		}

		if (arg === "--root") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) {
				throw new Error("Missing value for --root");
			}
			options.root = value;
			index += 1;
			continue;
		}

		if (arg === "--no-git-refs") {
			options.gitRefs = false;
			continue;
		}

		throw new Error(`Unknown registry serve option: ${arg}`);
	}

	options.root = path.resolve(options.root);
	return options;
}

function isSafeRelativePath(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!value.split("/").includes("..")
	);
}

function decodeRawPath(requestPathname) {
	if (!requestPathname.startsWith("/raw/")) return undefined;
	try {
		return decodeURIComponent(requestPathname.slice("/raw/".length));
	} catch {
		return "";
	}
}

function readGitRefFile(root, ref, filePath) {
	if (typeof ref !== "string" || ref.length === 0) return undefined;
	try {
		return execFileSync("git", ["-C", root, "show", `${ref}:${filePath}`], {
			encoding: "buffer",
			stdio: ["ignore", "pipe", "ignore"],
		});
	} catch {
		return undefined;
	}
}

function createRegistryServer(root, options = {}) {
	return http.createServer((request, response) => {
		if (request.method !== "GET") {
			response.writeHead(405, { Allow: "GET" });
			response.end("method not allowed\n");
			return;
		}

		const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		const rawPathname = String(request.url ?? "").split("?")[0];
		if (rawPathname === "/healthz") {
			response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("ok");
			return;
		}

		if (rawPathname === "/tags") {
			if (!options.gitRefs) {
				response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
				response.end("not found\n");
				return;
			}
			try {
				const output = execFileSync(
					"git",
					["-C", root, "tag", "-l", "v*"],
					{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
				);
				const tags = output.split("\n").filter(Boolean);
				const json = JSON.stringify(tags);
				response.writeHead(200, {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(json),
				});
				response.end(json);
			} catch {
				response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
				response.end("server error\n");
			}
			return;
		}

		const filePath = decodeRawPath(rawPathname);
		if (filePath === undefined) {
			response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("not found\n");
			return;
		}

		if (!isSafeRelativePath(filePath)) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("unsafe path\n");
			return;
		}

		const absolutePath = path.join(root, filePath);
		if (!absolutePath.startsWith(`${root}${path.sep}`)) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("unsafe path\n");
			return;
		}

		const ref = requestUrl.searchParams.get("ref");
		if (options.gitRefs && ref) {
			const content = readGitRefFile(root, ref, filePath);
			if (content === undefined) {
				response.writeHead(404, {
					"Content-Type": "text/plain; charset=utf-8",
				});
				response.end("not found\n");
				return;
			}
			response.writeHead(200, { "Content-Length": content.length });
			response.end(content);
			return;
		}

		let stats;
		try {
			stats = fs.statSync(absolutePath);
		} catch (error) {
			if (error?.code === "ENOENT") {
				response.writeHead(404, {
					"Content-Type": "text/plain; charset=utf-8",
				});
				response.end("not found\n");
				return;
			}
			response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("server error\n");
			return;
		}

		if (!stats.isFile()) {
			response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
			response.end("not a file\n");
			return;
		}

		response.writeHead(200, { "Content-Length": stats.size });
		fs.createReadStream(absolutePath).pipe(response);
	});
}

async function serveRegistry(args) {
	let options;
	try {
		options = parseServeArgs(args);
	} catch (error) {
		process.stderr.write(`nazare-dev registry serve error: ${error.message}\n`);
		return 1;
	}

	try {
		const rootStats = fs.statSync(options.root);
		if (!rootStats.isDirectory()) {
			throw new Error(`Registry root is not a directory: ${options.root}`);
		}
		const manifestPath = path.join(options.root, "nazare.registry.yml");
		if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
			throw new Error(`Missing registry manifest: ${manifestPath}`);
		}
	} catch (error) {
		process.stderr.write(`nazare-dev registry serve error: ${error.message}\n`);
		return 1;
	}

	const server = createRegistryServer(options.root, {
		gitRefs: options.gitRefs,
	});

	return new Promise((resolve) => {
		let settled = false;
		const finish = (code) => {
			if (settled) return;
			settled = true;
			resolve(code);
		};

		server.on("error", (error) => {
			process.stderr.write(
				`nazare-dev registry serve error: ${error.message}\n`,
			);
			finish(1);
		});

		server.listen(options.port, options.host, () => {
			const address = server.address();
			const port =
				typeof address === "object" && address ? address.port : options.port;
			const registryUrl = `http://${options.host}:${port}`;
			process.stdout.write(`Serving Nazare registry from ${options.root}\n`);
			process.stdout.write(`Registry URL: ${registryUrl}\n`);
			process.stdout.write(
				`Consumer init: nazare init --repo ${registryUrl} --ref refs/heads/main\n`,
			);
		});

		const shutdown = () => {
			server.close(() => finish(0));
		};
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
}

async function main(argv) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(HELP);
		return 0;
	}

	const [command, subcommand, ...rest] = argv;
	if (command === "registry" && subcommand === "serve") {
		return serveRegistry(rest);
	}

	process.stderr.write(
		`Unknown command: ${command}\nRun \`nazare-dev --help\` for usage.\n`,
	);
	return 1;
}

if (require.main === module) {
	main(process.argv.slice(2))
		.then((exitCode) => {
			process.exitCode = exitCode;
		})
		.catch((error) => {
			process.stderr.write(`nazare-dev error: ${error.message}\n`);
			process.exitCode = 1;
		});
}

module.exports = {
	createRegistryServer,
	isSafeRelativePath,
	parseServeArgs,
	readGitRefFile,
};
