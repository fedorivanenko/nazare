const mounts = new WeakMap();

export function init(root) {
	if (mounts.has(root)) return;

	const video = root.querySelector("video");
	if (!video) return;

	const poster = root.querySelector("[data-c-bg-video-poster]");
	const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

	function applyMotion() {
		if (mq.matches) {
			video.pause();
			if (poster) poster.hidden = false;
		} else {
			if (poster) poster.hidden = true;
			video.play().catch(() => {});
		}
	}

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) {
					if (!mq.matches) video.play().catch(() => {});
				} else {
					video.pause();
				}
			}
		},
		{ threshold: 0.1 },
	);

	const mqListener = () => applyMotion();
	mq.addEventListener("change", mqListener);
	observer.observe(root);
	applyMotion();

	mounts.set(root, { video, poster, observer, mq, mqListener });
}

export function destroy(root) {
	const instance = mounts.get(root);
	if (!instance) return;

	instance.observer.disconnect();
	instance.mq.removeEventListener("change", instance.mqListener);
	mounts.delete(root);
}
