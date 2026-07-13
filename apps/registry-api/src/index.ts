#!/usr/bin/env node
// Self-host entrypoint: a node:http server backed by Postgres. DATABASE_URL is
// required — the server is DB-only by design (a folder has no atomic
// check-and-write, so it cannot honor immutability under concurrent publishes).
import { createHandler } from "./handler.js";
import { PostgresStore } from "./postgres.js";
import { startServer, tokensFromEnv } from "./server.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
	console.error(
		"DATABASE_URL is not set (the registry server is Postgres-backed).",
	);
	process.exit(1);
}

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const tokens = tokensFromEnv(process.env);
if (tokens.length === 0) {
	console.error(
		"warning: no NAZARE_TOKENS set — publishing is disabled (reads only).",
	);
}

const handler = createHandler({
	store: new PostgresStore(connectionString),
	tokens,
});

startServer(handler, port).then(() => {
	console.log(`nazare registry listening on :${port}`);
});
