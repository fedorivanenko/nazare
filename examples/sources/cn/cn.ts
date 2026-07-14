export type ClassDictionary = Record<string, boolean | null | undefined>;
export type ClassArray = ClassValue[];
export type ClassValue =
	| string
	| false
	| null
	| undefined
	| ClassDictionary
	| ClassArray;

export function cn(...values: ClassValue[]): string {
	const classes: string[] = [];

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
