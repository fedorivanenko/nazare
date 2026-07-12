import type {
	NumberConstraints,
	PropTypeInfo,
	SemanticType,
} from "@nazare/core";
import { shopifyObjectTypeNames } from "@nazare/core";

// Parses the props type-expression DSL, e.g.:
//   string.setting({ label: "Text", default: "Free shipping" })
//   url.required()
//   url.or(string).optional()
//   string.enum("left", "center", "right")
//   array(ShopifyProduct)
//   object("ShopifyImage").optional()
//
// Grammar:
//   expression   := base call*
//   base         := identifier [ "(" base-argument ")" ]
//   base-argument:= identifier | string
//   call         := "." identifier "(" [ argument ("," argument)* ] ")"
//   argument     := literal | object | identifier   (identifier = type ref)
//   object       := "{" [ entry ("," entry)* [","] ] "}"
//   entry        := identifier ":" (literal | object)
//   literal      := string | number | true | false
//
// Builder semantics:
//   .required()      prop must be supplied at every render site
//   .optional()      value may be nil; type becomes T | nil
//   .or(type)        union with another type
//   .enum(lit, ...)  replaces the base type with a union of literals
//   .default(value)  prop has a default
//   .setting({...})  prop is projected to a theme-editor setting
//   .min(n) .max(n) .step(n) .unit("px")
//                    value constraints on a number base (range settings)
//   .returns(type)   return type on a function base

export type TypeExpressionLiteral = string | number | boolean;

export type TypeExpressionObject = {
	[key: string]: TypeExpressionLiteral | TypeExpressionObject;
};

export type TypeExpressionTypeRef = { typeRef: string };

export type TypeExpressionArgument =
	| TypeExpressionLiteral
	| TypeExpressionObject
	| TypeExpressionTypeRef;

export type TypeExpressionCall = {
	name: string;
	arguments: TypeExpressionArgument[];
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

	const unknownCalls = ast.calls
		.map((call) => call.name)
		.filter((name) => !knownCallNames.has(name));
	const error = unknownCalls.length
		? `unknown call${unknownCalls.length === 1 ? "" : "s"}: ${unknownCalls.join(", ")}`
		: undefined;

	const settingCall = ast.calls.find((call) => call.name === "setting");
	const settingArgument = settingCall?.arguments[0];
	// isObject excludes type refs at runtime; the cast is needed because a
	// { typeRef } object is structurally assignable to the index signature.
	const settingObject = isObject(settingArgument)
		? (settingArgument as TypeExpressionObject)
		: undefined;
	const defaultCall = ast.calls.find((call) => call.name === "default");
	const defaultCallValue =
		defaultCall && isLiteral(defaultCall.arguments[0])
			? defaultCall.arguments[0]
			: undefined;

	return {
		ast,
		typeInfo: {
			valueType: valueTypeFromAst(ast),
			setting: settingCall
				? {
						label: stringValue(settingObject?.label),
						default: settingObject?.default ?? defaultCallValue,
					}
				: undefined,
		},
		required: ast.calls.some((call) => call.name === "required"),
		hasDefault:
			ast.calls.some((call) => call.name === "default") ||
			ast.calls.some((call) =>
				call.arguments.some(
					(argument) => isObject(argument) && "default" in argument,
				),
			),
		error,
	};
}

const numberConstraintCalls = ["min", "max", "step", "unit"] as const;
const knownCallNames = new Set([
	"default",
	"enum",
	"max",
	"min",
	"optional",
	"or",
	"required",
	"returns",
	"setting",
	"step",
	"unit",
]);

function valueTypeFromAst(ast: TypeExpressionAst): SemanticType {
	let members = [applyBaseCalls(valueTypeFromBase(ast.base), ast.calls)];

	for (const call of ast.calls) {
		if (call.name === "enum") {
			// enum replaces the base: `string.enum("a", "b")` is "a" | "b".
			members = call.arguments.filter(isLiteral).map(literalValueType);
			continue;
		}
		if (call.name === "or") {
			for (const argument of call.arguments) {
				if (isTypeRef(argument)) members.push(namedValueType(argument.typeRef));
				else if (isLiteral(argument)) members.push(literalValueType(argument));
			}
		}
	}

	if (ast.calls.some((call) => call.name === "optional")) {
		members.push({ kind: "nil" });
	}

	if (members.length === 0) return { kind: "unknown" };
	return members.length === 1 ? members[0] : { kind: "union", members };
}

function applyBaseCalls(
	base: SemanticType,
	calls: TypeExpressionCall[],
): SemanticType {
	if (base.kind === "number") {
		let constraints: NumberConstraints | undefined;
		for (const call of calls) {
			const name = numberConstraintCalls.find((c) => c === call.name);
			const argument = call.arguments[0];
			if (!name || isObject(argument) || isTypeRef(argument)) continue;
			const valid =
				name === "unit"
					? typeof argument === "string"
					: typeof argument === "number";
			if (!valid) continue;
			constraints = { ...constraints, [name]: argument };
		}
		return constraints ? { kind: "number", constraints } : base;
	}

	if (base.kind === "function") {
		const returnsCall = calls.find((call) => call.name === "returns");
		const argument = returnsCall?.arguments[0];
		if (argument !== undefined && isTypeRef(argument)) {
			return { kind: "function", returns: namedValueType(argument.typeRef) };
		}
		return base;
	}

	return base;
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
	if (name === "color") return { kind: "color" };
	if (name === "richtext") return { kind: "richtext" };
	if (name === "handle") return { kind: "handle" };
	if (name === "boolean") return { kind: "boolean" };
	if (name === "number") return { kind: "number" };
	if (name === "nil") return { kind: "nil" };
	if (name === "function") return { kind: "function" };
	if (name === "Money") return { kind: "money" };
	if ((shopifyObjectTypeNames as readonly string[]).includes(name)) {
		return { kind: "object", name };
	}
	if (/^[A-Z]/.test(name)) return { kind: "object", name };
	return { kind: "unknown" };
}

function literalValueType(literal: TypeExpressionLiteral): SemanticType {
	if (typeof literal === "string")
		return { kind: "string-literal", value: literal };
	if (typeof literal === "number")
		return { kind: "number-literal", value: literal };
	return { kind: "boolean" };
}

function isObject(
	value: TypeExpressionArgument | undefined,
): value is TypeExpressionObject {
	return typeof value === "object" && value !== null && !("typeRef" in value);
}

function isTypeRef(
	value: TypeExpressionArgument,
): value is TypeExpressionTypeRef {
	return typeof value === "object" && value !== null && "typeRef" in value;
}

function isLiteral(
	value: TypeExpressionArgument,
): value is TypeExpressionLiteral {
	return typeof value !== "object";
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
		const arguments_: TypeExpressionArgument[] = [];
		while (this.peek() !== ")") {
			arguments_.push(this.parseArgument());
			this.skipWhitespace();
			if (this.peek() === ",") {
				this.position += 1;
				this.skipWhitespace();
			}
		}
		this.expect(")");
		return { name, arguments: arguments_ };
	}

	private parseArgument(): TypeExpressionArgument {
		this.skipWhitespace();
		const char = this.peek();
		if (char === "{") return this.parseObject();
		if (char === '"' || char === "'") return this.parseString();
		if (char !== undefined && /[\d-]/.test(char)) return this.parseNumber();
		const word = this.parseIdentifier();
		if (word === "true") return true;
		if (word === "false") return false;
		return { typeRef: word };
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
