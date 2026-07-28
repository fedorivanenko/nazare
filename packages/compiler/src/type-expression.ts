import type {
	NumberConstraints,
	PropTypeInfo,
	SemanticType,
} from "@nazare/core";
import { shopifyObjectTypeNames } from "@nazare/core";
import { isAssignable, literalValueViolation } from "./assignability.js";

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
	const unknownTypes = unknownTypeNames(ast);
	const errors = [
		...(unknownCalls.length
			? [
					`unknown call${unknownCalls.length === 1 ? "" : "s"}: ${unknownCalls.join(", ")}`,
				]
			: []),
		...(unknownTypes.length
			? [
					`unknown type name${unknownTypes.length === 1 ? "" : "s"}: ${unknownTypes.join(", ")}`,
				]
			: []),
		...validateCallShapes(ast),
	];
	const valueType = valueTypeFromAst(ast);
	const settingCalls = ast.calls.filter((call) => call.name === "setting");
	const settingCall = settingCalls[0];
	const settingObject =
		settingCalls.length === 1
			? validSettingMetadata(settingCall?.arguments)
			: undefined;
	const defaultCall = ast.calls.find((call) => call.name === "default");
	const defaultCallValue =
		defaultCall?.arguments.length === 1 && isLiteral(defaultCall.arguments[0])
			? defaultCall.arguments[0]
			: undefined;
	const settingDefault = settingObject?.default;
	const settingHasDefault = isLiteral(settingDefault);
	const candidateDefault = settingHasDefault
		? settingDefault
		: defaultCallValue;
	let declaredDefault = candidateDefault;
	if (candidateDefault !== undefined) {
		const defaultType = literalValueType(candidateDefault);
		if (!isAssignable(defaultType, valueType)) {
			errors.push("default value is not assignable to the declared type");
			declaredDefault = undefined;
		} else {
			const violation = literalValueViolation(defaultType, valueType);
			if (violation) {
				errors.push(`default value is invalid: ${violation}`);
				declaredDefault = undefined;
			}
		}
	}
	const hasDefault = declaredDefault !== undefined;
	const error = errors.length ? errors.join("; ") : undefined;

	return {
		ast,
		typeInfo: {
			valueType,
			setting: settingObject
				? {
						label: stringValue(settingObject?.label),
						...(settingHasDefault ? { default: declaredDefault } : {}),
					}
				: undefined,
			// Recorded whether or not the prop is a setting: a snippet prop's
			// `.default()` has no schema to land in, but tooling still needs it.
			...(hasDefault ? { defaultValue: declaredDefault } : {}),
		},
		required: ast.calls.some((call) => call.name === "required"),
		hasDefault,
		error,
	};
}

/**
 * Every type name the expression uses that resolves to no known type. A typo
 * like `strng` would otherwise silently become `unknown` and disable all
 * checking of the prop; here it fails the parse instead. Uppercase names are
 * nominal object types and always legal; `object("Name")` arguments are
 * nominal by construction and not checked.
 */
function unknownTypeNames(ast: TypeExpressionAst): string[] {
	const names: string[] = [];
	const consider = (name: string): void => {
		if (namedValueType(name).kind === "unknown") names.push(name);
	};

	if (ast.base.name !== "array" && ast.base.name !== "object") {
		consider(ast.base.name);
	}
	if (ast.base.name === "array" && ast.base.argument !== undefined) {
		consider(ast.base.argument);
	}
	for (const call of ast.calls) {
		if (call.name !== "or" && call.name !== "returns") continue;
		for (const argument of call.arguments) {
			if (isTypeRef(argument)) consider(argument.typeRef);
		}
	}

	return names;
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

function validateCallShapes(ast: TypeExpressionAst): string[] {
	const errors: string[] = [];
	if (
		ast.base.argument !== undefined &&
		!["array", "object"].includes(ast.base.name)
	) {
		errors.push(`${ast.base.name} does not accept a base argument`);
	}
	const counts = new Map<string, number>();
	for (const call of ast.calls) {
		counts.set(call.name, (counts.get(call.name) ?? 0) + 1);
		if (!knownCallNames.has(call.name)) continue;
		switch (call.name) {
			case "required":
			case "optional":
				if (call.arguments.length !== 0) {
					errors.push(`${call.name}() accepts no arguments`);
				}
				break;
			case "default":
				if (call.arguments.length !== 1 || !isLiteral(call.arguments[0])) {
					errors.push("default() requires exactly one literal value");
				}
				break;
			case "enum":
				if (call.arguments.length === 0 || !call.arguments.every(isLiteral)) {
					errors.push("enum() requires one or more literal values");
				}
				break;
			case "or":
				if (call.arguments.length === 0) {
					errors.push("or() requires one or more types or literal values");
				}
				break;
			case "min":
			case "max":
			case "step": {
				const [argument] = call.arguments;
				if (
					ast.base.name !== "number" ||
					call.arguments.length !== 1 ||
					typeof argument !== "number" ||
					!Number.isFinite(argument)
				) {
					errors.push(
						`${call.name}() requires one finite number on a number type`,
					);
				} else if (call.name === "step" && argument <= 0) {
					errors.push("step() requires a number greater than zero");
				}
				break;
			}
			case "unit":
				if (
					ast.base.name !== "number" ||
					call.arguments.length !== 1 ||
					typeof call.arguments[0] !== "string"
				) {
					errors.push("unit() requires one string on a number type");
				}
				break;
			case "returns":
				if (
					ast.base.name !== "function" ||
					call.arguments.length !== 1 ||
					!isTypeRef(call.arguments[0] as TypeExpressionArgument)
				) {
					errors.push("returns() requires one type on a function type");
				}
				break;
			case "setting": {
				const [argument] = call.arguments;
				if (call.arguments.length !== 1 || !isObject(argument)) {
					errors.push("setting() requires exactly one metadata object");
					break;
				}
				const metadata = argument as TypeExpressionObject;
				const unknownKeys = Object.keys(metadata).filter(
					(key) => key !== "label" && key !== "default",
				);
				if (unknownKeys.length > 0) {
					errors.push(`setting() has unknown keys: ${unknownKeys.join(", ")}`);
				}
				if (
					metadata.label !== undefined &&
					typeof metadata.label !== "string"
				) {
					errors.push("setting().label must be a string");
				}
				if (metadata.default !== undefined && !isLiteral(metadata.default)) {
					errors.push("setting().default must be a literal value");
				}
				break;
			}
		}
	}
	for (const [name, count] of counts) {
		if (knownCallNames.has(name) && count > 1) {
			errors.push(`${name}() is declared more than once`);
		}
	}
	if (counts.has("required") && counts.has("optional")) {
		errors.push("required() and optional() cannot be combined");
	}
	const setting = ast.calls.find((call) => call.name === "setting");
	const settingArgument = setting?.arguments[0];
	const settingMetadata = isObject(settingArgument)
		? (settingArgument as TypeExpressionObject)
		: undefined;
	const hasSettingDefault = isLiteral(settingMetadata?.default);
	if (counts.has("default") && hasSettingDefault) {
		errors.push("default value must be declared in one place");
	}
	if (counts.has("required") && (counts.has("default") || hasSettingDefault)) {
		errors.push("required() cannot be combined with a default value");
	}
	const numberType = applyBaseCalls({ kind: "number" }, ast.calls);
	if (
		ast.base.name === "number" &&
		numberType.kind === "number" &&
		numberType.constraints?.min !== undefined &&
		numberType.constraints.max !== undefined &&
		numberType.constraints.min > numberType.constraints.max
	) {
		errors.push("min() cannot be greater than max()");
	}
	return errors;
}

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

function validSettingMetadata(
	arguments_: TypeExpressionArgument[] | undefined,
): TypeExpressionObject | undefined {
	if (arguments_?.length !== 1 || !isObject(arguments_[0])) return undefined;
	const metadata = arguments_[0] as TypeExpressionObject;
	if (
		Object.keys(metadata).some((key) => key !== "label" && key !== "default")
	) {
		return undefined;
	}
	if (metadata.label !== undefined && typeof metadata.label !== "string") {
		return undefined;
	}
	if (metadata.default !== undefined && !isLiteral(metadata.default)) {
		return undefined;
	}
	return metadata;
}

function isObject(
	value: TypeExpressionArgument | undefined,
): value is TypeExpressionObject {
	return typeof value === "object" && value !== null && !("typeRef" in value);
}

function isTypeRef(
	value: TypeExpressionArgument | undefined,
): value is TypeExpressionTypeRef {
	return typeof value === "object" && value !== null && "typeRef" in value;
}

function isLiteral(
	value: TypeExpressionArgument | undefined,
): value is TypeExpressionLiteral {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
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
