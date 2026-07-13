// Vercel function form of the same server. The handler and Postgres store are
// created once per warm instance (module scope) and reused across invocations.
// api/index.ts re-exports this default so Vercel picks it up as a function.
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHandler, type Handler } from "./handler.js";
import { respond } from "./node-adapter.js";
import { PostgresStore } from "./postgres.js";
import { tokensFromEnv } from "./server.js";

let handler: Handler | undefined;

function getHandler(): Handler {
	if (handler) return handler;
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) throw new Error("DATABASE_URL is not set");
	handler = createHandler({
		store: new PostgresStore(connectionString),
		tokens: tokensFromEnv(process.env),
	});
	return handler;
}

export default function vercelHandler(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	return respond(req, res, getHandler());
}
