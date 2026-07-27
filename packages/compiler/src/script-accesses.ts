import type { SourceSpan } from "@nazare/core";
import { scanScript } from "./script-scan.js";
import { spanFromOffsets } from "./source.js";

export function scanRefAccesses(
	source: string,
	file: string,
): { name: string; span: SourceSpan }[] {
	return scanScript(source).refAccesses.map((access) => ({
		name: access.name,
		span: spanFromOffsets(source, file, {
			start: access.start,
			end: access.end,
		}),
	}));
}

export function scanDataAccesses(
	source: string,
	file: string,
): { ref: string; property: string; span: SourceSpan }[] {
	return scanScript(source).dataAccesses.map((access) => ({
		ref: access.ref,
		property: access.property,
		span: spanFromOffsets(source, file, {
			start: access.start,
			end: access.end,
		}),
	}));
}
