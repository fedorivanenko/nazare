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
