export default island(({ refs, data }) => {
	let value = data.root.start;

	const render = () => {
		refs.value.textContent = data.root.prefix + String(value);
	};

	refs.increment.addEventListener("click", () => {
		value += data.increment.step;
		render();
	});
	refs.decrement.addEventListener("click", () => {
		value -= data.decrement.step;
		render();
	});

	render();
});
