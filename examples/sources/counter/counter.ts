import { cn } from "../cn/cn.ts";
import { formatValue } from "./format.ts";

export default island(({ root, refs, data }) => {
	let value = data.root.start;

	const render = () => {
		refs.value.textContent = formatValue(data.root.prefix, value);
		root.className = cn("nazare-counter", {
			"nazare-counter--positive": value > 0,
		});
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
