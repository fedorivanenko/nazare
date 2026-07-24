// CSS modules: a bound stylesheet ({% import styles from "./x.css" %} or
// {% stylesheet styles %}) exposes selector class names as a map. Scoping is
// done by parsing CSS, renaming class selectors, and lowering matching Liquid
// reads to the same generated names. Unbound stylesheets pass through.
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

/**
 * "counter" + "styles" + "wrapper" -> "nz-counter__styles__wrapper".
 * Binding is part of the generated name so two css modules in one component
 * cannot collide; callers may omit it for legacy component-wide scoping.
 */
export function scopedClassName(
	component: string,
	className: string,
	binding?: string,
): string {
	return binding
		? `nz-${component}__${binding}__${className}`
		: `nz-${component}__${className}`;
}

export type CssClassToken = {
	name: string;
	/** Offset of the name (after the dot) in the source. */
	start: number;
	end: number;
};

/**
 * Class tokens in selector position, parsed with PostCSS + selector parser.
 * Declaration values such as url(.icon.png), strings, and comments are never
 * inspected. Invalid CSS is treated as uninspectable by this helper; CSS parse
 * diagnostics belong in the checker once CSS validation becomes a first-class
 * pass.
 */
export function cssClassTokens(source: string): CssClassToken[] {
	let root: postcss.Root;
	try {
		root = postcss.parse(source);
	} catch {
		return [];
	}

	const lineStarts = lineStartOffsets(source);
	const tokens: CssClassToken[] = [];

	root.walkRules((rule) => {
		const selectorStart = rule.source?.start
			? offsetFromLineColumn(
					lineStarts,
					rule.source.start.line,
					rule.source.start.column,
				)
			: source.indexOf(rule.selector);
		if (selectorStart < 0) return;

		let selectorAst: selectorParser.Root;
		try {
			selectorAst = selectorParser().astSync(rule.selector);
		} catch {
			return;
		}

		selectorAst.walkClasses((classNode) => {
			const sourceIndex = classNode.sourceIndex;
			if (sourceIndex === undefined) return;
			const start = selectorStart + sourceIndex + 1;
			tokens.push({
				name: classNode.value,
				start,
				end: start + classNode.value.length,
			});
		});
	});

	return tokens;
}

export function cssParseError(source: string): string | undefined {
	let root: postcss.Root;
	try {
		root = postcss.parse(source);
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	let selectorError: string | undefined;
	root.walkRules((rule) => {
		if (selectorError) return;
		try {
			selectorParser().astSync(rule.selector);
		} catch (error) {
			selectorError = error instanceof Error ? error.message : String(error);
		}
	});
	return selectorError;
}

/** Rewrites selector-position class names through `rename`. */
export function rewriteCssClasses(
	source: string,
	rename: (className: string) => string,
): string {
	let root: postcss.Root;
	try {
		root = postcss.parse(source);
	} catch {
		return source;
	}

	root.walkRules((rule) => {
		try {
			rule.selector = selectorParser((selectors) => {
				selectors.walkClasses((classNode) => {
					classNode.value = rename(classNode.value);
				});
			}).processSync(rule.selector);
		} catch {
			// Leave malformed selectors untouched; full CSS parse diagnostics live
			// outside this lowering helper.
		}
	});

	return root.toString();
}

function lineStartOffsets(source: string): number[] {
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === "\n") starts.push(index + 1);
	}
	return starts;
}

function offsetFromLineColumn(
	lineStarts: readonly number[],
	line: number,
	column: number,
): number {
	return (lineStarts[line - 1] ?? 0) + column - 1;
}
