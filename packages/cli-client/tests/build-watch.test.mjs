import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runThemeBuildWatch } from "../dist/build-command.js";

test("build watch reuses one filesystem session and streams revisions", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-build-watch-"));
	const source = join(root, "theme");
	await mkdir(join(source, "snippets"), { recursive: true });
	const component = join(source, "snippets/card.liquid");
	await writeFile(component, "<span>One</span>");
	const controller = new AbortController();
	const logs = [];
	const errors = [];
	let revisions = 0;
	let execution;
	const completed = new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			controller.abort("test timeout");
			reject(
				new Error(
					`Timed out waiting for watched build revision: ${JSON.stringify({ errors, logs })}`,
				),
			);
		}, 30_000);
		const output = {
			log(value) {
				logs.push(String(value));
				if (!String(value).startsWith("result revision")) return;
				revisions += 1;
				if (revisions === 1) {
					setTimeout(() => {
						void writeFile(component, "<span>Two</span>");
					}, 150);
				} else {
					clearTimeout(timeout);
					controller.abort("test complete");
					resolve();
				}
			},
			error(value) {
				errors.push(String(value));
			},
		};
		execution = runThemeBuildWatch(
			root,
			"theme",
			{ outDir: "output", positionals: [] },
			output,
			{ signal: controller.signal },
		);
		void execution.catch(reject);
	});

	await completed;
	await execution;
	assert.equal(revisions, 2);
	assert.deepEqual(errors, []);
	assert.equal(
		logs.some((line) => /^result revision [2-9]\d*\b/.test(line)),
		true,
	);
});
