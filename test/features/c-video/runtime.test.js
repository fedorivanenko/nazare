import { afterEach, describe, expect, it, vi } from "vitest";
import { destroy, init } from "../../../components/c-video/c-video.js";

class FakeNode {
	constructor() {
		this.attributes = new Map();
		this.listeners = new Map();
		this.textContent = "";
		this.hidden = false;
		this.isConnected = true;
	}

	setAttribute(name, value) {
		this.attributes.set(name, value);
	}

	getAttribute(name) {
		return this.attributes.get(name);
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

class FakeVideo extends FakeNode {
	constructor() {
		super();
		this.paused = true;
		this.muted = false;
		this.volume = 1;
		this.currentTime = 0;
		this.play = vi.fn(() => {
			this.paused = false;
			this.dispatchEvent("play");
			return Promise.resolve();
		});
		this.pause = vi.fn(() => {
			this.paused = true;
			this.dispatchEvent("pause");
		});
	}
}

class FakeRoot extends FakeNode {
	constructor() {
		super();
		this.video = new FakeVideo();
		this.thumbnail = new FakeNode();
		this.playButton = new FakeNode();
		this.playLabel = new FakeNode();
		this.muteButton = new FakeNode();
		this.muteLabel = new FakeNode();
	}

	querySelector(selector) {
		return {
			video: this.video,
			"[data-c-video-thumbnail]": this.thumbnail,
			"[data-c-video-play]": this.playButton,
			"[data-c-video-play-label]": this.playLabel,
			"[data-c-video-mute]": this.muteButton,
			"[data-c-video-mute-label]": this.muteLabel,
		}[selector];
	}
}

function makeRoot() {
	return new FakeRoot();
}

afterEach(() => {
	delete globalThis.window;
	vi.restoreAllMocks();
});

describe("c-video JavaScript", () => {
	it("initializes muted controls and registers one instance per root", () => {
		globalThis.window = {};
		const root = makeRoot();

		init(root);
		init(root);

		expect(root.video.muted).toBe(true);
		expect(root.playLabel.textContent).toBe("Play");
		expect(root.playButton.getAttribute("aria-label")).toBe("Play video");
		expect(root.muteLabel.textContent).toBe("Unmute");
		expect(root.muteButton.getAttribute("aria-label")).toBe("Unmute video");
		expect(root.thumbnail.hidden).toBe(false);
		expect(window.NazareVideoStore.instances.size).toBe(1);
		expect(root.playButton.listenerCount("click")).toBe(1);
	});

	it("toggles playback from play button and thumbnail", () => {
		globalThis.window = {};
		const root = makeRoot();
		init(root);

		root.playButton.dispatchEvent("click");

		expect(root.video.play).toHaveBeenCalledTimes(1);
		expect(root.playLabel.textContent).toBe("Pause");
		expect(root.playButton.getAttribute("aria-label")).toBe("Pause video");
		expect(root.thumbnail.hidden).toBe(true);

		root.playButton.dispatchEvent("click");

		expect(root.video.pause).toHaveBeenCalledTimes(1);
		expect(root.playLabel.textContent).toBe("Play");
		expect(root.thumbnail.hidden).toBe(false);

		root.thumbnail.dispatchEvent("click");

		expect(root.video.play).toHaveBeenCalledTimes(2);
	});

	it("unmuting one instance mutes other registered instances", () => {
		globalThis.window = {};
		const first = makeRoot();
		const second = makeRoot();
		init(first);
		init(second);

		first.muteButton.dispatchEvent("click");
		second.muteButton.dispatchEvent("click");

		expect(first.video.muted).toBe(true);
		expect(first.muteLabel.textContent).toBe("Unmute");
		expect(second.video.muted).toBe(false);
		expect(second.muteLabel.textContent).toBe("Mute");
	});

	it("unregisters and removes listeners on destroy", () => {
		globalThis.window = {};
		const root = makeRoot();
		init(root);

		destroy(root);
		root.playButton.dispatchEvent("click");

		expect(window.NazareVideoStore.instances.size).toBe(0);
		expect(root.playButton.listenerCount("click")).toBe(0);
		expect(root.video.play).not.toHaveBeenCalled();
	});
});
