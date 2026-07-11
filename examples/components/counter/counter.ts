import { formatValue } from "./format.ts";

export default island(({ refs, data }) => {
	let value = data.root.start;

	const render = () => {
		refs.value.textContent = formatValue(data.root.prefix, value);
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
