import { SemanticQueryIndex } from "../query/semantic-query.js";
import type { SemanticGraphSnapshot } from "./semantic-graph-snapshot.js";
import {
	buildSemanticIndex,
	type SemanticIndexSnapshot,
} from "./semantic-index.js";

export type QueryableSemanticOutput = {
	snapshot: SemanticGraphSnapshot;
	index: SemanticIndexSnapshot;
};

export function createQueryableSemanticOutput(
	snapshot: SemanticGraphSnapshot,
): QueryableSemanticOutput {
	return { snapshot, index: buildSemanticIndex(snapshot) };
}

export function openQueryableSemanticOutput(
	output: QueryableSemanticOutput,
): SemanticQueryIndex {
	return new SemanticQueryIndex(output.snapshot, output.index);
}
