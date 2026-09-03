export type SemanticRecordId = string;
export type SemanticEntityId = SemanticRecordId;
export type SemanticOccurrenceId = SemanticRecordId;
export type SemanticRelationId = SemanticRecordId;
export type SemanticValueId = SemanticRecordId;
export type SemanticPredicateId = SemanticRecordId;
export type SemanticBoundaryId = SemanticRecordId;

export type SemanticAttributes = Readonly<Record<string, JsonValue>>;

export type JsonScalar = null | boolean | number | string;
export type JsonValue =
	| JsonScalar
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue };
