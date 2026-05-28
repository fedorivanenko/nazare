const mounts = new WeakMap();

// Judge.me public widget API — no auth token required for shops with the app installed.
// Endpoint and response shape: https://judge.me/api/v1/widgets/product_review
// Verify field names (rating, number_of_reviews) against the live API before deploy.
async function fetchBatch(domain, handles) {
	const results = await Promise.allSettled(
		[...handles].map(async (handle) => {
			const url =
				`https://judge.me/api/v1/widgets/product_review` +
				`?shop_domain=${encodeURIComponent(domain)}&handle=${encodeURIComponent(handle)}`;
			const res = await fetch(url);
			if (!res.ok) return null;
			const data = await res.json();
			const score = data?.rating;
			const count = data?.number_of_reviews;
			if (score == null) return null;
			return { handle, score, count: count ?? 0 };
		}),
	);

	return results
		.filter((r) => r.status === "fulfilled" && r.value != null)
		.map((r) => r.value);
}

export async function init(root) {
	if (mounts.has(root)) return;
	mounts.set(root, true);

	const domain = window.Shopify?.shop;
	if (!domain) {
		console.warn("[c-ratings-judgeme] window.Shopify.shop unavailable");
		return;
	}

	if (!window.NazareRatings) {
		console.warn("[c-ratings-judgeme] NazareRatings store not found — ensure c-ratings is loaded first");
		return;
	}

	const pending = window.NazareRatings.pendingHandles();
	if (!pending.size) return;

	const results = await fetchBatch(domain, pending);
	for (const { handle, score, count } of results) {
		window.NazareRatings.update(handle, score, count);
	}
}

export function destroy(root) {
	mounts.delete(root);
}
