// `nazare preview serve` — the workbench, rebuilt as you type.
//
// This is the same build, held in memory and repeated on change. It adds no
// compilation strategy of its own: a file changes, `collectPreview` reads the
// directory again, `renderCollection` renders it, and the pages are the same
// strings `preview build` would have written. The passes are pure, so a server
// is a thin I/O shell around them — which is the whole reason they are pure.
//
// Invalidation is deliberately blunt: everything is recompiled and re-rendered,
// rather than tracing which components depend on the file that changed. The
// compiler models `{% render %}` edges and could answer that precisely, but the
// dependency map is a second source of truth to keep correct, and at the size a
// theme actually reaches the whole rebuild costs tens of milliseconds. Precision
// here should arrive with a measurement behind it, not before one.
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import {
	galleryPage,
	type RenderedComponent,
	storyDocuments,
	workbenchPage,
} from "@nazare/preview";
import type { CliOptions } from "./options.js";
import type { Output } from "./output.js";
import {
	collectPreview,
	type PreviewCollection,
	previewSource,
	renderCollection,
} from "./preview-command.js";

const DEFAULT_PORT = 4173;

/** Long enough to coalesce an editor's save, short enough to feel immediate. */
const DEBOUNCE_MS = 60;

const EVENTS_PATH = "/__events";

const CONTENT_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

type ServerState = {
	pages: Map<string, string>;
	/** Emitted assets, by file name. A theme's own assets are read from disk. */
	assets: Map<string, string>;
	collection: PreviewCollection;
	rendered: RenderedComponent[];
};

/** Everything the server answers with, built the way the build command builds. */
async function buildState(
	dir: string,
	label: string,
	previous?: ServerState,
): Promise<ServerState | undefined> {
	const collection = await collectPreview(dir);
	if (!collection) return undefined;
	const fresh = await renderCollection(collection);

	// A story file is written by hand, so it spends time being invalid — every
	// keystroke between `{` and a closing brace. Dropping the component while
	// that is true takes away the page you are editing against, so its last good
	// render is kept and the parse error is reported instead.
	const carried = new Map(
		(previous?.rendered ?? []).map((entry) => [entry.component.name, entry]),
	);
	const rendered = [...fresh];
	for (const name of collection.malformedComponents) {
		if (rendered.some((entry) => entry.component.name === name)) continue;
		const stale = carried.get(name);
		if (stale) rendered.push(stale);
	}
	// Sidebar order is the order the directory was walked, whatever was carried.
	const order = collection.compiled.map((entry) => entry.component.name);
	rendered.sort(
		(left, right) =>
			order.indexOf(left.component.name) - order.indexOf(right.component.name),
	);

	const pages = new Map<string, string>();
	// The shell reloads itself when the server says something changed; that is
	// the only difference between these pages and the ones written to disk.
	pages.set(
		"/index.html",
		workbenchPage(rendered, {
			title: `${label} — Nazare preview`,
			storyBase: "/stories/",
			source: previewSource(dir, label),
			liveReload: EVENTS_PATH,
		}),
	);
	pages.set(
		"/all.html",
		galleryPage(rendered, {
			title: `${label} — every story`,
			storyBase: "/stories/",
		}),
	);
	// `base` is "/" rather than "../": served, a story document is addressed
	// absolutely, so the assets its template asks for resolve from the root.
	for (const file of storyDocuments(rendered, { base: "/" })) {
		pages.set(`/stories/${file.path}`, file.contents);
	}

	const assets = new Map<string, string>();
	for (const { component } of rendered) {
		for (const asset of component.assets) {
			assets.set(asset.path.split("/").pop() as string, asset.contents);
		}
	}

	return { pages, assets, collection, rendered };
}

/** Reports what a rebuild found, in the same words the build command uses. */
function report(state: ServerState, output: Output): void {
	for (const message of state.collection.malformed) output.error(message);
	const stories = state.rendered.reduce(
		(total, entry) => total + entry.stories.length,
		0,
	);
	const failed = state.rendered.reduce(
		(total, entry) =>
			total + entry.stories.filter((story) => story.error).length,
		0,
	);
	output.log(
		`${state.rendered.length} components, ${stories} stories${
			failed > 0 ? `, ${failed} failed to render` : ""
		}`,
	);
}

export async function runPreviewServe(
	dir: string,
	label: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	let state = await buildState(dir, label);
	if (!state) {
		output.error(
			`Nothing to preview in ${dir}. Expected a theme (snippets/, sections/, blocks/) or a directory of packages (folders with nazare.json).`,
		);
		return 1;
	}
	if (state.rendered.length === 0) {
		output.error(
			`No story files in ${dir}. A component appears once it has stories: write a <name>.stories.json beside a template, or run \`nazare preview scaffold <file>\` to draft one.`,
		);
		return 1;
	}

	const clients = new Set<ServerResponse>();
	const port = Number(cliOptions.port) || DEFAULT_PORT;

	const server = createServer(async (request, response) => {
		const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
		const path = url.pathname === "/" ? "/index.html" : url.pathname;

		// The reload channel. Held open, so it is never a page the router serves.
		if (path === EVENTS_PATH) {
			response.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			response.write(": connected\n\n");
			clients.add(response);
			request.on("close", () => clients.delete(response));
			return;
		}

		const page = state?.pages.get(path);
		if (page !== undefined) {
			// Never cached: the point of this server is that the answer changes.
			response.writeHead(200, {
				"content-type": "text/html; charset=utf-8",
				"cache-control": "no-store",
			});
			response.end(page);
			return;
		}

		if (path.startsWith("/assets/")) {
			const name = path.slice("/assets/".length);
			const emitted = state?.assets.get(name);
			if (emitted !== undefined) {
				response.writeHead(200, {
					"content-type": CONTENT_TYPES[extname(name)] ?? "text/plain",
					"cache-control": "no-store",
				});
				response.end(emitted);
				return;
			}
			// A theme's own assets live in the theme, where `asset_url` points.
			try {
				const contents = await readFile(join(dir, "assets", name));
				response.writeHead(200, {
					"content-type": CONTENT_TYPES[extname(name)] ?? "text/plain",
					"cache-control": "no-store",
				});
				response.end(contents);
				return;
			} catch {
				// Falls through to the 404 below.
			}
		}

		response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		response.end(`Not found: ${path}`);
	});

	await new Promise<void>((ready, failed) => {
		server.once("error", failed);
		server.listen(port, ready);
	});

	output.log(`  nazare preview  ·  http://localhost:${port}`);
	output.log("");
	report(state, output);
	if (state.collection.undeclared.length > 0) {
		const count = state.collection.undeclared.length;
		output.log(
			`skipped ${count} template${count === 1 ? "" : "s"} with no story file`,
		);
	}
	output.log("watching for changes");

	// One rebuild at a time, and the next one waits rather than interleaving:
	// two rebuilds racing would publish whichever finished last, not whichever
	// read the newer files.
	let rebuilding: Promise<void> = Promise.resolve();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const rebuild = (): void => {
		rebuilding = rebuilding.then(async () => {
			const started = Date.now();
			try {
				const next = await buildState(dir, label, state);
				// A directory that stopped being previewable keeps the last good
				// pages: an editor mid-rename is not a reason to serve nothing.
				if (!next || next.rendered.length === 0) {
					output.error(
						"nothing to preview after that change; keeping the last build",
					);
					return;
				}
				state = next;
				report(state, output);
				output.log(`rebuilt in ${Date.now() - started}ms`);
			} catch (error) {
				// A compile that throws leaves the previous pages in place, so the
				// page you are looking at survives a half-typed tag.
				output.error(
					`rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				return;
			}
			for (const client of clients) client.write("data: reload\n\n");
		});
	};

	const watcher = watch(dir, { recursive: true }, (_event, filename) => {
		const name = filename?.toString().split("\\").join("/");
		if (!name) return;
		// Our own output is not an input. Without this the server rebuilds
		// because it rebuilt.
		if (name.startsWith(".nazare-out/") || name.includes("/.nazare-out/")) {
			return;
		}
		if (!/\.(liquid|json|css|js|ts|svg|png|jpe?g|webp|woff2?)$/.test(name)) {
			return;
		}
		if (timer) clearTimeout(timer);
		timer = setTimeout(rebuild, DEBOUNCE_MS);
	});

	// Runs until interrupted: the command is the server.
	await new Promise<void>((stop) => {
		const shutdown = () => {
			watcher.close();
			for (const client of clients) client.end();
			server.close(() => stop());
		};
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
	return 0;
}

/** Exposed for tests: the pages a serve would answer with, without listening. */
export async function previewServerState(
	dir: string,
	label = dir,
	previous?: ServerState,
): Promise<ServerState | undefined> {
	return await buildState(dir, label, previous);
}
