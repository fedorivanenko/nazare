// The compiled public interface of a package: which props its component
// expects, with full type info. Contracts are what cross package
// boundaries — a consumer is checked against contracts, never against
// another package's source.
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
	/** Package the setting originally comes from (the declaring leaf). */
	sourcePackageId: string;
	/** The leaf prop's name. */
	sourcePropName: string;
	typeInfo: PropTypeInfo;
};

export type ArtifactContract = {
	packageId: string;
	componentSymbolId: Id;
	props: ArtifactContractProp[];
	hoisted?: ArtifactContractHoistedSetting[];
};
