// CSS modules: a bound stylesheet ({% import styles from "./x.css" %} or
// {% stylesheet styles %}) exposes its class names as a map, and markup
// reads {{ styles.wrapper }}. Scoping IS the class rewrite — every class in
// a bound sheet becomes nz-<component>__<class>, and the markup reference
// lowers to the same literal at compile time. No runtime, no descendant
// selectors, and an unbound {% stylesheet %} passes through untouched
// (vanilla Shopify behavior); binding is the opt-in.

/** "counter" + "wrapper" -> "nz-counter__wrapper" (readable by design). */
export function scopedClassName(component: string, className: string): string {
	return `nz-${component}__${className}`;
}

export type CssClassToken = {
	name: string;
	/** Offset of the name (after the dot) in the source. */
	start: number;
	end: number;
};

/**
 * Class tokens in selector position. Selectors are the text between a
 * block boundary ({, }, or ;) and the next {, so declarations (url(a.png),
 * 0.5rem) and at-rule bodies never match; media queries and nesting keep
 * yielding preludes naturally.
 */
export function cssClassTokens(source: string): CssClassToken[] {
	const blanked = blankCommentsAndStrings(source);
	const tokens: CssClassToken[] = [];
	let preludeStart = 0;

	const collect = (end: number): void => {
		const prelude = blanked.slice(preludeStart, end);
		for (const match of prelude.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
			const start = preludeStart + match.index + 1;
			tokens.push({
				name: match[1],
				start,
				end: start + match[1].length,
			});
		}
	};

	for (let index = 0; index < blanked.length; index += 1) {
		const char = blanked[index];
		if (char === "{") {
			collect(index);
			preludeStart = index + 1;
		} else if (char === "}" || char === ";") {
			preludeStart = index + 1;
		}
	}

	return tokens;
}

/** Rewrites every selector-position class name through `rename`. */
export function rewriteCssClasses(
	source: string,
	rename: (className: string) => string,
): string {
	let output = source;
	for (const token of cssClassTokens(source).reverse()) {
		output =
			output.slice(0, token.start) +
			rename(token.name) +
			output.slice(token.end);
	}
	return output;
}

export type StyleReference = {
	binding: string;
	className: string;
};

/**
 * Parses an expression as a style-map read: `styles.wrapper` or
 * `styles["hero-image"]` (bracket form for names that are not identifiers).
 * Returns undefined when the head is not one of the given binding names.
 */
export function parseStyleReference(
	expression: string,
	bindingNames: ReadonlySet<string>,
): StyleReference | undefined {
	const trimmed = expression.trim();
	const dotForm = trimmed.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
	if (dotForm && bindingNames.has(dotForm[1])) {
		return { binding: dotForm[1], className: dotForm[2] };
	}
	const bracketForm = trimmed.match(
		/^([A-Za-z_$][\w$]*)\[\s*["']([^"']+)["']\s*\]$/,
	);
	if (bracketForm && bindingNames.has(bracketForm[1])) {
		return { binding: bracketForm[1], className: bracketForm[2] };
	}
	return undefined;
}

/** Comments and quoted strings blanked to spaces, newlines kept — offsets stay valid. */
function blankCommentsAndStrings(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "))
		.replace(/"[^"\n]*"|'[^'\n]*'/g, (match) => " ".repeat(match.length));
}
