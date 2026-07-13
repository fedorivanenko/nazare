// Standalone node:http server for self-hosting. The same handler also runs as a
// Vercel function (see api/index.ts); this is the run-it-yourself path.
import { createServer, type Server } from "node:http";
import type { Handler } from "./handler.js";
import { respond } from "./node-adapter.js";

export function startServer(handler: Handler, port: number): Promise<Server> {
	const server = createServer((req, res) => {
		void respond(req, res, handler);
	});
	return new Promise((resolve) => {
		server.listen(port, () => resolve(server));
	});
}

/** Parses accepted publish tokens from NAZARE_TOKENS (comma-separated). */
export function tokensFromEnv(
	env: Record<string, string | undefined>,
): string[] {
	const raw = env.NAZARE_TOKENS ?? env.NAZARE_TOKEN ?? "";
	return raw
		.split(",")
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}
