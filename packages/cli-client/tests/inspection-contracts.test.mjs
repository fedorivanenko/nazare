import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv from "ajv";
import { main } from "../dist/index.js";
import {
	THEME_IMPACT_CONTRACT_VERSION,
	THEME_INSPECTION_CONTRACT_VERSION,
	THEME_METAFIELD_CONTRACT_VERSION,
} from "../dist/inspection-contracts.js";

const CONTRACT_ROOT = new URL("../contracts/", import.meta.url);
const CONTRACTS = [
	{
		name: "theme inspection v1",
		schema: "theme-inspection-v1.schema.json",
		golden: "examples/theme-inspection-v1.json",
		version: THEME_INSPECTION_CONTRACT_VERSION,
		arguments: ["inspect", "theme", ".", "--format", "json"],
	},
	{
		name: "theme impact v1",
		schema: "theme-impact-v1.schema.json",
		golden: "examples/theme-impact-v1.json",
		version: THEME_IMPACT_CONTRACT_VERSION,
		arguments: [
			"inspect",
			"impact",
			"snippets/card.liquid",
			".",
			"--format",
			"json",
		],
	},
	{
		name: "theme metafield v2",
		schema: "theme-metafield-v2.schema.json",
		golden: "examples/theme-metafield-v2.json",
		version: THEME_METAFIELD_CONTRACT_VERSION,
		arguments: [
			"inspect",
			"metafield",
			"product.custom.subtitle",
			".",
			"--format",
			"json",
		],
	},
];

async function readJson(path) {
	return JSON.parse(await readFile(new URL(path, CONTRACT_ROOT), "utf8"));
}

async function createContractProject() {
	const root = await mkdtemp(join(tmpdir(), "nazare-inspection-contract-"));
	await mkdir(join(root, "templates"));
	await mkdir(join(root, "sections"));
	await mkdir(join(root, "snippets"));
	await writeFile(
		join(root, "templates/product.json"),
		JSON.stringify({ sections: { main: { type: "main" } } }),
	);
	await writeFile(join(root, "sections/main.liquid"), "{% render 'card' %}");
	await writeFile(
		join(root, "snippets/card.liquid"),
		"{{ product.metafields.custom.subtitle.value }}",
	);
	return root;
}

async function runContractCommand(root, arguments_) {
	let stdout = "";
	let stderr = "";
	const status = await main(arguments_, {
		cwd: root,
		env: {},
		output: {
			log: (...values) => {
				stdout += `${values.join(" ")}\n`;
			},
			error: (...values) => {
				stderr += `${values.join(" ")}\n`;
			},
		},
	});
	assert.equal(status, 0, stderr);
	return JSON.parse(stdout);
}

test("stable CLI inspection outputs match schemas and golden contracts", async (context) => {
	const ajv = new Ajv({ allErrors: true, strict: true });
	ajv.addSchema(await readJson("diagnostic-v1.schema.json"));
	const root = await createContractProject();
	try {
		for (const contract of CONTRACTS) {
			await context.test(contract.name, async () => {
				const schema = await readJson(contract.schema);
				assert.equal(schema.properties.version.const, contract.version);
				const validate = ajv.compile(schema);
				const actual = await runContractCommand(root, contract.arguments);
				assert.equal(actual.version, contract.version);
				assert.equal(
					validate(actual),
					true,
					ajv.errorsText(validate.errors, { separator: "\n" }),
				);
				assert.deepEqual(actual, await readJson(contract.golden));
			});
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
