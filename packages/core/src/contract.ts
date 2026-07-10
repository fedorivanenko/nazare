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

export type ArtifactContract = {
	packageId: string;
	componentSymbolId: Id;
	props: ArtifactContractProp[];
};
