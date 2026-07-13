#!/usr/bin/env node
import { join } from "node:path";
import { registryFromEnv } from "@nazare/registry";
import { packComponent, publishComponent } from "./publish.js";

const args = process.argv.slice(2);
const command = args[0];

if (
	!command ||
	command === "help" ||
	command === "--help" ||
	command === "-h"
) {
	printHelp();
	process.exit(0);
}

try {
	if (command === "pack") {
		const dir = args[1] ?? ".";
		const { component, path } = await packComponent(
			dir,
			join(".nazare-out", "pack"),
		);
		console.log(
			JSON.stringify(
				{
					packed: { id: component.id, version: component.version },
					path,
					files: Object.keys(component.files).sort(),
				},
				null,
				2,
			),
		);
		process.exit(0);
	}

	if (command === "publish") {
		const dir = args[1] ?? ".";
		const { component, result } = await publishComponent(dir, {
			client: registryFromEnv(),
			token: process.env.NAZARE_TOKEN ?? "",
		});
		if (result.ok) {
			console.log(
				JSON.stringify(
					{
						published: { id: result.id, version: result.version },
						files: Object.keys(component.files).sort(),
					},
					null,
					2,
				),
			);
			process.exit(0);
		}
		console.error(`publish failed (${result.code}): ${result.message}`);
		if (result.code === "VERSION_EXISTS") {
			console.error(`Bump "version" in nazare.json and publish again.`);
		}
		process.exit(1);
	}

	console.error(`Unknown command ${command}`);
	printHelp();
	process.exit(1);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}

function printHelp(): void {
	console.error(`Usage:
  nazare-dev pack [dir]      write the publishable payload to .nazare-out/pack
  nazare-dev publish [dir]   publish the component in dir (default .)

Env:
  NAZARE_REGISTRY            registry base URL, or file:<dir> for a local one
  NAZARE_TOKEN              bearer token for publish (file: registries ignore it)`);
}
