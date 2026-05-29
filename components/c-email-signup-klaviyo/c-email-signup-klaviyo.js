const mounts = new WeakMap();

const KLAVIYO_ENDPOINT = 'https://a.klaviyo.com/client/subscriptions/?company_id=';

function getCompanyId(root) {
	return root.dataset.companyId || window.klaviyoCompanyId ?? window._learnq?.[0]?.[1] ?? null;
}

export async function init(root) {
	if (mounts.has(root)) return;

	const form = root.closest('form') ?? root.querySelector('form') ?? root;
	if (!form || form.tagName !== 'FORM') return;

	const listId = root.dataset.listId ?? form.dataset.listId;
	if (!listId) {
		console.warn('[c-email-signup-klaviyo] missing data-list-id');
		return;
	}

	mounts.set(root, true);

	form.addEventListener('submit', async (e) => {
		e.preventDefault();

		const emailInput = form.querySelector('input[type="email"]');
		const email = emailInput?.value?.trim();
		if (!email) return;

		const submitBtn = form.querySelector('button[type="submit"]');
		if (submitBtn) submitBtn.disabled = true;

		try {
			const companyId = getCompanyId(root);
			if (!companyId) throw new Error('Klaviyo company ID not found');

			const res = await fetch(KLAVIYO_ENDPOINT + encodeURIComponent(companyId), {
				method: 'POST',
				headers: { 'content-type': 'application/json', revision: '2023-02-22' },
				body: JSON.stringify({
					data: {
						type: 'subscription',
						attributes: {
							list_id: listId,
							email,
						},
					},
				}),
			});

			if (!res.ok) throw new Error(`HTTP ${res.status}`);

			showSuccess(form);
		} catch (err) {
			console.error('[c-email-signup-klaviyo]', err);
			showError(form);
			if (submitBtn) submitBtn.disabled = false;
		}
	});
}

function showSuccess(form) {
	const msg = document.createElement('p');
	msg.className = 'text-sm font-medium text-foreground';
	msg.textContent = 'Thanks! You\'re subscribed.';
	form.replaceWith(msg);
}

function showError(form) {
	let err = form.querySelector('[data-signup-error]');
	if (!err) {
		err = document.createElement('p');
		err.dataset.signupError = '';
		err.className = 'mt-2 text-xs text-red-600';
		form.after(err);
	}
	err.textContent = 'Something went wrong. Please try again.';
}

export function destroy(root) {
	mounts.delete(root);
}
