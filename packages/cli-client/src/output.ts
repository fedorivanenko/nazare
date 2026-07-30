export type Output = {
	log: (...values: unknown[]) => void;
	error: (...values: unknown[]) => void;
};

/**
 * Default sink for the CLI. `console.log` formats every argument before
 * writing, and that scan costs real time on the multi-megabyte JSON that
 * `inspect theme` emits, so single strings go straight to the stream.
 */
export const processOutput: Output = {
	log: (...values: unknown[]) => write(process.stdout, values),
	error: (...values: unknown[]) => write(process.stderr, values),
};

function write(stream: NodeJS.WriteStream, values: unknown[]): void {
	if (values.length === 1 && typeof values[0] === "string") {
		stream.write(`${values[0]}\n`);
		return;
	}
	if (stream === process.stderr) console.error(...values);
	else console.log(...values);
}
