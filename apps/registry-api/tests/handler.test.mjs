import assert from "node:assert/strict";
import test from "node:test";
import { HttpRegistry } from "@nazare/registry";
import { createHandler } from "../dist/handler.js";
import { startServer, tokensFromEnv } from "../dist/server.js";
import { InMemoryStore } from "../dist/store.js";

const TOKEN = "secret-token";

const component = (overrides = {}) => ({
	id: "@nazare/counter",
	version: "0.1.0",
	dependencies: {},
	files: { "nazare.json": "{}", "counter.ts": "export const c = 1;\n" },
	...overrides,
});

function handlerWith(store = new InMemoryStore(), options = {}) {
	return createHandler({ store, tokens: [TOKEN], ...options });
}

const url = (path) => `http://registry.test${path}`;

async function call(handler, method, path, { token, body } = {}) {
	const headers = {};
	if (token) headers.authorization = `Bearer ${token}`;
	if (body !== undefined) headers["content-type"] = "application/json";
	const response = await handler(
		new Request(url(path), {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
	);
	const text = await response.text();
	return {
		status: response.status,
		body: text ? JSON.parse(text) : undefined,
		cacheControl: response.headers.get("cache-control"),
	};
}

test("GET metadata for an unknown component is 404", async () => {
	const res = await call(handlerWith(), "GET", "/components/nazare/nope");
	assert.equal(res.status, 404);
	assert.equal(res.body.error.code, "COMPONENT_NOT_FOUND");
});

test("publish requires a valid bearer token", async () => {
	const handler = handlerWith();
	const path = "/components/nazare/counter/0.1.0";

	const none = await call(handler, "PUT", path, { body: component() });
	assert.equal(none.status, 401);
	assert.equal(none.body.error.code, "UNAUTHORIZED");

	const wrong = await call(handler, "PUT", path, {
		token: "nope",
		body: component(),
	});
	assert.equal(wrong.status, 401);
});

test("publish, then fetch metadata / exact / latest", async () => {
	const handler = handlerWith();

	const put = await call(handler, "PUT", "/components/nazare/counter/0.1.0", {
		token: TOKEN,
		body: component(),
	});
	assert.equal(put.status, 201);

	const meta = await call(handler, "GET", "/components/nazare/counter");
	assert.equal(meta.status, 200);
	assert.deepEqual(meta.body, {
		id: "@nazare/counter",
		latest: "0.1.0",
		versions: ["0.1.0"],
	});

	const exact = await call(handler, "GET", "/components/nazare/counter/0.1.0");
	assert.equal(exact.status, 200);
	assert.equal(exact.body.id, "@nazare/counter");

	const latest = await call(
		handler,
		"GET",
		"/components/nazare/counter/latest",
	);
	assert.equal(latest.status, 200);
	assert.equal(latest.body.version, "0.1.0");
});

test("GET responses set CDN cache policy by route mutability", async () => {
	const handler = handlerWith();
	await call(handler, "PUT", "/components/nazare/counter/0.1.0", {
		token: TOKEN,
		body: component(),
	});

	const meta = await call(handler, "GET", "/components/nazare/counter");
	assert.equal(
		meta.cacheControl,
		"public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
	);

	const latest = await call(
		handler,
		"GET",
		"/components/nazare/counter/latest",
	);
	assert.equal(
		latest.cacheControl,
		"public, max-age=0, s-maxage=60, stale-while-revalidate=86400",
	);

	const exact = await call(handler, "GET", "/components/nazare/counter/0.1.0");
	assert.equal(
		exact.cacheControl,
		"public, max-age=0, s-maxage=31536000, immutable",
	);
});

test("non-cacheable responses opt out of storage", async () => {
	const handler = handlerWith();
	const put = await call(handler, "PUT", "/components/nazare/counter/0.1.0", {
		token: TOKEN,
		body: component(),
	});
	assert.equal(put.cacheControl, "no-store");

	const missing = await call(handler, "GET", "/components/nazare/nope");
	assert.equal(missing.cacheControl, "no-store");
});

test("republishing the same version is 409", async () => {
	const handler = handlerWith();
	const path = "/components/nazare/counter/0.1.0";
	await call(handler, "PUT", path, { token: TOKEN, body: component() });
	const again = await call(handler, "PUT", path, {
		token: TOKEN,
		body: component(),
	});
	assert.equal(again.status, 409);
	assert.equal(again.body.error.code, "VERSION_EXISTS");
});

test("an unknown exact version is 404", async () => {
	const res = await call(
		handlerWith(),
		"GET",
		"/components/nazare/counter/9.9.9",
	);
	assert.equal(res.status, 404);
	assert.equal(res.body.error.code, "VERSION_NOT_FOUND");
});

test("a malformed component id in the path is rejected", async () => {
	const res = await call(handlerWith(), "GET", "/components/Bad!/Name");
	assert.equal(res.status, 400);
	assert.equal(res.body.error.code, "MALFORMED_COMPONENT");
});

test("a file key that escapes the folder is refused", async () => {
	const handler = handlerWith();
	const res = await call(handler, "PUT", "/components/nazare/counter/0.1.0", {
		token: TOKEN,
		body: component({ files: { "../../etc/passwd": "x" } }),
	});
	assert.equal(res.status, 400);
	assert.match(res.body.error.message, /unsafe file path/);
});

test("id / version mismatch between path and body is refused", async () => {
	const handler = handlerWith();
	const res = await call(handler, "PUT", "/components/nazare/counter/0.1.0", {
		token: TOKEN,
		body: component({ version: "0.2.0" }),
	});
	assert.equal(res.status, 400);
	assert.match(res.body.error.message, /version must equal/);
});

test("versions are canonical x.y.z", async () => {
	const handler = handlerWith();
	const res = await call(handler, "PUT", "/components/nazare/counter/1.0", {
		token: TOKEN,
		body: component({ version: "1.0" }),
	});
	assert.equal(res.status, 400);
	assert.match(res.body.error.message, /Invalid version/);
});

test("invalid JSON body is 400, not 500", async () => {
	const handler = handlerWith();
	const response = await handler(
		new Request(url("/components/nazare/counter/0.1.0"), {
			method: "PUT",
			headers: { authorization: `Bearer ${TOKEN}` },
			body: "{ not json",
		}),
	);
	assert.equal(response.status, 400);
});

test("a body over the cap is 413", async () => {
	const handler = handlerWith(new InMemoryStore(), { maxBodyBytes: 64 });
	const big = component({ files: { "big.ts": "x".repeat(500) } });
	const res = await call(handler, "PUT", "/components/nazare/counter/0.1.0", {
		token: TOKEN,
		body: big,
	});
	assert.equal(res.status, 413);
});

test("tokensFromEnv parses NAZARE_TOKENS and NAZARE_TOKEN", () => {
	assert.deepEqual(tokensFromEnv({ NAZARE_TOKENS: "a, b ,c" }), [
		"a",
		"b",
		"c",
	]);
	assert.deepEqual(tokensFromEnv({ NAZARE_TOKEN: "solo" }), ["solo"]);
	assert.deepEqual(tokensFromEnv({}), []);
});

test("end to end: HttpRegistry drives the running server over a socket", async () => {
	const handler = handlerWith();
	const server = await startServer(handler, 0);
	try {
		const { port } = server.address();
		const registry = new HttpRegistry(`http://127.0.0.1:${port}`);

		assert.equal(await registry.fetchMetadata("@nazare/counter"), undefined);

		const published = await registry.publish(component(), TOKEN);
		assert.equal(published.ok, true);

		const meta = await registry.fetchMetadata("@nazare/counter");
		assert.equal(meta.latest, "0.1.0");
		const fetched = await registry.fetchComponent("@nazare/counter", "0.1.0");
		assert.deepEqual(fetched.files, component().files);

		const again = await registry.publish(component(), TOKEN);
		assert.equal(again.ok, false);
		assert.equal(again.code, "VERSION_EXISTS");
	} finally {
		server.close();
	}
});
