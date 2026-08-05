import assert from "node:assert/strict";
import test from "node:test";
import {
	createCapabilityRegistry,
	createComputationGraph,
	defineCapability,
	defineCapabilityProvider,
	defineComputationRegistrar,
	definePipeline,
	pipelineIdentity,
	registerPipelineComputations,
} from "../dist/testing.js";

const buildCapability = defineCapability("build");
const inspectCapability = defineCapability("inspect");

function registrar(id, version, calls) {
	return defineComputationRegistrar({ id, version }, () => calls.push(id));
}

test("capability registry returns typed values and rejects missing capabilities", () => {
	const builder = { output: "hydrogen" };
	const registry = createCapabilityRegistry([
		defineCapabilityProvider({
			capability: buildCapability,
			id: "hydrogen.build",
			version: 1,
			value: builder,
		}),
	]);

	assert.equal(registry.has(buildCapability), true);
	assert.equal(registry.has(inspectCapability), false);
	assert.strictEqual(registry.require(buildCapability), builder);
	assert.throws(
		() => registry.require(inspectCapability),
		/does not provide capability/,
	);
});

test("capability registry rejects duplicate capability providers", () => {
	assert.throws(
		() =>
			createCapabilityRegistry([
				defineCapabilityProvider({
					capability: buildCapability,
					id: "shopify.build",
					version: 1,
					value: {},
				}),
				defineCapabilityProvider({
					capability: buildCapability,
					id: "hydrogen.build",
					version: 1,
					value: {},
				}),
			]),
		/already provided/,
	);
});

test("pipeline registers source, transforms, and output capabilities in order", () => {
	const calls = [];
	const source = registrar("shopify.source", 1, calls);
	const portable = registrar("portable.transform", 1, calls);
	const hydrogen = defineCapabilityProvider({
		capability: buildCapability,
		id: "hydrogen.build",
		version: 1,
		value: {},
		registerComputations() {
			calls.push("hydrogen.build");
		},
	});
	const pipeline = definePipeline({
		id: "shopify-to-hydrogen",
		version: 1,
		source,
		transforms: [portable],
		output: createCapabilityRegistry([hydrogen]),
	});

	registerPipelineComputations(createComputationGraph(), pipeline);
	assert.deepEqual(calls, [
		"shopify.source",
		"portable.transform",
		"hydrogen.build",
	]);
});

test("pipeline identity includes independently versioned contributors", () => {
	const calls = [];
	const output = createCapabilityRegistry([
		defineCapabilityProvider({
			capability: buildCapability,
			id: "hydrogen.build",
			version: 2,
			value: {},
		}),
	]);
	const first = definePipeline({
		id: "shopify-to-hydrogen",
		version: 1,
		source: registrar("shopify.source", 1, calls),
		transforms: [registrar("portable.transform", 1, calls)],
		output,
	});
	const upgraded = definePipeline({
		...first,
		source: registrar("shopify.source", 2, calls),
	});

	assert.notDeepEqual(pipelineIdentity(first), pipelineIdentity(upgraded));
	assert.deepEqual(pipelineIdentity(first), {
		id: "shopify-to-hydrogen",
		version: 1,
		source: "shopify.source@1",
		transforms: ["portable.transform@1"],
		output: ["hydrogen.build@2"],
	});
});

test("pipeline rejects duplicate computation contributors", () => {
	const calls = [];
	const source = registrar("shopify.source", 1, calls);
	assert.throws(
		() =>
			definePipeline({
				id: "invalid-pipeline",
				version: 1,
				source,
				transforms: [source],
				output: createCapabilityRegistry([]),
			}),
		/already registered/,
	);
});
