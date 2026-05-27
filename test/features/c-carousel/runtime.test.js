import { afterEach, describe, expect, it, vi } from "vitest";
import { destroy, init } from "../../../components/c-carousel/c-carousel.js";

class FakeNode {
	constructor() {
		this.listeners = new Map();
		this.dataset = {};
		this.style = {};
		this.children = [];
		this.firstElementChild = null;
		this.ownerDocument = { defaultView: globalThis.window };
	}

	addEventListener(eventName, handler) {
		const listeners = this.listeners.get(eventName) ?? [];
		listeners.push(handler);
		this.listeners.set(eventName, listeners);
	}

	removeEventListener(eventName, handler) {
		const listeners = this.listeners.get(eventName) ?? [];
		this.listeners.set(
			eventName,
			listeners.filter((listener) => listener !== handler),
		);
	}

	dispatchEvent(eventName) {
		for (const listener of this.listeners.get(eventName) ?? []) {
			listener({ type: eventName, target: this });
		}
	}

	listenerCount(eventName) {
		return this.listeners.get(eventName)?.length ?? 0;
	}
}

class FakeItem extends FakeNode {
	constructor(rect) {
		super();
		this.rect = rect;
	}

	getBoundingClientRect() {
		return this.rect;
	}
}

class FakeTrack extends FakeNode {
	constructor(items) {
		super();
		this.children = [...items];
		this.firstElementChild = this.children[0];
	}

	querySelectorAll(selector) {
		return selector === "[data-c-carousel-item]" ? [...this.children] : [];
	}

	appendChild(node) {
		this.children = this.children.filter((child) => child !== node);
		this.children.push(node);
		this.firstElementChild = this.children[0];
		return node;
	}

	insertBefore(node, before) {
		this.children = this.children.filter((child) => child !== node);
		const index = Math.max(0, this.children.indexOf(before));
		this.children.splice(index, 0, node);
		this.firstElementChild = this.children[0];
		return node;
	}
}

class FakeRoot extends FakeNode {
	constructor({ mode = "marquee", items }) {
		super();
		this.dataset = {
			cCarouselMode: mode,
			cCarouselDirection: "left",
			cCarouselSpeed: "normal",
			cCarouselPauseOnHover: "true",
		};
		this.viewport = new FakeNode();
		this.viewport.getBoundingClientRect = () => ({
			left: 0,
			right: 300,
			width: 300,
		});
		this.track = new FakeTrack(items);
	}

	querySelector(selector) {
		return {
			"[data-c-carousel-viewport]": this.viewport,
			"[data-c-carousel-track]": this.track,
		}[selector];
	}
}

function installWindow() {
	const frames = [];
	globalThis.window = new FakeNode();
	window.getComputedStyle = () => ({ columnGap: "10px", gap: "10px" });
	globalThis.requestAnimationFrame = vi.fn((callback) => {
		frames.push(callback);
		return frames.length;
	});
	globalThis.cancelAnimationFrame = vi.fn();
	return frames;
}

afterEach(() => {
	delete globalThis.window;
	delete globalThis.requestAnimationFrame;
	delete globalThis.cancelAnimationFrame;
	vi.restoreAllMocks();
});

describe("c-carousel JavaScript", () => {
	it("ignores static mode", () => {
		installWindow();
		const root = new FakeRoot({
			mode: "static",
			items: [new FakeItem({ left: 0, right: 100, width: 100 })],
		});

		init(root);

		expect(requestAnimationFrame).not.toHaveBeenCalled();
		expect(root.listenerCount("pointerenter")).toBe(0);
	});

	it("moves existing item nodes through marquee without cloning", () => {
		const frames = installWindow();
		const first = new FakeItem({ left: -120, right: -10, width: 110 });
		const second = new FakeItem({ left: 0, right: 100, width: 100 });
		const third = new FakeItem({ left: 120, right: 220, width: 100 });
		const root = new FakeRoot({ items: [first, second, third] });

		init(root);
		frames.shift()(0);
		frames.shift()(1000);

		expect(root.track.children).toHaveLength(3);
		expect(root.track.children).toEqual([second, third, first]);
		expect(new Set(root.track.children)).toEqual(
			new Set([first, second, third]),
		);
		expect(root.track.style.transform).toContain("translate3d");
	});

	it("pauses on hover and removes listeners on destroy", () => {
		const frames = installWindow();
		const first = new FakeItem({ left: 0, right: 180, width: 180 });
		const second = new FakeItem({ left: 200, right: 380, width: 180 });
		const root = new FakeRoot({ items: [first, second] });

		init(root);
		frames.shift()(0);
		root.dispatchEvent("pointerenter");
		frames.shift()(1000);
		const pausedTransform = root.track.style.transform;
		root.dispatchEvent("pointerleave");
		frames.shift()(2000);
		frames.shift()(3000);

		expect(pausedTransform).toBe("translate3d(0px, 0, 0)");
		expect(root.track.style.transform).not.toBe(pausedTransform);
		expect(root.listenerCount("pointerenter")).toBe(1);

		destroy(root);

		expect(cancelAnimationFrame).toHaveBeenCalled();
		expect(root.listenerCount("pointerenter")).toBe(0);
		expect(root.track.style.transform).toBe("");
	});
});
