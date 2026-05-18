#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const templateRoot = path.join(repoRoot, "templates", "default");
const defaultRepo = "https://github.com/fedorivanenko/nazare-registry.git";
const defaultRef = "main";
let updateNoticeShown = false;

const help = `nazare

Usage:
  nazare init [name]       Create a Nazare Shopify theme from nazare-registry
  nazare list              List registry components
  nazare pull <component>  Pull registry components into current theme
  nazare registry list     List registry components
  nazare registry pull     Pull registry components into current theme
  nazare self install      Install nazare CLI
  nazare self update       Update nazare CLI
  nazare --version         Print version
  nazare --help            Print help
`;

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});

async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	if (!command || command === "--help" || command === "-h") {
		process.stdout.write(help);
		return;
	}

	if (command === "--version" || command === "-v") {
		const pkg = await readJson(path.join(repoRoot, "package.json"));
		console.log(pkg.version ?? "0.0.0");
		return;
	}

	if (command === "init") {
		await init(args[1]);
		return;
	}

	if (command === "registry") {
		await registry(args.slice(1));
		return;
	}

	if (command === "list" || command === "pull") {
		await registry(args);
		return;
	}

	if (command === "self" && args[1] === "install") {
		await installCli();
		return;
	}

	if (command === "self" && args[1] === "update") {
		await installCli();
		return;
	}

	throw new Error(`Unknown command: ${args.join(" ")}`);
}

async function init(rawName) {
	const name = rawName ?? (await prompt("Project name", "my-shopify-store"));
	const projectName = name.trim();

	if (!projectName) throw new Error("Project name required");
	if (projectName.includes("/") || projectName.includes("\\")) {
		throw new Error("Project name must be a directory name, not a path");
	}

	if (!(await pathExists(templateRoot))) {
		throw new Error(`Missing template: ${templateRoot}`);
	}

	const targetDir = path.resolve(process.cwd(), projectName);
	if (await pathExists(targetDir)) {
		throw new Error(`Directory already exists: ${targetDir}`);
	}

	await fs.mkdir(targetDir, { recursive: true });

	try {
		await copyDir(templateRoot, targetDir);
		await patchPackageName(targetDir, projectName);
		await maybeGitInit(targetDir);
	} catch (error) {
		await fs.rm(targetDir, { recursive: true, force: true });
		throw error;
	}

	console.log(`Created ${projectName}`);
	console.log("");
	console.log("Next:");
	console.log(`  cd ${projectName}`);
	console.log("  cp .example.env .env");
	console.log("  pnpm install");
	console.log("  pnpm dev");
}

async function installCli() {
	if (!(await commandExists("git"))) throw new Error("git required");

	const installDir = path.resolve(
		process.env.NAZARE_INSTALL_DIR ?? path.join(os.homedir(), ".nazare"),
	);
	const binDir = path.resolve(
		process.env.NAZARE_BIN_DIR ?? path.join(os.homedir(), ".local", "bin"),
	);
	const binPath = path.join(binDir, "nazare");
	const sourceDir = process.env.NAZARE_SOURCE_DIR
		? path.resolve(process.env.NAZARE_SOURCE_DIR)
		: await cloneFreshRepo();
	const nextDir = `${installDir}.next-${process.pid}`;
	const backupDir = `${installDir}.old-${process.pid}`;

	await fs.rm(nextDir, { recursive: true, force: true });
	await fs.rm(backupDir, { recursive: true, force: true });
	await fs.mkdir(path.dirname(installDir), { recursive: true });
	await copyDir(sourceDir, nextDir);
	await fs.chmod(path.join(nextDir, "bin", "cli.js"), 0o755);

	if (await pathExists(installDir)) {
		await fs.rename(installDir, backupDir);
	}

	try {
		await fs.rename(nextDir, installDir);
	} catch (error) {
		if (await pathExists(backupDir)) await fs.rename(backupDir, installDir);
		throw error;
	}

	await fs.rm(backupDir, { recursive: true, force: true });
	await fs.mkdir(binDir, { recursive: true });
	await fs.writeFile(
		binPath,
		`#!/bin/sh\nnode "${path.join(installDir, "bin", "cli.js")}" "$@"\n`,
	);
	await fs.chmod(binPath, 0o755);

	console.log(`Installed nazare to ${binPath}`);

	if (!(process.env.PATH ?? "").split(path.delimiter).includes(binDir)) {
		console.log("");
		console.log("Add to shell profile:");
		console.log(`  export PATH="${binDir}:$PATH"`);
	}

	await printInstalledUpdateNotice(installDir);

	console.log("");
	console.log("Run:");
	console.log("  nazare init my-store");
}

async function printInstalledUpdateNotice(installDir) {
	try {
		const pkg = await readJson(path.join(installDir, "package.json"));
		const notice = pkg.nazare?.updateNotice;
		if (!notice) return;

		console.log("");
		console.log(`Notice: ${notice}`);
	} catch {
		// Update notices should never block install/update.
	}
}

async function cloneFreshRepo() {
	const repo = process.env.NAZARE_REPO ?? defaultRepo;
	const ref = process.env.NAZARE_REF ?? defaultRef;
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nazare-install-"));
	const targetDir = path.join(tmpDir, "nazare-registry");

	try {
		await run(
			"git",
			["clone", "--depth", "1", "--branch", ref, repo, targetDir],
			{
				stdio: "ignore",
			},
		);
	} catch (error) {
		await fs.rm(tmpDir, { recursive: true, force: true });
		throw error;
	}

	return targetDir;
}

async function registry(args) {
	const root = process.cwd();
	const command = args[0];
	const flags = new Set(
		args.filter((arg) => arg.startsWith("--") || arg.startsWith("-")),
	);
	const yes = flags.has("--yes") || flags.has("-y");
	const dryRun = flags.has("--dry-run");
	const componentNames = args.slice(1).filter((arg) => !arg.startsWith("-"));

	if (
		!command ||
		command === "help" ||
		flags.has("--help") ||
		flags.has("-h")
	) {
		console.log(`Usage:
  nazare list
  nazare pull <component...> [--yes] [--dry-run]

Aliases:
  nazare registry list
  nazare registry pull <component...>

Examples:
  nazare list
  nazare pull s-hero
  nazare pull core s-social-video-gallery --yes`);
		return;
	}

	const configPath = path.join(root, "nazare.config.yml");
	const lockPath = path.join(root, "nazare.lock.yml");
	const themeJsPath = path.join(root, "scripts", "theme.js");
	const sectionCssPath = path.join(root, "snippets", "section-css.liquid");
	const sectionCssPreloadsPath = path.join(
		root,
		"snippets",
		"section-css-preloads.liquid",
	);
	const config = parseYaml(await fs.readFile(configPath, "utf8"));

	if (!config.registry?.repo || !config.registry?.manifest) {
		throw new Error(
			"Invalid nazare.config.yml: missing registry.repo or registry.manifest",
		);
	}

	const registryDir = await cloneRegistry(config);
	await maybeNotifyCliUpdate(registryDir);
	const registryPkg = await readJson(path.join(registryDir, "package.json"));
	const registryVersion = registryPkg.version ?? "0.0.0";
	const manifest = parseYaml(
		await fs.readFile(path.join(registryDir, config.registry.manifest), "utf8"),
	);
	const components = manifest.components ?? {};

	if (command === "list") {
		for (const [name, component] of Object.entries(components)) {
			console.log(`${name}\t${component.kind ?? "component"}`);
		}
		return;
	}

	if (command !== "pull")
		throw new Error(`Unknown registry command: ${command}`);
	if (componentNames.length === 0)
		throw new Error("No components given. Example: nazare pull s-hero");

	const resolvedNames = resolveComponents(components, componentNames);
	await validateJsDependencies(registryDir, components, resolvedNames);
	console.log(`Resolved: ${resolvedNames.join(", ")}`);

	const existingLock = (await pathExists(lockPath))
		? parseYaml(await fs.readFile(lockPath, "utf8"))
		: null;
	maybeNotifyComponentUpdates(existingLock, registryPkg);
	const nextLock = buildLock(
		config,
		manifest,
		components,
		resolvedNames,
		existingLock,
		registryVersion,
	);
	const writes = [];

	for (const name of resolvedNames) {
		const component = components[name];

		for (const file of component.files ?? []) {
			const fileMapping = normalizeFileMapping(file);
			const sourcePath = path.join(registryDir, fileMapping.from);
			if (!(await pathExists(sourcePath)))
				throw new Error(
					`Manifest references missing file: ${fileMapping.from}`,
				);
			await stageWrite(
				writes,
				path.join(root, fileMapping.to),
				await fs.readFile(sourcePath, "utf8"),
				root,
				yes,
			);
		}

		const cssContent = cssEntryContent(component);
		if (cssContent)
			await stageWrite(
				writes,
				path.join(root, component.css.entry),
				cssContent,
				root,
				yes,
			);
	}

	await stageWrite(writes, themeJsPath, themeJsContent(nextLock), root, yes);
	await stageWrite(
		writes,
		sectionCssPath,
		sectionCssContent(nextLock),
		root,
		yes,
	);
	await stageWrite(
		writes,
		sectionCssPreloadsPath,
		sectionCssPreloadsContent(nextLock),
		root,
		yes,
	);
	await stageLayoutSectionCssPreloads(writes, root, yes);
	await stageWatchTooling(writes, root, yes);
	await stageDevTooling(writes, root, yes);
	await stageWrite(writes, lockPath, stringifyYaml(nextLock), root, yes);
	await writeAll(writes, dryRun);

	if (dryRun) console.log("Dry run only. No files changed.");
}

async function cloneRegistry(config) {
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nazare-registry-"));
	const args = ["clone", "--depth", "1"];
	if (config.registry.ref) args.push("--branch", config.registry.ref);
	args.push(config.registry.repo, tmpDir);
	await run("git", args, { stdio: "ignore" });
	return tmpDir;
}

async function maybeNotifyCliUpdate(registryDir) {
	if (updateNoticeShown) return;
	updateNoticeShown = true;

	try {
		const currentPkg = await readJson(path.join(repoRoot, "package.json"));
		const latestPkg = await readJson(path.join(registryDir, "package.json"));
		const currentVersion = currentPkg.version ?? "0.0.0";
		const latestVersion = latestPkg.version ?? "0.0.0";

		if (compareVersions(latestVersion, currentVersion) > 0) {
			console.error(
				`nazare update available: ${currentVersion} -> ${latestVersion}. Run: nazare self update`,
			);
			if (latestPkg.nazare?.updateNotice) {
				console.error(`Notice: ${latestPkg.nazare.updateNotice}`);
			}
		}
	} catch {
		// Update checks should never block registry commands.
	}
}

function maybeNotifyComponentUpdates(existingLock, registryPkg) {
	const componentUpdates = registryPkg.nazare?.componentUpdates;
	if (!existingLock?.components || !isPlainObject(componentUpdates)) return;

	for (const [name, requiredVersion] of Object.entries(componentUpdates)) {
		const installed = existingLock.components[name];
		if (!installed) continue;

		const installedVersion = installed.version ?? "0.0.0";
		if (compareVersions(requiredVersion, installedVersion) > 0) {
			console.error(
				`${name} update available: ${installedVersion} -> ${requiredVersion}. Run: nazare pull ${name} --yes`,
			);
		}
	}
}

function compareVersions(a, b) {
	const left = versionParts(a);
	const right = versionParts(b);
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (left[index] ?? 0) - (right[index] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

function versionParts(version) {
	return String(version)
		.split(/[.-]/)
		.map((part) => Number.parseInt(part, 10))
		.map((part) => (Number.isNaN(part) ? 0 : part));
}

function normalizeFileMapping(file) {
	if (typeof file === "string") return { from: file, to: file };
	if (file?.from && file?.to) return file;
	throw new Error(
		"Invalid manifest file entry: expected string or { from, to }",
	);
}

function resolveComponents(components, names) {
	const resolved = [];
	const seen = new Set();

	function visit(name) {
		if (seen.has(name)) return;
		const component = components[name];
		if (!component) throw new Error(`Unknown registry component: ${name}`);
		seen.add(name);
		for (const dependency of component.dependencies ?? []) visit(dependency);
		resolved.push(name);
	}

	for (const name of names) visit(name);
	return resolved;
}

async function validateJsDependencies(registryDir, components, componentNames) {
	const ownerByTarget = new Map();
	for (const [name, component] of Object.entries(components)) {
		for (const file of component.files ?? []) {
			const fileMapping = normalizeFileMapping(file);
			ownerByTarget.set(normalizeThemePath(fileMapping.to), name);
		}
	}

	for (const name of componentNames) {
		const component = components[name];
		const dependencies = new Set(component.dependencies ?? []);
		for (const file of component.files ?? []) {
			const fileMapping = normalizeFileMapping(file);
			if (!fileMapping.to.endsWith(".js")) continue;

			const sourcePath = path.join(registryDir, fileMapping.from);
			if (!(await pathExists(sourcePath))) continue;

			const source = await fs.readFile(sourcePath, "utf8");
			for (const specifier of localImportSpecifiers(source)) {
				const importedTarget = resolveThemeImport(fileMapping.to, specifier);
				const owner = ownerByTarget.get(importedTarget);
				if (!owner || owner === name || dependencies.has(owner)) continue;
				throw new Error(
					`Invalid registry JS dependency: ${name} ${fileMapping.to} imports ${specifier} (${importedTarget}), owned by ${owner}. Add ${owner} to ${name}.dependencies or move import to component js.initializers.`,
				);
			}
		}
	}
}

function localImportSpecifiers(source) {
	const specifiers = [];
	const importPattern = /import\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g;
	let match = importPattern.exec(source);
	while (match) {
		if (match[1].startsWith(".")) specifiers.push(match[1]);
		match = importPattern.exec(source);
	}
	return specifiers;
}

function resolveThemeImport(importerPath, specifier) {
	const target = normalizeThemePath(
		path.join(path.dirname(importerPath), specifier),
	);
	return path.extname(target) ? target : `${target}.js`;
}

function normalizeThemePath(filePath) {
	return path.normalize(filePath).replaceAll(path.sep, "/");
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

	const imports =
		component.kind === "core"
			? ['@import "tailwindcss" source(none);']
			: [
					'@import "tailwindcss/theme" source(none);',
					'@import "tailwindcss/utilities" source(none);',
				];
	const sourceLines = (component.css.sources ?? []).map(
		(source) => `@source "${toThemeSource(source, component.css.entry)}";`,
	);
	return `${imports.join("\n")}\n\n${sourceLines.join("\n")}\n`;
}

function themeJsContent(lock) {
	const sideEffectImports = new Set();
	const namedImports = new Map();
	const calls = [];

	for (const component of Object.values(lock.components ?? {})) {
		for (const importPath of component.js?.imports ?? []) {
			sideEffectImports.add(importPath);
		}

		for (const initializer of component.js?.initializers ?? []) {
			if (!initializer.import || !initializer.name) {
				throw new Error(
					"Invalid component js.initializers entry: expected { import, name }",
				);
			}
			if (!namedImports.has(initializer.import)) {
				namedImports.set(initializer.import, new Set());
			}
			namedImports.get(initializer.import).add(initializer.name);
			calls.push(initializer.call ?? `${initializer.name}();`);
		}
	}

	const lines = ["// Generated by Nazare registry CLI. Do not edit directly."];

	for (const importPath of sideEffectImports) {
		lines.push(`import ${JSON.stringify(importPath)};`);
	}
	for (const [importPath, names] of namedImports) {
		lines.push(
			`import { ${[...names].join(", ")} } from ${JSON.stringify(importPath)};`,
		);
	}
	if (calls.length > 0) {
		lines.push("", ...calls);
	}

	return `${lines.join("\n")}\n`;
}

function sectionCssContent(lock) {
	const sectionEntries = Object.entries(lock.components ?? {}).filter(
		([, component]) => component.kind === "section" && component.css?.output,
	);
	const cases = sectionEntries.map(([name, component]) => {
		const assetName = path.basename(component.css.output);
		return `  {% when '${name}' %}\n    {{ '${assetName}' | asset_url | stylesheet_tag }}`;
	});
	return `{% comment %}\n  Generated by Nazare registry CLI. Do not edit directly.\n{% endcomment %}\n\n{% case section_name %}\n${cases.join("\n")}\n{% endcase %}\n`;
}

function sectionCssPreloadsContent(lock) {
	const preloadEntries = Object.values(lock.components ?? {}).filter(
		(component) =>
			component.kind === "section" &&
			component.css?.output &&
			component.css.load === "preload",
	);
	const lines = preloadEntries.map((component) => {
		const assetName = path.basename(component.css.output);
		return `{{ '${assetName}' | asset_url | preload_tag: as: 'style' }}`;
	});
	return `{% comment %}\n  Generated by Nazare registry CLI. Do not edit directly.\n{% endcomment %}\n\n${lines.join("\n")}\n`;
}

async function stageLayoutSectionCssPreloads(writes, root, yes) {
	const layoutPath = path.join(root, "layout", "theme.liquid");
	if (!(await pathExists(layoutPath))) return;

	const existing = await fs.readFile(layoutPath, "utf8");
	if (existing.includes("{% render 'section-css-preloads' %}")) return;

	const anchor = "    {{ 'base.css' | asset_url | stylesheet_tag }}\n";
	if (!existing.includes(anchor)) {
		console.log(
			"skip  layout/theme.liquid section CSS preload hook missing anchor",
		);
		return;
	}

	await stageWrite(
		writes,
		layoutPath,
		existing.replace(
			anchor,
			`${anchor}    {% render 'section-css-preloads' %}\n`,
		),
		root,
		yes,
	);
}

async function stageWatchTooling(writes, root, yes) {
	const sourcePath = path.join(templateRoot, "tooling", "watch.mjs");
	if (await pathExists(sourcePath)) {
		await stageWrite(
			writes,
			path.join(root, "tooling", "watch.mjs"),
			await fs.readFile(sourcePath, "utf8"),
			root,
			yes,
		);
	}

	const packagePath = path.join(root, "package.json");
	if (!(await pathExists(packagePath))) return;

	const pkg = await readJson(packagePath);
	pkg.scripts ??= {};
	const currentWatch = pkg.scripts.watch;

	if (currentWatch === "node tooling/watch.mjs") return;
	if (
		currentWatch &&
		currentWatch !== "vite build --watch --emptyOutDir=false"
	) {
		console.log(`skip  package.json watch script is custom: ${currentWatch}`);
		return;
	}

	pkg.scripts.watch = "node tooling/watch.mjs";
	await stageWrite(
		writes,
		packagePath,
		`${JSON.stringify(pkg, null, "\t")}\n`,
		root,
		yes,
	);
}

async function stageDevTooling(writes, root, yes) {
	const sourcePath = path.join(templateRoot, "tooling", "dev.mjs");
	if (!(await pathExists(sourcePath))) return;

	const targetPath = path.join(root, "tooling", "dev.mjs");
	const content = await fs.readFile(sourcePath, "utf8");

	if (await pathExists(targetPath)) {
		const existing = await fs.readFile(targetPath, "utf8");
		if (existing === content) return;
		if (!isLegacyDevTooling(existing)) {
			console.log("skip  tooling/dev.mjs appears custom");
			return;
		}
	}

	await stageWrite(writes, targetPath, content, root, yes);
}

function isLegacyDevTooling(source) {
	return (
		source.includes('process.argv.includes("--protected")') &&
		source.includes('const args = ["theme", "dev", "--store", store];')
	);
}

async function stageWrite(writes, targetPath, content, root, yes) {
	const relativePath = path
		.relative(root, targetPath)
		.replaceAll(path.sep, "/");
	if (await pathExists(targetPath)) {
		const existing = await fs.readFile(targetPath, "utf8");
		if (existing === content) {
			console.log(`same  ${relativePath}`);
			return;
		}
		if (!yes)
			throw new Error(
				`Refusing to overwrite ${relativePath}. Re-run with --yes to overwrite.`,
			);
		writes.push({ targetPath, content, label: `write ${relativePath}` });
		return;
	}
	writes.push({ targetPath, content, label: `add   ${relativePath}` });
}

async function writeAll(writes, dryRun) {
	for (const write of writes) {
		console.log(write.label);
		if (dryRun) continue;
		await fs.mkdir(path.dirname(write.targetPath), { recursive: true });
		await fs.writeFile(write.targetPath, write.content);
	}
}

function lockEntry(component, registryVersion) {
	return {
		kind: component.kind,
		version: registryVersion,
		...(component.dependencies ? { dependencies: component.dependencies } : {}),
		...(component.js ? { js: component.js } : {}),
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

function buildLock(
	config,
	manifest,
	components,
	resolvedNames,
	existingLock,
	registryVersion,
) {
	const nextComponents = { ...(existingLock?.components ?? {}) };
	for (const name of resolvedNames)
		nextComponents[name] = lockEntry(components[name], registryVersion);
	return {
		version: manifest.version ?? 1,
		registry: config.registry,
		components: nextComponents,
	};
}

function parseYaml(source) {
	const root = {};
	const stack = [{ indent: -1, value: root }];
	const lines = source.replaceAll("\t", "  ").split(/\r?\n/);

	for (const rawLine of lines) {
		const withoutComment = stripYamlComment(rawLine);
		if (!withoutComment.trim()) continue;

		const indent = withoutComment.match(/^ */)[0].length;
		const text = withoutComment.trim();
		while (stack.at(-1).indent >= indent) stack.pop();
		const parent = stack.at(-1).value;

		if (text.startsWith("- ")) {
			if (!Array.isArray(parent))
				throw new Error(`Invalid YAML list item: ${rawLine}`);
			const itemText = text.slice(2).trim();
			if (itemText.includes(":")) {
				const item = {};
				parent.push(item);
				const [key, value] = splitYamlPair(itemText);
				item[unquoteYaml(key)] = parseYamlScalar(value);
				stack.push({ indent, value: item });
			} else {
				parent.push(parseYamlScalar(itemText));
			}
			continue;
		}

		const [key, rawValue] = splitYamlPair(text);
		const name = unquoteYaml(key);
		if (rawValue === "") {
			const next = nextYamlContainer(lines, rawLine);
			parent[name] = next;
			stack.push({ indent, value: next });
		} else {
			parent[name] = parseYamlScalar(rawValue);
		}
	}

	return root;
}

function nextYamlContainer(lines, currentLine) {
	const currentIndex = lines.indexOf(currentLine);
	const currentIndent = currentLine.match(/^ */)[0].length;
	for (const line of lines.slice(currentIndex + 1)) {
		const stripped = stripYamlComment(line);
		if (!stripped.trim()) continue;
		const indent = stripped.match(/^ */)[0].length;
		if (indent <= currentIndent) return {};
		return stripped.trim().startsWith("- ") ? [] : {};
	}
	return {};
}

function stripYamlComment(line) {
	let quote = null;
	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		if ((char === '"' || char === "'") && line[index - 1] !== "\\") {
			quote = quote === char ? null : (quote ?? char);
		}
		if (char === "#" && !quote && (index === 0 || /\s/.test(line[index - 1]))) {
			return line.slice(0, index);
		}
	}
	return line;
}

function splitYamlPair(text) {
	let quote = null;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if ((char === '"' || char === "'") && text[index - 1] !== "\\") {
			quote = quote === char ? null : (quote ?? char);
		}
		if (char === ":" && !quote)
			return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
	}
	throw new Error(`Invalid YAML mapping: ${text}`);
}

function parseYamlScalar(value) {
	if (value === "") return "";
	if (value === "true") return true;
	if (value === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
	return unquoteYaml(value);
}

function unquoteYaml(value) {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function stringifyYaml(value, indent = 0) {
	const lines = [];
	for (const [key, child] of Object.entries(value)) {
		lines.push(...stringifyYamlEntry(key, child, indent));
	}
	return `${lines.join("\n")}\n`;
}

function stringifyYamlEntry(key, value, indent) {
	const pad = " ".repeat(indent);
	if (Array.isArray(value)) {
		const lines = [`${pad}${key}:`];
		for (const item of value) {
			if (isPlainObject(item)) {
				const entries = Object.entries(item);
				const [firstKey, firstValue] = entries[0];
				lines.push(`${pad}  - ${firstKey}: ${formatYamlScalar(firstValue)}`);
				for (const [itemKey, itemValue] of entries.slice(1)) {
					lines.push(...stringifyYamlEntry(itemKey, itemValue, indent + 4));
				}
			} else {
				lines.push(`${pad}  - ${formatYamlScalar(item)}`);
			}
		}
		return lines;
	}
	if (isPlainObject(value))
		return [
			`${pad}${key}:`,
			...Object.entries(value).flatMap(([childKey, childValue]) =>
				stringifyYamlEntry(childKey, childValue, indent + 2),
			),
		];
	return [`${pad}${key}: ${formatYamlScalar(value)}`];
}

function isPlainObject(value) {
	return value && typeof value === "object" && !Array.isArray(value);
}

function formatYamlScalar(value) {
	return String(value);
}

async function readJson(filePath) {
	return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function patchPackageName(targetDir, projectName) {
	const pkgPath = path.join(targetDir, "package.json");
	const pkg = await readJson(pkgPath);
	pkg.name = toPackageName(projectName);
	await fs.writeFile(pkgPath, `${JSON.stringify(pkg, null, "\t")}\n`);
}

function toPackageName(name) {
	return (
		name
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "nazare-theme"
	);
}

async function copyDir(source, target) {
	const entries = await fs.readdir(source, { withFileTypes: true });

	await fs.mkdir(target, { recursive: true });

	for (const entry of entries) {
		const sourcePath = path.join(source, entry.name);
		const targetPath = path.join(target, entry.name);

		if (entry.isDirectory()) {
			await copyDir(sourcePath, targetPath);
			continue;
		}

		if (entry.isSymbolicLink()) {
			const link = await fs.readlink(sourcePath);
			await fs.symlink(link, targetPath);
			continue;
		}

		if (entry.isFile()) {
			await fs.copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
		}
	}
}

async function maybeGitInit(targetDir) {
	if (!(await commandExists("git"))) return;
	await run("git", ["init"], { cwd: targetDir, stdio: "ignore" });
}

async function commandExists(command) {
	try {
		await run(command, ["--version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

async function pathExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function prompt(label, initial) {
	return new Promise((resolve) => {
		process.stdout.write(`${label} (${initial}): `);
		process.stdin.setEncoding("utf8");
		process.stdin.once("data", (value) => {
			resolve(value.trim() || initial);
		});
	});
}

function run(command, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, options);
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else
				reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
		});
	});
}
