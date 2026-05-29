const mounts = new WeakMap();
const DURATION = 1000;

function easeOut(t) {
	return 1 - Math.pow(1 - t, 3);
}

function animate(el, target, suffix, mount) {
	const start = performance.now();
	let rafId;

	function tick(now) {
		if (!mount.active) return;
		const elapsed = now - start;
		const progress = Math.min(elapsed / DURATION, 1);
		el.textContent = Math.round(easeOut(progress) * target) + suffix;
		if (progress < 1) {
			rafId = requestAnimationFrame(tick);
		} else {
			el.textContent = target + suffix;
			mount.cancelAnimation = null;
		}
	}

	mount.cancelAnimation = () => cancelAnimationFrame(rafId);
	rafId = requestAnimationFrame(tick);
}

export function init(root) {
	if (mounts.has(root)) return;

	const target = parseFloat(root.dataset.cStatTarget);
	const suffix = root.dataset.cStatSuffix ?? '';

	if (isNaN(target)) return;

	const mount = { active: true, observer: null, cancelAnimation: null };
	mounts.set(root, mount);

	if (!('IntersectionObserver' in window)) {
		root.textContent = target + suffix;
		return;
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				observer.disconnect();
				mount.observer = null;
				animate(root, target, suffix, mount);
			}
		},
		{ threshold: 0.3 },
	);

	mount.observer = observer;
	observer.observe(root);
}

export function destroy(root) {
	const mount = mounts.get(root);
	if (!mount) return;
	mount.active = false;
	mount.observer?.disconnect();
	mount.cancelAnimation?.();
	mounts.delete(root);
}
