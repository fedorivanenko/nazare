#!/usr/bin/env node

const HELP = `Nazare CLI

Usage:
  nazare --help
  nazare init [name]

Commands:
  init [name]    Initialize Nazare relationship in a theme repo (not implemented yet)

Options:
  -h, --help     Show this help
`;

function main(argv) {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		process.stdout.write(HELP);
		return 0;
	}

	const [command] = argv;

	if (command === "init") {
		process.stderr.write(
			"nazare init is not implemented yet. Run `nazare --help` for available commands.\n",
		);
		return 1;
	}

	process.stderr.write(
		`Unknown command: ${command}\nRun \`nazare --help\` for usage.\n`,
	);
	return 1;
}

process.exitCode = main(process.argv.slice(2));
