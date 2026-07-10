import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTypeExpression } from "../dist/type-expression.js";

test("type-expression: bare type", () => {
	const parsed = parseTypeExpression("string");
	assert.deepEqual(parsed.typeInfo.valueType, { kind: "string" });
	assert.equal(parsed.required, false);
	assert.equal(parsed.error, undefined);
});

test("type-expression: required call", () => {
	const parsed = parseTypeExpression("url.required()");
	assert.deepEqual(parsed.typeInfo.valueType, { kind: "url" });
	assert.equal(parsed.required, true);
});

test("type-expression: setting with label and default", () => {
	const parsed = parseTypeExpression(
		`string.setting({ label: "Text", default: "Free shipping" })`,
	);
	assert.deepEqual(parsed.typeInfo.setting, {
		label: "Text",
		default: "Free shipping",
	});
	assert.equal(parsed.hasDefault, true);
});

test("type-expression: non-string default survives", () => {
	const parsed = parseTypeExpression(
		"number.setting({ label: 'Count', default: 3 })",
	);
	assert.equal(parsed.typeInfo.setting?.default, 3);
	assert.equal(parsed.hasDefault, true);
});

test("type-expression: array and object bases", () => {
	assert.deepEqual(parseTypeExpression("array(ShopifyProduct)").typeInfo.valueType, {
		kind: "array",
		element: { kind: "object", name: "ShopifyProduct" },
	});
	assert.deepEqual(parseTypeExpression(`object("ShopifyImage")`).typeInfo.valueType, {
		kind: "object",
		name: "ShopifyImage",
	});
	assert.deepEqual(parseTypeExpression("Money").typeInfo.valueType, {
		kind: "money",
	});
});

test("type-expression: default call sets hasDefault", () => {
	const parsed = parseTypeExpression(`string.default("hi")`);
	assert.equal(parsed.hasDefault, true);
});

test("type-expression: chained calls", () => {
	const parsed = parseTypeExpression(
		`string.required().setting({ label: "T" })`,
	);
	assert.equal(parsed.required, true);
	assert.equal(parsed.typeInfo.setting?.label, "T");
});

test("type-expression: malformed input reports error, falls back to unknown", () => {
	const parsed = parseTypeExpression("string.setting({ label: })");
	assert.ok(parsed.error);
	assert.deepEqual(parsed.typeInfo.valueType, { kind: "unknown" });
});

test("type-expression: or() builds a union", () => {
	const parsed = parseTypeExpression("url.or(string)");
	assert.deepEqual(parsed.typeInfo.valueType, {
		kind: "union",
		members: [{ kind: "url" }, { kind: "string" }],
	});
});

test("type-expression: optional() adds nil to the type", () => {
	const parsed = parseTypeExpression("string.optional()");
	assert.deepEqual(parsed.typeInfo.valueType, {
		kind: "union",
		members: [{ kind: "string" }, { kind: "nil" }],
	});
	assert.equal(parsed.required, false);
});

test("type-expression: enum() replaces base with literal union", () => {
	const parsed = parseTypeExpression(`string.enum("left", "center", "right")`);
	assert.deepEqual(parsed.typeInfo.valueType, {
		kind: "union",
		members: [
			{ kind: "string-literal", value: "left" },
			{ kind: "string-literal", value: "center" },
			{ kind: "string-literal", value: "right" },
		],
	});
});

test("type-expression: chained or/optional/setting", () => {
	const parsed = parseTypeExpression(
		`url.or(string).optional().setting({ label: "Link" })`,
	);
	assert.deepEqual(parsed.typeInfo.valueType, {
		kind: "union",
		members: [{ kind: "url" }, { kind: "string" }, { kind: "nil" }],
	});
	assert.equal(parsed.typeInfo.setting?.label, "Link");
});

test("type-expression: number range constraints", () => {
	const parsed = parseTypeExpression(
		`number.min(0).max(100).step(5).unit("px").setting({ label: "Size" })`,
	);
	assert.deepEqual(parsed.typeInfo.valueType, {
		kind: "number",
		constraints: { min: 0, max: 100, step: 5, unit: "px" },
	});
	assert.equal(parsed.typeInfo.setting?.label, "Size");
});

test("type-expression: constrained number stays number when optional", () => {
	const parsed = parseTypeExpression("number.min(1).optional()");
	assert.deepEqual(parsed.typeInfo.valueType, {
		kind: "union",
		members: [
			{ kind: "number", constraints: { min: 1 } },
			{ kind: "nil" },
		],
	});
});

test("type-expression: function type with returns", () => {
	assert.deepEqual(parseTypeExpression("function").typeInfo.valueType, {
		kind: "function",
	});
	assert.deepEqual(
		parseTypeExpression("function.returns(string)").typeInfo.valueType,
		{ kind: "function", returns: { kind: "string" } },
	);
});

test("type-expression: escaped quotes in strings", () => {
	const parsed = parseTypeExpression(
		`string.setting({ label: "Say \\"hi\\"" })`,
	);
	assert.equal(parsed.typeInfo.setting?.label, `Say "hi"`);
});
