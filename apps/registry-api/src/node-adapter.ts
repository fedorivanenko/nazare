// Bridges Node's (req, res) to the pure Web-Request handler. Used by both the
// standalone node:http server and the Vercel function, so the two deploy paths
// run the exact same handler with no divergence.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Handler } from "./handler.js";

const BODYLESS = new Set(["GET", "HEAD"]);

export async function respond(
	req: IncomingMessage,
	res: ServerResponse,
	handler: Handler,
): Promise<void> {
	try {
		const response = await handler(toWebRequest(req));
		const body = Buffer.from(await response.arrayBuffer());
		res.writeHead(response.status, headersToObject(response.headers));
		res.end(body);
	} catch {
		res.writeHead(500, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				error: { code: "INTERNAL", message: "Internal server error" },
			}),
		);
	}
}

function toWebRequest(req: IncomingMessage): Request {
	const host = req.headers.host ?? "localhost";
	const method = req.method ?? "GET";
	const url = `http://${host}${req.url ?? "/"}`;

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (Array.isArray(value)) {
			for (const item of value) headers.append(key, item);
		} else if (value !== undefined) {
			headers.set(key, value);
		}
	}

	if (BODYLESS.has(method)) {
		return new Request(url, { method, headers });
	}
	return new Request(url, {
		method,
		headers,
		body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
		// Required when streaming a request body under the fetch API.
		duplex: "half",
	} as RequestInit & { duplex: "half" });
}

function headersToObject(headers: Headers): Record<string, string> {
	const object: Record<string, string> = {};
	headers.forEach((value, key) => {
		object[key] = value;
	});
	return object;
}
