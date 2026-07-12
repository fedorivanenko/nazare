// The compiled public interface of a component file: which props it
// expects, with full type info. Contracts are what cross component
// boundaries — a consumer is checked against the contract derived from an
// imported file, never against that file's markup. A contract is keyed by
// the project-relative path of the file it was derived from.
import type { Id } from "./id.js";
import type { PropTypeInfo } from "./semantic.js";

export type ArtifactContractProp = {
	name: string;
	symbolId: Id;
	required: boolean;
	hasDefault: boolean;
	typeExpression: string;
	typeInfo: PropTypeInfo;
};

/**
 * A setting the component exposes on behalf of a dependency: an unfilled
 * setting-prop somewhere below, surfaced here as an implicit render argument
 * so consumers can hoist it further (ultimately into a section schema).
 */
export type ArtifactContractHoistedSetting = {
	/** Render-argument name at this component's boundary, e.g. "button_label". */
	name: string;
	/** Project-relative path of the component file declaring the leaf prop. */
	sourcePath: string;
	/** The leaf prop's name. */
	sourcePropName: string;
	typeInfo: PropTypeInfo;
};

export type ArtifactContract = {
	/** Project-relative path of the component file this contract describes. */
	path: string;
	componentSymbolId: Id;
	props: ArtifactContractProp[];
	hoisted?: ArtifactContractHoistedSetting[];
};
