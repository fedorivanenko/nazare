import type { SourceSpan } from "@nazare/core";

export type SourceAnalysisUncertainty = {
	code: string;
	message: string;
	span?: SourceSpan;
};

export type JavaScriptSourceOwner = {
	kind: "function" | "method" | "anonymousFunction" | "module";
	name?: string;
	exports: Array<"named" | "default">;
	id: string;
	span?: SourceSpan;
};

export type AnalyzedSourceFact = {
	kind: string;
	targetName?: string;
	fromPath?: string;
	subjectKind?: string;
	hookKind?: string;
	operation?: string;
	name?: string;
	span?: SourceSpan;
	extractor?: string;
	static?: boolean;
	javaScriptOwner?: JavaScriptSourceOwner;
	transport?: NetworkTransport;
	endpoint?: string;
	method?: string;
	graphql?: GraphqlRequestKind;
	graphqlQuery?: string;
};

export type NetworkTransport =
	| "fetch"
	| "xmlHttpRequest"
	| "sendBeacon"
	| "graphqlClient";

export type GraphqlRequestKind = "none" | "static" | "dynamic" | "invalid";
