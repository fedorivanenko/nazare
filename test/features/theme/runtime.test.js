import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeContent } from "../../../theme/default/nazare/vite-plugin.js";

const MODULES_DECLARATION = `const modules = {
  ...import.meta.glob("./sections/*.js"),
  ...import.meta.glob("./snippets/*.js"),
  ...import.meta.glob("./behaviors/*.js"),
};`;

class FakeElement {
	constructor(nazareUse = null, children = []) {
		this.children = children;
		this.listeners = new Map();
		this.dataset = nazareUse ? { nazareUse } : {};
	}

	matches(selector) {
		return selector === "[data-nazare-use]" && Boolean(this.dataset.nazareUse);
	}

	querySelectorAll(selector) {
		const matches = [];

		for (const child of this.children) {
			if (child.matches(selector)) matches.push(child);
			matches.push(...child.querySelectorAll(selector));
		}

		return matches;
	}

	addEventListener(type, listener) {
		const listeners = this.listeners.get(type) ?? [];
		listeners.push(listener);
		this.listeners.set(type, listeners);
	}

	dispatchEvent(event) {
		for (const listener of this.listeners.get(event.type) ?? []) {
			listener(event);
		}
	}
}

async function importRuntime(modules = {}) {
	globalThis.__nazareRuntimeTestModules = modules;
	globalThis.document = new FakeElement();

	const source = runtimeContent().replace(
		MODULES_DECLARATION,
		"const modules = globalThis.__nazareRuntimeTestModules;",
	);
	const encoded = Buffer.from(source, "utf8").toString("base64");

	return import(`data:text/javascript;base64,${encoded}#${randomUUID()}`);
}

afterEach(() => {
	delete globalThis.__nazareRuntimeTestModules;
	delete globalThis.document;
	vi.restoreAllMocks();
});

describe("generated Nazare runtime", () => {
	it("initializes matching data-nazare-use nodes once per module key", async () => {
		const init = vi.fn();
		const runtime = await importRuntime({
			"./snippets/c-video.js": async () => ({ init }),
		});
		const root = new FakeElement(null, [new FakeElement("snippets/c-video")]);
		const node = root.children[0];

		await runtime.initNazare(root);
		await runtime.initNazare(root);

		expect(init).toHaveBeenCalledTimes(1);
		expect(init).toHaveBeenCalledWith(node);
	});

	it("loads modules once and initializes each matching node", async () => {
		const init = vi.fn();
		const load = vi.fn(async () => ({ init }));
		const runtime = await importRuntime({
			"./snippets/c-video.js": load,
		});
		const root = new FakeElement(null, [
			new FakeElement("snippets/c-video"),
			new FakeElement("snippets/c-video"),
		]);

		await runtime.initNazare(root);

		expect(load).toHaveBeenCalledTimes(1);
		expect(init).toHaveBeenCalledTimes(2);
	});

	it("handles Shopify section load and unload events", async () => {
		const init = vi.fn();
		const destroy = vi.fn();
		const runtime = await importRuntime({
			"./sections/s-hero.js": async () => ({ init, destroy }),
		});
		const section = new FakeElement("sections/s-hero");

		globalThis.document.dispatchEvent({
			type: "shopify:section:load",
			target: section,
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(init).toHaveBeenCalledTimes(1);
		expect(init).toHaveBeenCalledWith(section);

		globalThis.document.dispatchEvent({
			type: "shopify:section:unload",
			target: section,
		});

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(destroy).toHaveBeenCalledWith(section);
		expect(runtime).toMatchObject({
			initNazare: expect.any(Function),
			destroyNazare: expect.any(Function),
		});
	});

	it("isolates import, init, and destroy failures", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const runtime = await importRuntime({
			"./snippets/c-import.js": async () => {
				throw new Error("import failed");
			},
			"./snippets/c-init.js": async () => ({
				init() {
					throw new Error("init failed");
				},
			}),
			"./snippets/c-destroy.js": async () => ({
				init() {},
				destroy() {
					throw new Error("destroy failed");
				},
			}),
		});
		const importNode = new FakeElement("snippets/c-import");
		const initNode = new FakeElement("snippets/c-init");
		const destroyNode = new FakeElement("snippets/c-destroy");
		const root = new FakeElement(null, [importNode, initNode, destroyNode]);

		await runtime.initNazare(root);
		runtime.destroyNazare(root);

		expect(warn).toHaveBeenCalledWith(
			"[nazare] Failed to import JS module for snippets/c-import",
			expect.any(Error),
		);
		expect(warn).toHaveBeenCalledWith(
			"[nazare] Failed to initialize JS module for snippets/c-init",
			expect.any(Error),
		);
		expect(warn).toHaveBeenCalledWith(
			"[nazare] Failed to destroy JS module for snippets/c-destroy",
			expect.any(Error),
		);
	});
});
