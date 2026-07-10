// Scopes component CSS under its data-nz-component attribute. Each selector
// is emitted twice — "scope sel" for descendants and "scope+sel" compounded
// for the case where the selector matches the root element itself. At-rules
// that contain rules (@media, @supports, @container, @layer) recurse; other
// at-rules (@keyframes, @font-face, @import) pass through untouched. This is
// a lightweight rule-walker, not a full CSS parser — enough for static
// component stylesheets, which {% stylesheet %} guarantees (no Liquid).

export function scopeCss(css: string, scope: string): string {
	return scopeRules(css, scope).trim();
}

const nestedAtRules = new Set(["media", "supports", "container", "layer"]);

function scopeRules(css: string, scope: string): string {
	let output = "";
	let position = 0;

	while (position < css.length) {
		const braceStart = css.indexOf("{", position);
		if (braceStart === -1) {
			output += css.slice(position);
			break;
		}

		const prelude = css.slice(position, braceStart);
		const bodyEnd = matchingBrace(css, braceStart);
		const body = css.slice(braceStart + 1, bodyEnd);
		const atRuleName = prelude.trim().match(/^@([A-Za-z-]+)/)?.[1];

		if (atRuleName && nestedAtRules.has(atRuleName)) {
			output += `${prelude}{${scopeRules(body, scope)}}`;
		} else if (atRuleName || prelude.trim().startsWith("@")) {
			output += `${prelude}{${body}}`;
		} else {
			output += `${scopeSelectorList(prelude, scope)}{${body}}`;
		}

		position = bodyEnd + 1;
	}

	return output;
}

function scopeSelectorList(prelude: string, scope: string): string {
	const leading = prelude.match(/^\s*/)?.[0] ?? "";
	const trailing = prelude.match(/\s*$/)?.[0] ?? "";
	const selectors = prelude
		.trim()
		.split(",")
		.map((selector) => selector.trim())
		.filter((selector) => selector.length > 0)
		.flatMap((selector) => scopeSelector(selector, scope));

	return leading + selectors.join(", ") + trailing;
}

function scopeSelector(selector: string, scope: string): string[] {
	if (selector === ":root" || selector.startsWith(":root ")) {
		return [selector.replace(":root", scope)];
	}
	// "scope sel" for descendants, plus scope:is(sel) for the case where the
	// selector matches the root element itself; :is() keeps the compound
	// valid whatever shape the selector has (type selectors can't follow an
	// attribute selector in a plain compound).
	return [`${scope} ${selector}`, `${scope}:is(${selector})`];
}

function matchingBrace(css: string, openIndex: number): number {
	let depth = 0;
	for (let index = openIndex; index < css.length; index += 1) {
		if (css[index] === "{") depth += 1;
		if (css[index] === "}") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	return css.length;
}
