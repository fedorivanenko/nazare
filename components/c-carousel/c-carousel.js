const mounts = new WeakMap();

const SPEEDS = {
	slow: 24,
	normal: 48,
	fast: 80,
};

function toNumber(value) {
	const number = Number.parseFloat(value);
	return Number.isFinite(number) ? number : 0;
}

function readGap(track) {
	const view = track.ownerDocument?.defaultView ?? window;
	const styles = view.getComputedStyle?.(track);
	return toNumber(styles?.columnGap || styles?.gap || "0");
}

function itemSpan(item, gap) {
	return item.getBoundingClientRect().width + gap;
}

function canAnimate(instance) {
	if (instance.items.length < 2) return false;
	const viewportRect = instance.viewport.getBoundingClientRect();
	if (viewportRect.width <= 0) return false;
	let totalWidth = 0;
	for (const item of instance.items) {
		const width = item.getBoundingClientRect().width;
		if (width <= 0) return false;
		totalWidth += width;
	}
	const totalGap = instance.gap * Math.max(0, instance.items.length - 1);
	return totalWidth + totalGap > viewportRect.width;
}

function applyTransform(instance) {
	instance.track.style.transform = `translate3d(${instance.offset}px, 0, 0)`;
}

function recycleLeft(instance) {
	let guard = instance.items.length;
	while (guard > 0) {
		const first = instance.items[0];
		const viewportRect = instance.viewport.getBoundingClientRect();
		const itemRect = first.getBoundingClientRect();
		if (itemRect.right > viewportRect.left) break;

		const span = itemSpan(first, instance.gap);
		instance.track.appendChild(first);
		instance.items.push(instance.items.shift());
		instance.offset += span;
		applyTransform(instance);
		guard -= 1;
	}
}

function recycleRight(instance) {
	let guard = instance.items.length;
	while (guard > 0) {
		const last = instance.items.at(-1);
		const viewportRect = instance.viewport.getBoundingClientRect();
		const itemRect = last.getBoundingClientRect();
		if (itemRect.left < viewportRect.right) break;

		const span = itemSpan(last, instance.gap);
		instance.track.insertBefore(last, instance.track.firstElementChild);
		instance.items.unshift(instance.items.pop());
		instance.offset -= span;
		applyTransform(instance);
		guard -= 1;
	}
}

function recycle(instance) {
	if (instance.direction === "right") {
		recycleRight(instance);
		return;
	}
	recycleLeft(instance);
}

function measure(instance) {
	instance.items = [
		...instance.track.querySelectorAll("[data-c-carousel-item]"),
	];
	instance.gap = readGap(instance.track);
	instance.enabled = canAnimate(instance);
	if (!instance.enabled) {
		instance.offset = 0;
		applyTransform(instance);
	}
}

function tick(instance, timestamp) {
	if (!mounts.has(instance.root)) return;

	if (instance.lastTimestamp == null) instance.lastTimestamp = timestamp;
	const delta = Math.max(0, timestamp - instance.lastTimestamp) / 1000;
	instance.lastTimestamp = timestamp;

	if (instance.enabled && !instance.paused) {
		const direction = instance.direction === "right" ? 1 : -1;
		instance.offset += direction * instance.speed * delta;
		applyTransform(instance);
		recycle(instance);
	}

	instance.frame = requestAnimationFrame((nextTimestamp) =>
		tick(instance, nextTimestamp),
	);
}

function setPaused(instance, paused) {
	instance.paused = paused;
	instance.lastTimestamp = null;
}

export function init(root) {
	if (mounts.has(root)) return;
	if (root.dataset.cCarouselMode !== "marquee") return;

	const viewport = root.querySelector("[data-c-carousel-viewport]");
	const track = root.querySelector("[data-c-carousel-track]");
	if (!viewport || !track) return;

	const instance = {
		root,
		viewport,
		track,
		items: [],
		gap: 0,
		offset: 0,
		lastTimestamp: null,
		frame: null,
		enabled: false,
		paused: false,
		direction: root.dataset.cCarouselDirection === "right" ? "right" : "left",
		speed: SPEEDS[root.dataset.cCarouselSpeed] ?? SPEEDS.normal,
		listeners: [],
	};

	function listen(node, eventName, handler) {
		node.addEventListener(eventName, handler);
		instance.listeners.push([node, eventName, handler]);
	}

	measure(instance);

	if (root.dataset.cCarouselPauseOnHover !== "false") {
		listen(root, "pointerenter", () => setPaused(instance, true));
		listen(root, "pointerleave", () => setPaused(instance, false));
		listen(root, "focusin", () => setPaused(instance, true));
		listen(root, "focusout", () => setPaused(instance, false));
	}

	listen(window, "resize", () => measure(instance));

	mounts.set(root, instance);
	instance.frame = requestAnimationFrame((timestamp) =>
		tick(instance, timestamp),
	);
}

export function destroy(root) {
	const instance = mounts.get(root);
	if (!instance) return;

	if (instance.frame != null) cancelAnimationFrame(instance.frame);
	for (const [node, eventName, handler] of instance.listeners) {
		node.removeEventListener(eventName, handler);
	}
	instance.track.style.transform = "";
	mounts.delete(root);
}
