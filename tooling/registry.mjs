#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import YAML from "yaml";

const root = process.cwd();
const configPath = path.join(root, "nazare.config.yml");
const lockPath = path.join(root, "nazare.lock.yml");

const args = process.argv.slice(2);
const command = args[0];
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const yes = flags.has("--yes") || flags.has("-y");
const dryRun = flags.has("--dry-run");
const componentNames = args.slice(1).filter((arg) => !arg.startsWith("--"));

function usage() {
	console.log(`Usage:
  pnpm registry list
  pnpm registry pull <component...> [--yes] [--dry-run]

Examples:
  pnpm registry list
  pnpm registry pull s-hero
  pnpm registry pull core s-social-video-gallery --yes`);
}

async function readYaml(filePath) {
	return YAML.parse(await fs.readFile(filePath, "utf8"));
}

async function readJson(filePath) {
	return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function run(name, argv, options = {}) {
	const result = spawnSync(name, argv, {
		stdio: options.stdio ?? "pipe",
		encoding: "utf8",
		...options,
	});

	if (result.status !== 0) {
		const stderr = result.stderr ? `\n${result.stderr}` : "";
		throw new Error(`${name} ${argv.join(" ")} failed${stderr}`);
	}

	return result.stdout?.trim() ?? "";
}

async function cloneRegistry(config) {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nazare-registry-"));
	const cloneArgs = ["clone", "--depth", "1"];

	if (config.registry.ref) {
		cloneArgs.push("--branch", config.registry.ref);
	}

	cloneArgs.push(config.registry.repo, tmpDir);
	run("git", cloneArgs);
	return tmpDir;
}

function getComponents(manifest) {
	return manifest.components ?? {};
}

function resolveComponents(components, names) {
	const resolved = [];
	const seen = new Set();

	function visit(name) {
		if (seen.has(name)) return;

		const component = components[name];
		if (!component) {
			throw new Error(`Unknown registry component: ${name}`);
		}

		seen.add(name);

		for (const dependency of component.dependencies ?? []) {
			visit(dependency);
		}

		resolved.push(name);
	}

	for (const name of names) {
		visit(name);
	}

	return resolved;
}

function toThemeSource(sourcePath, entryPath) {
	const entryDir = path.dirname(entryPath);
	const relative = path
		.relative(entryDir, sourcePath)
		.replaceAll(path.sep, "/");
	return relative.startsWith(".") ? relative : `./${relative}`;
}

function cssEntryContent(component) {
	if (!component.css || component.css.mode !== "generated") return null;

	const sources = component.css.sources ?? [];
	const imports =
		component.kind === "core"
			? ['@import "tailwindcss" source(none);']
			: [
					'@import "tailwindcss/theme" source(none);',
					'@import "tailwindcss/utilities" source(none);',
				];

	const sourceLines = sources.map(
		(source) => `@source "${toThemeSource(source, component.css.entry)}";`,
	);
	return `${imports.join("\n")}\n\n${sourceLines.join("\n")}\n`;
}

async function confirmOverwrite(rl, filePath) {
	if (yes) return true;

	if (!input.isTTY) {
		throw new Error(
			`Refusing to overwrite ${filePath} in non-interactive mode. Re-run with --yes to overwrite.`,
		);
	}

	const answer = await rl.question(`Overwrite ${filePath}? [y/N] `);
	return (
		answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes"
	);
}

async function stageWrite(rl, writes, targetPath, content) {
	const relativePath = path
		.relative(root, targetPath)
		.replaceAll(path.sep, "/");

	if (fsSync.existsSync(targetPath)) {
		const existing = await fs.readFile(targetPath, "utf8");
		if (existing === content) {
			console.log(`same  ${relativePath}`);
			return;
		}

		if (!(await confirmOverwrite(rl, relativePath))) {
			console.log(`skip  ${relativePath}`);
			return;
		}

		writes.push({ targetPath, content, label: `write ${relativePath}` });
		return;
	}

	writes.push({ targetPath, content, label: `add   ${relativePath}` });
}

async function writeAll(writes) {
	for (const write of writes) {
		console.log(write.label);

		if (dryRun) continue;

		await fs.mkdir(path.dirname(write.targetPath), { recursive: true });
		await fs.writeFile(write.targetPath, write.content);
	}
}

function mergePackageJson(packageJson, components, resolvedNames) {
	const nextPackageJson = structuredClone(packageJson);

	for (const name of resolvedNames) {
		const packagePatch = components[name].package;
		if (!packagePatch) continue;

		nextPackageJson.scripts = {
			...(nextPackageJson.scripts ?? {}),
			...(packagePatch.scripts ?? {}),
		};

		nextPackageJson.dependencies = {
			...(nextPackageJson.dependencies ?? {}),
			...(packagePatch.dependencies ?? {}),
		};

		nextPackageJson.devDependencies = {
			...(nextPackageJson.devDependencies ?? {}),
			...(packagePatch.devDependencies ?? {}),
		};
	}

	return `${JSON.stringify(nextPackageJson, null, "\t")}\n`;
}

function lockEntry(component) {
	return {
		kind: component.kind,
		...(component.dependencies ? { dependencies: component.dependencies } : {}),
		...(component.package ? { package: component.package } : {}),
		...(component.css
			? {
					css: {
						mode: component.css.mode,
						entry: component.css.entry,
						output: component.css.output,
						...(component.css.load ? { load: component.css.load } : {}),
					},
				}
			: {}),
	};
}

function lockContent(
	config,
	manifest,
	components,
	resolvedNames,
	existingLock,
) {
	const nextComponents = {
		...(existingLock?.components ?? {}),
	};

	for (const name of resolvedNames) {
		nextComponents[name] = lockEntry(components[name]);
	}

	const lock = {
		version: manifest.version ?? 1,
		registry: config.registry,
		components: nextComponents,
	};

	return YAML.stringify(lock);
}

async function main() {
	if (!command || command === "help" || flags.has("--help")) {
		usage();
		return;
	}

	const config = await readYaml(configPath);
	if (!config.registry?.repo || !config.registry?.manifest) {
		throw new Error(
			"Invalid nazare.config.yml: missing registry.repo or registry.manifest",
		);
	}

	const registryDir = await cloneRegistry(config);
	const manifestPath = path.join(registryDir, config.registry.manifest);
	const manifest = await readYaml(manifestPath);
	const components = getComponents(manifest);

	if (command === "list") {
		for (const [name, component] of Object.entries(components)) {
			console.log(`${name}\t${component.kind ?? "component"}`);
		}
		return;
	}

	if (command !== "pull") {
		usage();
		process.exitCode = 1;
		return;
	}

	if (componentNames.length === 0) {
		throw new Error("No components given. Example: pnpm registry pull s-hero");
	}

	const resolvedNames = resolveComponents(components, componentNames);
	console.log(`Resolved: ${resolvedNames.join(", ")}`);

	const existingLock = fsSync.existsSync(lockPath)
		? await readYaml(lockPath)
		: null;
	const rl = readline.createInterface({ input, output });
	const writes = [];

	try {
		if (resolvedNames.some((name) => components[name].package)) {
			await stageWrite(
				rl,
				writes,
				path.join(root, "package.json"),
				mergePackageJson(
					await readJson(path.join(root, "package.json")),
					components,
					resolvedNames,
				),
			);
		}

		for (const name of resolvedNames) {
			const component = components[name];

			for (const file of component.files ?? []) {
				const sourcePath = path.join(registryDir, file);
				if (!fsSync.existsSync(sourcePath)) {
					throw new Error(`Manifest references missing file: ${file}`);
				}

				await stageWrite(
					rl,
					writes,
					path.join(root, file),
					await fs.readFile(sourcePath, "utf8"),
				);
			}

			const cssContent = cssEntryContent(component);
			if (cssContent) {
				await stageWrite(
					rl,
					writes,
					path.join(root, component.css.entry),
					cssContent,
				);
			}
		}

		await stageWrite(
			rl,
			writes,
			lockPath,
			lockContent(config, manifest, components, resolvedNames, existingLock),
		);
	} finally {
		rl.close();
	}

	await writeAll(writes);

	if (dryRun) {
		console.log("Dry run only. No files changed.");
	}
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
