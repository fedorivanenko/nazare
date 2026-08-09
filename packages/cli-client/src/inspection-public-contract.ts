export const INSPECTION_PUBLIC_CONTRACT_VERSION = 2 as const;

export const ENTITY_KINDS = [
	"project",
	"file",
	"declaration",
	"occurrence",
	"data",
	"behavior",
	"diagnostic",
] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const RELATION_KINDS = [
	"contains",
	"declares",
	"references",
	"renders",
	"defines",
	"reads",
	"writes",
	"selects",
	"produces",
	"consumes",
	"diagnosedBy",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_CATEGORIES = [
	"ownership",
	"dependency",
	"dataFlow",
	"behavior",
	"diagnostic",
] as const;
export type RelationCategory = (typeof RELATION_CATEGORIES)[number];

export type PublicEntity = {
	id: string;
	kind: EntityKind;
	name: string;
	identity: Readonly<Record<string, string>>;
	path?: string;
	subtype?: string;
	roles?: readonly string[];
	attributes?: Readonly<Record<string, unknown>>;
};

export type PublicRelation = {
	id: string;
	kind: RelationKind;
	category: RelationCategory;
	from: string;
	to: string;
	derivation: "direct" | "computed";
	certainty: "proven" | "inferred";
	evidenceIds?: readonly string[];
	attributes?: Readonly<Record<string, unknown>>;
};

export type PublicFinding = {
	code: string;
	message: string;
	path?: string;
	evidenceIds?: readonly string[];
};

export type PublicCompleteness = {
	status: "complete" | "partial";
	uncertainty?: readonly PublicFinding[];
};

export type PublicEvidence = {
	id: string;
	path: string;
	kind: string;
	strength: "explicit" | "inferred";
	attributes: unknown;
};

export type InspectionPublicGraph = {
	contractVersion: typeof INSPECTION_PUBLIC_CONTRACT_VERSION;
	revision: number;
	entities: readonly PublicEntity[];
	relations: readonly PublicRelation[];
	evidence: readonly PublicEvidence[];
	completeness: PublicCompleteness;
};

export type Page = {
	total: number;
	returned: number;
	nextCursor?: string;
};

export type FindResult = {
	contractVersion: typeof INSPECTION_PUBLIC_CONTRACT_VERSION;
	revision: number;
	result: { entities: readonly PublicEntity[] };
	completeness: PublicCompleteness;
	page: Page;
};

export type TraverseResult = {
	contractVersion: typeof INSPECTION_PUBLIC_CONTRACT_VERSION;
	revision: number;
	result: {
		entities: readonly PublicEntity[];
		relations: readonly PublicRelation[];
		matches: readonly string[];
		evidence?: readonly PublicEvidence[];
	};
	completeness: PublicCompleteness;
	page: Page;
};

export type EvidenceResult = {
	contractVersion: typeof INSPECTION_PUBLIC_CONTRACT_VERSION;
	revision: number;
	result: { evidence: readonly PublicEvidence[] };
	completeness: PublicCompleteness;
};
