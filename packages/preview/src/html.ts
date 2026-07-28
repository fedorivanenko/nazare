// Escaping, shared by every frontend that writes HTML: the gallery shell, the
// isolated story document, and anything layered on later. Rendered component
// output is inserted as markup on purpose — it *is* markup — so only the text
// the preview itself writes (names, props, paths, code) passes through here.
export const escapeHtml = (value: string): string =>
	value.replace(
		/[&<>"]/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character] ??
			character,
	);

/** JSON safe to embed in a `<script>` element: `</script>` must not close it. */
export const escapeJson = (value: unknown): string =>
	JSON.stringify(value).replace(/</g, "\\u003c");
