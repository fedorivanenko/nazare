import assert from "node:assert/strict";
import test from "node:test";
import {
	assertFeaturePermit,
	createFeatureGateway,
	experimentalFeatureAliases,
	featureForEnableAlias,
	featureForInvocation,
	INVOCATION_FEATURE_RULES,
	publicFeatures,
} from "../dist/features.js";

test("stable features are automatic and experimental features require enablement", () => {
	const defaults = createFeatureGateway();
	assert.equal(
		defaults.require("theme-inspection").feature,
		"theme-inspection",
	);
	assert.throws(
		() => defaults.require("graph-server"),
		/--enable-experimental graph-server/,
	);

	const enabled = createFeatureGateway({ cliEnabled: ["graph-server"] });
	assert.equal(enabled.require("graph-server").feature, "graph-server");
});

test("invocation consent cannot come from environment flags", () => {
	const gateway = createFeatureGateway({
		environmentEnabled: ["graph-server", "theme-publication"],
	});
	assert.equal(gateway.require("graph-server").feature, "graph-server");
	assert.throws(
		() => gateway.require("theme-publication"),
		/per-invocation consent/,
	);
});

test("gateway rejects unknown, internal, and forged feature access", () => {
	assert.throws(
		() => createFeatureGateway({ cliEnabled: ["missing-feature"] }),
		/Unknown experimental feature missing-feature/,
	);
	assert.throws(
		() => createFeatureGateway().require("liquid-block-partial"),
		/internal and unavailable/,
	);
	assert.throws(
		() =>
			assertFeaturePermit(
				{ feature: "theme-publication" },
				"theme-publication",
			),
		/valid theme-publication feature permit/,
	);
});

test("public discovery hides internal features", () => {
	const features = publicFeatures();
	assert.equal(
		features.some((feature) => feature.stability === "internal"),
		false,
	);
	assert.equal(
		features.find((feature) => feature.id === "theme-publication")?.stability,
		"experimental",
	);
	assert.equal(
		features
			.filter((feature) => feature.stability === "experimental")
			.every((feature) => Number.isSafeInteger(feature.trackingIssue)),
		true,
	);
});

test("legacy enablement aliases are derived from registry metadata", () => {
	assert.deepEqual(experimentalFeatureAliases(), [
		{ alias: "--experimental-publish", feature: "theme-publication" },
	]);
	assert.equal(
		featureForEnableAlias("--experimental-publish"),
		"theme-publication",
	);
});

test("command feature routing is centralized and declarative", () => {
	assert.equal(
		featureForInvocation("inspect", { positionals: ["theme"] }),
		"theme-inspection",
	);
	assert.equal(
		featureForInvocation("inspect", { positionals: ["ast"] }),
		"compiler-inspection",
	);
	assert.equal(
		featureForInvocation("graph-server", { positionals: [] }),
		"graph-server",
	);
	assert.ok(INVOCATION_FEATURE_RULES.length > 0);
});
