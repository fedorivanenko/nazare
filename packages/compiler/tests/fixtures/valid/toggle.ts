export default island(({ refs }) => {
	refs.button?.addEventListener("click", () => {
		refs.panel?.toggleAttribute("hidden");
	});
});
