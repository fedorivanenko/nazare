const mounts = new WeakMap();

// Yotpo public bottomline API — uses public app key, no secret required.
// GET https://api.yotpo.com/products/{app_key}/{external_product_id}/bottomline
// external_product_id is the Shopify numeric product ID by default.
async function fetchRating(appKey, productId) {
	const url = `https://api.yotpo.com/products/${encodeURIComponent(appKey)}/${encodeURIComponent(productId)}/bottomline`;
	const res = await fetch(url);
	if (!res.ok) return null;
	const data = await res.json();
	const bl = data?.response?.bottomline;
	if (!bl) return null;
	return { score: bl.average_score, count: bl.total_reviews ?? 0 };
}

export async function init(root) {
	if (mounts.has(root)) return;
	mounts.set(root, true);

	const appKey = root.dataset.cRatingsYotpoAppKey;
	if (!appKey) {
		console.warn("[c-ratings-yotpo] app key missing — set shop.metafields.integrations.yotpo_app_key");
		return;
	}

	if (!window.NazareRatings) {
		console.warn("[c-ratings-yotpo] NazareRatings store not found — ensure c-ratings is loaded first");
		return;
	}

	const pending = window.NazareRatings.pendingHandles();
	if (!pending.size) return;

	// Map each pending handle to its Shopify product ID (Yotpo's external_product_id).
	const products = [...pending]
		.map((handle) => {
			const el = document.querySelector(
				`[data-c-ratings-product="${CSS.escape(handle)}"]`,
			);
			const id = el?.dataset.cRatingsProductId;
			return id ? { handle, id } : null;
		})
		.filter(Boolean);

	if (!products.length) return;

	const results = await Promise.allSettled(
		products.map(async ({ handle, id }) => {
			const rating = await fetchRating(appKey, id);
			return rating ? { handle, ...rating } : null;
		}),
	);

	for (const result of results) {
		if (result.status === "fulfilled" && result.value) {
			const { handle, score, count } = result.value;
			window.NazareRatings.update(handle, score, count);
		}
	}
}

export function destroy(root) {
	mounts.delete(root);
}
