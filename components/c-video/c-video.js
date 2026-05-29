const mounts = new WeakMap();

function videoStore() {
	if (!window.NazareVideoStore) {
		window.NazareVideoStore = {
			instances: new Set(),
			register(instance) {
				this.instances.add(instance);
			},
			unregister(instance) {
				this.instances.delete(instance);
			},
			muteOthers(activeInstance) {
				for (const instance of [...this.instances]) {
					if (!instance.root?.isConnected) {
						this.instances.delete(instance);
						continue;
					}
					if (instance !== activeInstance) {
						instance.mute();
					}
				}
			},
		};
	}

	return window.NazareVideoStore;
}

function setText(node, value) {
	if (node) node.textContent = value;
}

function setButtonState(button, label) {
	if (!button) return;
	button.setAttribute("aria-label", label);
}

function toggleIcon(show, hide) {
	if (show) show.classList.remove("hidden");
	if (hide) hide.classList.add("hidden");
}

function update(instance) {
	const { video, thumbnail, playButton, playIcon, pauseIcon, muteButton, unmutedIcon, mutedIcon } =
		instance;
	const isPaused = video.paused;
	const isMuted = video.muted || video.volume === 0;

	toggleIcon(isPaused ? playIcon : pauseIcon, isPaused ? pauseIcon : playIcon);
	setButtonState(playButton, isPaused ? "Play video" : "Pause video");
	toggleIcon(isMuted ? mutedIcon : unmutedIcon, isMuted ? unmutedIcon : mutedIcon);
	setButtonState(muteButton, isMuted ? "Unmute video" : "Mute video");

	if (thumbnail) {
		thumbnail.hidden = !isPaused || video.currentTime > 0.25;
	}
}

function play(instance) {
	const result = instance.video.play();
	if (result?.catch) result.catch(() => update(instance));
}

function togglePlay(instance) {
	if (instance.video.paused) {
		play(instance);
		return;
	}

	instance.video.pause();
}

function toggleMute(instance) {
	instance.video.muted = !instance.video.muted;
	if (!instance.video.muted) {
		videoStore().muteOthers(instance);
	}
	update(instance);
}

function onVolumeChange(instance) {
	if (!instance.video.muted && instance.video.volume > 0) {
		videoStore().muteOthers(instance);
	}
	update(instance);
}

export function init(root) {
	if (mounts.has(root)) return;

	const video = root.querySelector("video");
	if (!video) return;

	const instance = {
		root,
		video,
		thumbnail: root.querySelector("[data-c-video-thumbnail]"),
		playButton: root.querySelector("[data-c-video-play]"),
		playIcon: root.querySelector("[data-c-video-play-icon]"),
		pauseIcon: root.querySelector("[data-c-video-pause-icon]"),
		muteButton: root.querySelector("[data-c-video-mute]"),
		unmutedIcon: root.querySelector("[data-c-video-unmuted-icon]"),
		mutedIcon: root.querySelector("[data-c-video-muted-icon]"),
		listeners: [],
		mute() {
			this.video.muted = true;
			update(this);
		},
	};

	function listen(node, eventName, handler) {
		if (!node) return;
		node.addEventListener(eventName, handler);
		instance.listeners.push([node, eventName, handler]);
	}

	listen(instance.playButton, "click", () => togglePlay(instance));
	listen(instance.thumbnail, "click", () => play(instance));
	listen(instance.muteButton, "click", () => toggleMute(instance));
	listen(video, "play", () => update(instance));
	listen(video, "pause", () => update(instance));
	listen(video, "ended", () => update(instance));
	listen(video, "volumechange", () => onVolumeChange(instance));

	video.muted = true;
	mounts.set(root, instance);
	videoStore().register(instance);
	update(instance);
}

export function destroy(root) {
	const instance = mounts.get(root);
	if (!instance) return;

	for (const [node, eventName, handler] of instance.listeners) {
		node.removeEventListener(eventName, handler);
	}

	videoStore().unregister(instance);
	mounts.delete(root);
}
