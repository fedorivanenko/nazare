import type { PropTypeInfo, SemanticType } from "@nazare/core";
import { shopifyObjectTypeNames } from "@nazare/core";

// Parses the props type-expression DSL, e.g.:
//   string.setting({ label: "Text", default: "Free shipping" })
//   url.required()
//   array(ShopifyProduct)
//   object("ShopifyImage").optional()
//
// Grammar:
//   expression   := base call*
//   base         := identifier [ "(" base-argument ")" ]
//   base-argument:= identifier | string
//   call         := "." identifier "(" [ argument ] ")"
//   argument     := literal | object
//   object       := "{" [ entry ("," entry)* [","] ] "}"
//   entry        := identifier ":" (literal | object)
//   literal      := string | number | true | false

export type TypeExpressionLiteral = string | number | boolean;

export type TypeExpressionObject = {
	[key: string]: TypeExpressionLiteral | TypeExpressionObject;
};

export type TypeExpressionCall = {
	name: string;
	argument?: TypeExpressionLiteral | TypeExpressionObject;
};

export type TypeExpressionAst = {
	base: { name: string; argument?: string };
	calls: TypeExpressionCall[];
};

export type ParsedTypeExpression = {
	ast?: TypeExpressionAst;
	typeInfo: PropTypeInfo;
	required: boolean;
	hasDefault: boolean;
	/** Set when the expression could not be fully parsed. */
	error?: string;
};

export function parseTypeExpression(source: string): ParsedTypeExpression {
	let ast: TypeExpressionAst;
	try {
		ast = new Parser(source).parse();
	} catch (error) {
		return {
			typeInfo: { valueType: { kind: "unknown" } },
			required: false,
			hasDefault: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}

	const settingCall = ast.calls.find((call) => call.name === "setting");
	const settingObject = isObject(settingCall?.argument)
		? settingCall.argument
		: undefined;

	return {
		ast,
		typeInfo: {
			valueType: valueTypeFromBase(ast.base),
			setting: settingCall
				? {
						label: stringValue(settingObject?.label),
						default: settingObject?.default,
					}
				: undefined,
		},
		required: ast.calls.some((call) => call.name === "required"),
		hasDefault:
			ast.calls.some((call) => call.name === "default") ||
			ast.calls.some(
				(call) => isObject(call.argument) && "default" in call.argument,
			),
	};
}

function valueTypeFromBase(base: TypeExpressionAst["base"]): SemanticType {
	if (base.name === "array") {
		return {
			kind: "array",
			element: base.argument
				? namedValueType(base.argument)
				: { kind: "unknown" },
		};
	}
	if (base.name === "object") {
		return base.argument
			? { kind: "object", name: base.argument }
			: { kind: "object" };
	}
	return namedValueType(base.name);
}

function namedValueType(name: string): SemanticType {
	if (name === "string") return { kind: "string" };
	if (name === "url") return { kind: "url" };
	if (name === "boolean") return { kind: "boolean" };
	if (name === "number") return { kind: "number" };
	if (name === "Money") return { kind: "money" };
	if ((shopifyObjectTypeNames as readonly string[]).includes(name)) {
		return { kind: "object", name };
	}
	if (/^[A-Z]/.test(name)) return { kind: "object", name };
	return { kind: "unknown" };
}

function isObject(
	value: TypeExpressionLiteral | TypeExpressionObject | undefined,
): value is TypeExpressionObject {
	return typeof value === "object" && value !== null;
}

function stringValue(
	value: TypeExpressionLiteral | TypeExpressionObject | undefined,
): string | undefined {
	return typeof value === "string" ? value : undefined;
}

class Parser {
	private position = 0;

	constructor(private readonly source: string) {}

	parse(): TypeExpressionAst {
		const base = this.parseBase();
		const calls: TypeExpressionCall[] = [];
		this.skipWhitespace();
		while (this.peek() === ".") {
			this.position += 1;
			calls.push(this.parseCall());
			this.skipWhitespace();
		}
		if (this.position < this.source.length) {
			this.fail(`unexpected input after type expression: "${this.rest()}"`);
		}
		return { base, calls };
	}

	private parseBase(): TypeExpressionAst["base"] {
		const name = this.parseIdentifier();
		this.skipWhitespace();
		if (this.peek() !== "(") return { name };

		this.position += 1;
		this.skipWhitespace();
		const argument =
			this.peek() === '"' || this.peek() === "'"
				? this.parseString()
				: this.parseIdentifier();
		this.skipWhitespace();
		this.expect(")");
		return { name, argument };
	}

	private parseCall(): TypeExpressionCall {
		const name = this.parseIdentifier();
		this.skipWhitespace();
		this.expect("(");
		this.skipWhitespace();
		if (this.peek() === ")") {
			this.position += 1;
			return { name };
		}
		const argument = this.parseValue();
		this.skipWhitespace();
		this.expect(")");
		return { name, argument };
	}

	private parseValue(): TypeExpressionLiteral | TypeExpressionObject {
		this.skipWhitespace();
		const char = this.peek();
		if (char === "{") return this.parseObject();
		if (char === '"' || char === "'") return this.parseString();
		if (char !== undefined && /[\d-]/.test(char)) return this.parseNumber();
		const word = this.parseIdentifier();
		if (word === "true") return true;
		if (word === "false") return false;
		this.fail(`unexpected value "${word}"`);
	}

	private parseObject(): TypeExpressionObject {
		this.expect("{");
		const object: TypeExpressionObject = {};
		this.skipWhitespace();
		while (this.peek() !== "}") {
			const key = this.parseIdentifier();
			this.skipWhitespace();
			this.expect(":");
			object[key] = this.parseValue();
			this.skipWhitespace();
			if (this.peek() === ",") {
				this.position += 1;
				this.skipWhitespace();
				continue;
			}
			break;
		}
		this.skipWhitespace();
		this.expect("}");
		return object;
	}

	private parseString(): string {
		const quote = this.peek();
		if (quote !== '"' && quote !== "'") this.fail("expected string");
		this.position += 1;
		let value = "";
		while (this.position < this.source.length) {
			const char = this.source[this.position];
			if (char === "\\") {
				value += this.source[this.position + 1] ?? "";
				this.position += 2;
				continue;
			}
			if (char === quote) {
				this.position += 1;
				return value;
			}
			value += char;
			this.position += 1;
		}
		this.fail("unterminated string");
	}

	private parseNumber(): number {
		const match = this.rest().match(/^-?\d+(\.\d+)?/);
		if (!match) this.fail("expected number");
		this.position += match[0].length;
		return Number(match[0]);
	}

	private parseIdentifier(): string {
		this.skipWhitespace();
		const match = this.rest().match(/^[A-Za-z_$][\w$]*/);
		if (!match) this.fail(`expected identifier at "${this.rest()}"`);
		this.position += match[0].length;
		return match[0];
	}

	private expect(char: string): void {
		if (this.peek() !== char) {
			this.fail(`expected "${char}" at "${this.rest()}"`);
		}
		this.position += 1;
	}

	private peek(): string | undefined {
		return this.source[this.position];
	}

	private rest(): string {
		return this.source.slice(this.position, this.position + 24);
	}

	private skipWhitespace(): void {
		while (/\s/.test(this.peek() ?? "")) this.position += 1;
	}

	private fail(reason: string): never {
		throw new Error(`Invalid type expression: ${reason}`);
	}
}
