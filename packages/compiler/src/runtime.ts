// The DOM runtime shipped as assets/nazare-runtime.js. Authored as a real,
// DOM-typed function so its logic is type-checked instead of living in an
// opaque string; emit ships its source via `nazareRuntime.toString()`. It is
// self-contained (no imports, no closure captures) so the body stands alone,
// and its behavior is covered by the vm tests in tests/runtime.test.mjs.

type ParseKind = string; // "number" | "boolean" | anything else = pass-through
type DataDescriptor = Record<string, Record<string, ParseKind>>;

type IslandContext = {
	root: HTMLElement;
	refs: Record<string, HTMLElement | null>;
	data: Record<string, Record<string, unknown>>;
};
type IslandSetup = (context: IslandContext) => void;

type NazareGlobal = {
	island: (setup: IslandSetup) => IslandSetup;
	register: (
		name: string,
		placement: string | null,
		setup: IslandSetup,
		descriptor: DataDescriptor,
	) => void;
	mount: (
		name: string,
		placement: string | null,
		setup: IslandSetup,
		descriptor: DataDescriptor,
	) => void;
};

function nazareRuntime(): void {
	"use strict";
	const win = window as unknown as { Nazare?: NazareGlobal };
	if (win.Nazare) return;

	function island(setup: IslandSetup): IslandSetup {
		return setup;
	}
	function refLookup(root: HTMLElement, key: string): HTMLElement | null {
		if (root.getAttribute("data-nz-ref") === key) return root;
		return root.querySelector<HTMLElement>('[data-nz-ref="' + key + '"]');
	}
	function parseValue(raw: string | undefined, kind: ParseKind): unknown {
		if (raw === undefined) return undefined;
		if (kind === "number") return Number(raw);
		if (kind === "boolean") return raw === "true";
		return raw;
	}
	function buildData(
		root: HTMLElement,
		descriptor: DataDescriptor,
	): Record<string, Record<string, unknown>> {
		const data: Record<string, Record<string, unknown>> = {};
		Object.keys(descriptor || {}).forEach(function (refName) {
			const element = refLookup(root, refName);
			const entry: Record<string, unknown> = {};
			Object.keys(descriptor[refName]).forEach(function (property) {
				const raw = element ? element.dataset[property] : undefined;
				entry[property] = parseValue(raw, descriptor[refName][property]);
			});
			data[refName] = entry;
		});
		return data;
	}
	function mountRoots(
		componentRoot: HTMLElement,
		placement: string | null,
	): HTMLElement[] {
		if (!placement) return [componentRoot];
		const targets: HTMLElement[] = [];
		if (componentRoot.getAttribute("data-nz-island") === placement) {
			targets.push(componentRoot);
		}
		componentRoot
			.querySelectorAll<HTMLElement>('[data-nz-island="' + placement + '"]')
			.forEach(function (element) {
				targets.push(element);
			});
		return targets;
	}
	function mount(
		name: string,
		placement: string | null,
		setup: IslandSetup,
		descriptor: DataDescriptor,
	): void {
		document
			.querySelectorAll<HTMLElement>('[data-nz-component="' + name + '"]')
			.forEach(function (componentRoot) {
				mountRoots(componentRoot, placement).forEach(function (root) {
					const host = root as unknown as { nazareMounted?: IslandSetup[] };
					if (!host.nazareMounted) host.nazareMounted = [];
					if (host.nazareMounted.indexOf(setup) !== -1) return;
					host.nazareMounted.push(setup);
					const refs = new Proxy(
						{},
						{
							get: function (_target, key) {
								if (typeof key !== "string") return undefined;
								return refLookup(root, key);
							},
						},
					) as Record<string, HTMLElement | null>;
					setup({ root: root, refs: refs, data: buildData(root, descriptor) });
				});
			});
	}
	function register(
		name: string,
		placement: string | null,
		setup: IslandSetup,
		descriptor: DataDescriptor,
	): void {
		if (typeof setup !== "function") return;
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", function () {
				mount(name, placement, setup, descriptor);
			});
		} else {
			mount(name, placement, setup, descriptor);
		}
	}
	win.Nazare = { island: island, register: register, mount: mount };
}

/** The runtime asset's contents: the type-checked function, self-invoked. */
export const runtimeSource = `/* Nazare runtime */\n(${nazareRuntime.toString()})();\n`;
