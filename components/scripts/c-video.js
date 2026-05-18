const createVideoStore = () => {
	const entries = new Map();
	let activeUnmutedKey = null;

	const getKey = (root) => root.dataset.videoKey || "";

	const syncAll = () => {
		for (const entry of entries.values()) {
			entry.syncMuteState();
		}
	};

	const muteEntry = (entry) => {
		entry.video.muted = true;
	};

	return {
		register(root, entry) {
			entries.set(root, entry);
		},
		unregister(root) {
			const key = getKey(root);
			entries.delete(root);

			if (activeUnmutedKey === key) {
				activeUnmutedKey = null;
				syncAll();
			}
		},
		isLogicallyMuted(root) {
			return activeUnmutedKey !== getKey(root);
		},
		muteKey(key) {
			for (const entry of entries.values()) {
				if (entry.key === key) {
					muteEntry(entry);
				}
			}

			if (activeUnmutedKey === key) {
				activeUnmutedKey = null;
			}

			syncAll();
		},
		unmute(root) {
			const activeEntry = entries.get(root);

			if (!activeEntry) {
				return;
			}

			activeUnmutedKey = activeEntry.key;

			for (const [entryRoot, entry] of entries) {
				if (entryRoot === root) {
					continue;
				}

				muteEntry(entry);
			}

			activeEntry.video.muted = false;
			syncAll();
		},
		muteOthers(activeRoot) {
			this.unmute(activeRoot);
		},
	};
};

const getVideoStore = () => {
	window.NazareVideoStore = window.NazareVideoStore || createVideoStore();
	return window.NazareVideoStore;
};

const initializedRoots = new WeakSet();
let videosObserver = null;

const initVideo = (root) => {
	if (initializedRoots.has(root)) {
		return;
	}

	const video = root.querySelector("video");
	const playToggle = root.querySelector("[data-video-play-toggle]");
	const muteToggle = root.querySelector("[data-video-mute-toggle]");
	const playIcon = root.querySelector("[data-video-play-icon]");
	const pauseIcon = root.querySelector("[data-video-pause-icon]");
	const muteIcon = root.querySelector("[data-video-mute-icon]");
	const unmuteIcon = root.querySelector("[data-video-unmute-icon]");
	const playLabel = root.querySelector("[data-video-play-label]");
	const muteLabel = root.querySelector("[data-video-mute-label]");
	const store = getVideoStore();

	if (!video) {
		return;
	}

	initializedRoots.add(root);

	const syncPlayState = () => {
		if (!playToggle) {
			return;
		}

		const isPlaying = !video.paused && !video.ended;
		playToggle.setAttribute(
			"aria-label",
			isPlaying ? "Pause video" : "Play video",
		);
		playToggle.setAttribute("aria-pressed", String(isPlaying));
		playIcon?.classList.toggle("hidden", isPlaying);
		pauseIcon?.classList.toggle("hidden", !isPlaying);

		if (playLabel) {
			playLabel.textContent = isPlaying ? "Pause video" : "Play video";
		}
	};

	const syncMuteState = () => {
		if (!muteToggle) {
			return;
		}

		const isMuted = store.isLogicallyMuted(root);
		muteToggle.setAttribute(
			"aria-label",
			isMuted ? "Unmute video" : "Mute video",
		);
		muteToggle.setAttribute("aria-pressed", String(!isMuted));
		muteIcon?.classList.toggle("hidden", isMuted);
		unmuteIcon?.classList.toggle("hidden", !isMuted);

		if (muteLabel) {
			muteLabel.textContent = isMuted ? "Unmute video" : "Mute video";
		}
	};

	store.register(root, {
		key: root.dataset.videoKey || "",
		video,
		syncMuteState,
	});

	playToggle?.addEventListener("click", () => {
		if (video.paused || video.ended) {
			video.play().catch(() => {});
			return;
		}

		video.pause();
	});

	muteToggle?.addEventListener("click", () => {
		if (store.isLogicallyMuted(root)) {
			store.unmute(root);
			return;
		}

		store.muteKey(root.dataset.videoKey || "");
	});

	video.addEventListener("play", syncPlayState);
	video.addEventListener("pause", syncPlayState);
	video.addEventListener("ended", syncPlayState);
	video.addEventListener("volumechange", () => {
		if (!video.muted) {
			store.unmute(root);
			return;
		}

		syncMuteState();
	});

	if (root.dataset.videoAutoplay === "true") {
		video.play().catch(() => {});
	}

	syncPlayState();
	syncMuteState();
};

const forEachVideoRoot = (node, callback) => {
	if (!(node instanceof HTMLElement)) {
		return;
	}

	if (node.matches("[data-video]")) {
		callback(node);
	}

	node.querySelectorAll("[data-video]").forEach(callback);
};

export const initCVideos = () => {
	document.querySelectorAll("[data-video]").forEach(initVideo);

	if (videosObserver) {
		return;
	}

	videosObserver = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			for (const node of mutation.addedNodes) {
				forEachVideoRoot(node, initVideo);
			}

			for (const node of mutation.removedNodes) {
				forEachVideoRoot(node, (root) => getVideoStore().unregister(root));
			}
		}
	});

	videosObserver.observe(document.documentElement, {
		childList: true,
		subtree: true,
	});
};
