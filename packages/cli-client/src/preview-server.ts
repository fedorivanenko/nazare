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
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import { basename, extname, join } from "node:path";
import {
	componentId,
	galleryPage,
	parseStoryFile,
	type RenderedComponent,
	renderComponentStories,
	resolveFixtures,
	snippetLibrary,
	storyDocument,
	storyDocuments,
	workbenchPage,
} from "@nazare/preview";
import { isMissingFileError } from "./inspect-input.js";
import type { CliOptions } from "./options.js";
import type { Output } from "./output.js";
import {
	collectPreview,
	fixtureReader,
	type PreviewCollection,
	previewSource,
	renderCollection,
} from "./preview-command.js";

const DEFAULT_PORT = 4173;

/** Long enough to coalesce an editor's save, short enough to feel immediate. */
const DEBOUNCE_MS = 60;

const EVENTS_PATH = "/__events";
const SAVE_PATH = "/__save";
const RENDER_PATH = "/__render";

export function previewPort(value: string | undefined): number {
	if (value === undefined) return DEFAULT_PORT;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(
			`Invalid --port ${value}; expected an integer from 1 to 65535`,
		);
	}
	return port;
}

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
	/** Anything about the checkout the header could not answer, said once. */
	sourceProblem?: string;
	/** Kept so a draft render resolves a `$file` the same way the build did. */
	readFixture: (path: string) => unknown;
	snippets: Record<string, string>;
};

/** Everything the server answers with, built the way the build command builds. */
async function buildState(
	dir: string,
	label: string,
	previous?: ServerState,
): Promise<ServerState | undefined> {
	const collection = await collectPreview(dir);
	if (!collection || collection === "missing") return undefined;
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

	// The file behind each component, as text, so the panel can offer the file
	// itself and not only what a form can express.
	const storyFiles: Record<string, { path: string; contents: string }> = {};
	for (const entry of collection.compiled) {
		let contents: string;
		try {
			contents = await readFile(join(dir, entry.storyFile), "utf8");
		} catch (error) {
			if (isMissingFileError(error)) continue;
			throw new Error(
				`Unable to read ${entry.storyFile}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
		storyFiles[componentId(entry.component.name)] = {
			path: entry.storyFile,
			contents,
		};
	}

	const revision = previewSource(dir, label);
	const pages = new Map<string, string>();
	// The shell reloads itself when the server says something changed; that is
	// the only difference between these pages and the ones written to disk.
	pages.set(
		"/index.html",
		workbenchPage(rendered, {
			title: `${label} — Nazare preview`,
			storyBase: "/stories/",
			source: revision.source,
			liveReload: EVENTS_PATH,
			saveEndpoint: SAVE_PATH,
			renderEndpoint: RENDER_PATH,
			storyFiles,
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

	const assets = new Map<string, { contents: string; source: string }>();
	for (const { component } of rendered) {
		for (const asset of component.assets) {
			const name = basename(asset.path);
			const existing = assets.get(name);
			if (existing && existing.contents !== asset.contents) {
				throw new Error(
					`Preview asset collision: ${existing.source} and ${component.file}:${asset.path} both emit assets/${name}`,
				);
			}
			assets.set(name, {
				contents: asset.contents,
				source: `${component.file}:${asset.path}`,
			});
		}
	}

	return {
		pages,
		assets: new Map([...assets].map(([name, asset]) => [name, asset.contents])),
		collection,
		rendered,
		...(revision.problem ? { sourceProblem: revision.problem } : {}),
		readFixture: fixtureReader(dir).read,
		snippets: snippetLibrary(collection.compiled.map((one) => one.component)),
	};
}

type SaveRequest = {
	component?: unknown;
	story?: unknown;
	props?: unknown;
	/** The whole story file as text, when the panel is editing the file itself. */
	file?: unknown;
	/** `create` or `delete`; absent means update the named story's props. */
	action?: unknown;
};

/**
 * Writes one story's props back to the file it came from.
 *
 * The workbench can only offer this because the file is the single source of
 * cases: there is one place the story lives, and editing it there is the same
 * act as editing it in a text editor. What is written goes back through
 * `parseStoryFile`, so the GUI cannot produce a file `preview check` would
 * reject — the editor is held to the format it is editing.
 */
export async function saveStoryFile(
	dir: string,
	state: ServerState,
	body: SaveRequest,
): Promise<string | undefined> {
	if (typeof body.component !== "string") return "component is required";
	const editingFile = typeof body.file === "string";
	const editingSet = body.action === "create" || body.action === "delete";
	if (!editingFile) {
		if (typeof body.story !== "string") return "story is required";
		if (
			!editingSet &&
			(body.props === null || typeof body.props !== "object")
		) {
			return "props must be an object";
		}
	}
	const entry = state.collection.compiled.find(
		({ component }) => componentId(component.name) === body.component,
	);
	if (!entry) return `unknown component ${body.component}`;

	const path = join(dir, entry.storyFile);

	// The file itself, edited as text. Everything a form cannot express lives
	// here — a note, an explicit null, a story that does not exist yet, the
	// order they appear in — and it is checked exactly as a hand edit would be.
	if (editingFile) {
		const text = body.file as string;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			return `invalid JSON: ${
				error instanceof Error ? error.message : String(error)
			}`;
		}
		try {
			parseStoryFile(
				state.collection.layout === "package"
					? ((parsed as { preview?: unknown }).preview ?? {})
					: parsed,
				entry.storyFile,
			);
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		// Written as given: the author's own formatting is theirs to keep.
		await writeFile(path, text.endsWith("\n") ? text : `${text}\n`);
		return undefined;
	}
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		return `cannot read ${entry.storyFile}: ${error instanceof Error ? error.message : String(error)}`;
	}

	let document: Record<string, unknown>;
	try {
		document = JSON.parse(raw) as Record<string, unknown>;
	} catch (error) {
		return `${entry.storyFile}: invalid JSON: ${
			error instanceof Error ? error.message : String(error)
		}`;
	}

	if (state.collection.layout === "package" && !document.preview) {
		document.preview = {};
	}
	// A theme keeps its cases at the top level; a package keeps them under
	// `preview`, next to everything else that describes the package.
	const holder =
		state.collection.layout === "package"
			? (document.preview as Record<string, unknown>)
			: document;
	const stories = holder.stories;
	if (!Array.isArray(stories)) return `${entry.storyFile} declares no stories`;

	const index = stories.findIndex(
		(candidate) =>
			(candidate as { name?: unknown } | undefined)?.name === body.story,
	);

	// Creating and deleting a case are edits to the set, not to a story, so they
	// are the two that do not need one to exist first — or need it not to.
	if (body.action === "create") {
		if (index !== -1) return `${entry.storyFile} already has ${body.story}`;
		stories.push({ name: body.story });
		return await commit(path, document, holder, entry.storyFile, state);
	}
	if (body.action === "delete") {
		if (index === -1)
			return `${entry.storyFile} has no story named ${body.story}`;
		if (stories.length === 1) {
			// A component with no stories does not appear at all, so deleting the
			// last one deletes the component from the workbench. That is a thing to
			// do deliberately, in the file, not by clicking the last × in a list.
			return `${body.story} is the only story; a component with none does not appear`;
		}
		stories.splice(index, 1);
		return await commit(path, document, holder, entry.storyFile, state);
	}

	const story = stories[index] as Record<string, unknown> | undefined;
	if (!story) return `${entry.storyFile} has no story named ${body.story}`;

	const props = body.props as Record<string, unknown>;
	if (Object.keys(props).length > 0) story.props = props;
	else delete story.props;

	return await commit(path, document, holder, entry.storyFile, state);
}

/**
 * Checks before it writes, not after: a file this rejects is one the author
 * would otherwise have to repair by hand.
 */
async function commit(
	path: string,
	document: Record<string, unknown>,
	holder: Record<string, unknown>,
	name: string,
	state: ServerState,
): Promise<string | undefined> {
	try {
		parseStoryFile(
			state.collection.layout === "package" ? holder : document,
			name,
		);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
	return undefined;
}

/**
 * One story, rendered against props the panel is holding rather than the ones
 * on disk. Nothing is written and no rebuild happens: the file is still the
 * source of cases, and this is a look at what it would say if it changed.
 */
export async function renderStoryDraft(
	state: ServerState,
	body: { component?: unknown; story?: unknown; props?: unknown },
): Promise<{ html: string } | { refused: string }> {
	if (typeof body.component !== "string") {
		return { refused: "component is required" };
	}
	if (body.props === null || typeof body.props !== "object") {
		return { refused: "props must be an object" };
	}
	const entry = state.collection.compiled.find(
		({ component }) => componentId(component.name) === body.component,
	);
	if (!entry) return { refused: `unknown component ${body.component}` };

	const name = typeof body.story === "string" ? body.story : "draft";
	const [rendered] = (
		await renderComponentStories(
			entry.component,
			[
				{
					name,
					props: resolveFixtures(
						body.props as Record<string, unknown>,
						state.readFixture,
					),
				},
			],
			{ snippets: state.snippets },
		)
	).stories;
	return { html: storyDocument(entry.component, rendered, { base: "/" }) };
}

/** Reports what a rebuild found, in the same words the build command uses. */
function report(state: ServerState, output: Output): void {
	if (state.sourceProblem) output.error(state.sourceProblem);
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
	const port = previewPort(cliOptions.port);

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

		// A story rendered with values that are not on disk. This is what lets a
		// control repaint the canvas while the file it came from is untouched:
		// the same render as the build, run against the props the panel holds,
		// so what you are looking at is real rather than an optimistic guess.
		if (path === RENDER_PATH && request.method === "POST") {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			try {
				const body = JSON.parse(Buffer.concat(chunks).toString());
				const result = state
					? await renderStoryDraft(state, body)
					: { refused: "nothing is being served" };
				if ("refused" in result) {
					// Said, not swallowed: a draft that silently does nothing looks
					// exactly like one that rendered the same thing twice.
					response.writeHead(400, { "content-type": "text/plain" });
					response.end(result.refused);
					output.error(`draft refused: ${result.refused}`);
					return;
				}
				response.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				});
				response.end(result.html);
			} catch (error) {
				response.writeHead(400, { "content-type": "text/plain" });
				response.end(error instanceof Error ? error.message : String(error));
			}
			return;
		}

		// Editing a story writes the file it came from; the watcher does the rest,
		// so a save and a hand edit reach the page by exactly the same route.
		if (path === SAVE_PATH && request.method === "POST") {
			const chunks: Buffer[] = [];
			for await (const chunk of request) chunks.push(chunk as Buffer);
			let failure: string | undefined;
			try {
				failure = state
					? await saveStoryFile(
							dir,
							state,
							JSON.parse(Buffer.concat(chunks).toString()),
						)
					: "nothing is being served";
			} catch (error) {
				failure = error instanceof Error ? error.message : String(error);
			}
			response.writeHead(failure ? 400 : 200, {
				"content-type": "text/plain; charset=utf-8",
			});
			response.end(failure ?? "saved");
			if (failure) output.error(`save refused: ${failure}`);
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
			if (name.includes("/") || name.includes("\\") || name === "") {
				response.writeHead(400, {
					"content-type": "text/plain; charset=utf-8",
				});
				response.end(`Invalid asset path: ${path}`);
				return;
			}
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
			} catch (error) {
				if (!isMissingFileError(error)) {
					const message = `Unable to read asset ${name}: ${error instanceof Error ? error.message : String(error)}`;
					output.error(message);
					response.writeHead(500, {
						"content-type": "text/plain; charset=utf-8",
					});
					response.end(message);
					return;
				}
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
