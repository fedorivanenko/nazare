import { extname } from "node:path";

const CLONED_DIRECTORIES = new Set(["blocks", "sections", "snippets"]);

export function scaleCorpus(files, scaleFactor) {
	if (!Number.isSafeInteger(scaleFactor) || scaleFactor < 1) {
		throw new Error(`Scale factor must be a positive integer: ${scaleFactor}`);
	}
	const result = files.map((file) => ({ ...file }));
	const paths = new Set(result.map(({ path }) => path));
	if (paths.size !== result.length) {
		throw new Error("Cannot scale a corpus containing duplicate paths");
	}
	const cloneCandidates = files.filter(({ path }) =>
		CLONED_DIRECTORIES.has(path.split("/", 1)[0]),
	);
	for (let copy = 1; copy < scaleFactor; copy += 1) {
		for (const file of cloneCandidates) {
			const path = clonedPath(file.path, copy);
			if (paths.has(path)) {
				throw new Error(`Scaled corpus path collision: ${path}`);
			}
			paths.add(path);
			result.push({ ...file, path });
		}
	}
	return result.sort((left, right) => compareAscii(left.path, right.path));
}

function clonedPath(path, copy) {
	const extension = path.endsWith(".nz.liquid") ? ".nz.liquid" : extname(path);
	const stem = path.slice(0, -extension.length);
	return `${stem}-benchmark-copy-${copy}${extension}`;
}

function compareAscii(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}
