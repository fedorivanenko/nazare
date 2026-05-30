const mounts = new WeakMap();

function closeAll(root) {
	root.querySelectorAll("[data-menu-panel]").forEach((p) => {
		p.classList.add("hidden");
		p.setAttribute("aria-hidden", "true");
	});
	root.querySelectorAll("[data-menu-trigger]").forEach((t) => {
		t.removeAttribute("data-active");
		t.setAttribute("aria-expanded", "false");
	});
}

function openPanel(root, slot) {
	closeAll(root);
	const panel = root.querySelector(`[data-menu-panel="${slot}"]`);
	const trigger = root.querySelector(`[data-menu-trigger="${slot}"]`);
	if (!panel || !trigger) return;
	panel.classList.remove("hidden");
	panel.setAttribute("aria-hidden", "false");
	trigger.setAttribute("data-active", "");
	trigger.setAttribute("aria-expanded", "true");
}

function switchTab(root, tabId) {
	const slot = tabId.split("-")[0];
	root
		.querySelectorAll(`[data-tab-trigger^="${slot}-"]`)
		.forEach((b) => b.removeAttribute("data-active"));
	root
		.querySelectorAll(`[data-tab-panel^="${slot}-"]`)
		.forEach((p) => p.classList.add("hidden"));
	root.querySelector(`[data-tab-trigger="${tabId}"]`)?.setAttribute("data-active", "");
	root.querySelector(`[data-tab-panel="${tabId}"]`)?.classList.remove("hidden");
}

export function init(root) {
	if (mounts.has(root)) return;

	let timer = null;
	const listeners = [];

	function on(target, event, fn) {
		target.addEventListener(event, fn);
		listeners.push([target, event, fn]);
	}

	root.querySelectorAll("[data-menu-trigger]").forEach((btn) => {
		const slot = btn.dataset.menuTrigger;
		on(btn, "mouseenter", () => {
			clearTimeout(timer);
			timer = setTimeout(() => openPanel(root, slot), 100);
		});
		on(btn, "click", () => {
			const panel = root.querySelector(`[data-menu-panel="${slot}"]`);
			panel?.classList.contains("hidden") ? openPanel(root, slot) : closeAll(root);
		});
	});

	on(root, "mouseleave", () => {
		clearTimeout(timer);
		timer = setTimeout(() => closeAll(root), 150);
	});

	on(root, "mouseenter", () => clearTimeout(timer));

	root.querySelectorAll("[data-tab-trigger]").forEach((btn) => {
		on(btn, "click", () => switchTab(root, btn.dataset.tabTrigger));
	});

	const onKey = (e) => {
		if (e.key === "Escape") closeAll(root);
	};
	const onDoc = (e) => {
		if (!root.contains(e.target)) closeAll(root);
	};

	document.addEventListener("keydown", onKey);
	document.addEventListener("click", onDoc);

	mounts.set(root, { timer, listeners, onKey, onDoc });
}

export function destroy(root) {
	const inst = mounts.get(root);
	if (!inst) return;
	clearTimeout(inst.timer);
	for (const [target, event, fn] of inst.listeners) {
		target.removeEventListener(event, fn);
	}
	document.removeEventListener("keydown", inst.onKey);
	document.removeEventListener("click", inst.onDoc);
	mounts.delete(root);
}
