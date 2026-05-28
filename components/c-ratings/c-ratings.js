const mounts = new WeakMap();

function getStore() {
	if (!window.NazareRatings) {
		const byHandle = new Map();

		window.NazareRatings = {
			register(handle, instance) {
				if (!byHandle.has(handle)) byHandle.set(handle, new Set());
				byHandle.get(handle).add(instance);
			},
			unregister(root) {
				for (const [handle, set] of byHandle) {
					for (const inst of set) {
						if (inst.root !== root) continue;
						set.delete(inst);
						if (!set.size) byHandle.delete(handle);
						return;
					}
				}
			},
			update(handle, score, count) {
				const set = byHandle.get(handle);
				if (!set) return;
				for (const inst of set) render(inst, score, count);
			},
			pendingHandles() {
				const pending = new Set();
				for (const [handle, set] of byHandle) {
					for (const inst of set) {
						if (inst.score == null) { pending.add(handle); break; }
					}
				}
				return pending;
			},
		};
	}
	return window.NazareRatings;
}

function buildStars(score) {
	let html = '<span class="flex gap-0.5" aria-hidden="true">';
	for (let i = 1; i <= 5; i++) {
		const fill = Math.min(1, Math.max(0, score - (i - 1)));
		if (fill >= 1) {
			html += '<span class="text-foreground">★</span>';
		} else if (fill >= 0.5) {
			html +=
				'<span class="relative inline-block text-foreground/20">' +
				'★<span class="absolute inset-0 overflow-hidden w-1/2 text-foreground">★</span>' +
				'</span>';
		} else {
			html += '<span class="text-foreground/20">★</span>';
		}
	}
	return html + '</span>';
}

function buildPlaceholder() {
	return (
		'<span class="flex gap-0.5" aria-hidden="true">' +
		'<span class="text-foreground/10">★</span>'.repeat(5) +
		'</span>'
	);
}

function render(instance, score, count) {
	instance.score = score;
	instance.count = count;

	const clamped = Math.min(5, Math.max(0, score));
	const label =
		count > 0
			? `${clamped} out of 5, ${count} reviews`
			: `${clamped} out of 5`;
	const countHtml =
		count > 0
			? `<span class="ml-1 text-sm text-foreground/60">(${count})</span>`
			: '';

	instance.root.setAttribute('aria-label', label);
	instance.root.innerHTML = buildStars(clamped) + countHtml;
}

export function init(root) {
	if (mounts.has(root)) return;

	const handle = root.dataset.cRatingsProduct;
	if (!handle) return;

	const scoreRaw = root.dataset.cRatingsScore;
	const countRaw = root.dataset.cRatingsCount;
	const score = scoreRaw != null ? parseFloat(scoreRaw) : null;
	const count = countRaw != null ? parseInt(countRaw, 10) : null;

	const instance = { root, handle, score: null, count: null };
	mounts.set(root, instance);
	getStore().register(handle, instance);

	if (score != null) {
		render(instance, score, count ?? 0);
	} else {
		root.setAttribute('aria-label', 'Product ratings');
		root.innerHTML = buildPlaceholder();
	}
}

export function destroy(root) {
	if (!mounts.has(root)) return;
	getStore().unregister(root);
	mounts.delete(root);
}
