export function cn(...values) {
	const classes = [];

	for (const value of values) {
		if (!value) continue;

		if (typeof value === "string") {
			classes.push(value);
			continue;
		}

		if (Array.isArray(value)) {
			const nested = cn(...value);
			if (nested) classes.push(nested);
			continue;
		}

		for (const [className, enabled] of Object.entries(value)) {
			if (enabled) classes.push(className);
		}
	}

	return classes.join(" ");
}
