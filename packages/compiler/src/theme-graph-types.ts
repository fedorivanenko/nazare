import type { ThemeFileKind } from "./theme-file-classifier.js";

export type SemanticThemeGraphNode =
	| { id: string; kind: "file"; path: string; fileKind: ThemeFileKind }
	| { id: string; kind: "section"; name: string; path: string }
	| { id: string; kind: "snippet"; name: string; path: string }
	| { id: string; kind: "template"; name: string; path: string }
	| { id: string; kind: "page"; name: string; path: string; pageType: string }
	| { id: string; kind: "layout"; name: string; path: string }
	| { id: string; kind: "locale"; name: string; path: string }
	| { id: string; kind: "localeKey"; key: string; translationPaths: string[] }
	| { id: string; kind: "asset"; name: string; path: string }
	| { id: string; kind: "sectionGroup"; name: string; path: string }
	| { id: string; kind: "themeBlock"; name: string; path: string }
	| {
			id: string;
			kind: "sectionInstance";
			templatePath: string;
			instanceId: string;
			sectionType?: string;
	  }
	| {
			id: string;
			kind: "blockInstance";
			ownerPath: string;
			sectionInstanceId: string;
			instanceId: string;
			blockType?: string;
			parentInstanceId?: string;
	  }
	| {
			id: string;
			kind: "renderSite";
			fromPath: string;
			targetName?: string;
			invocationKind: "render" | "include";
	  }
	| {
			id: string;
			kind: "component";
			name: string;
			path: string;
			componentKind?: string;
	  }
	| { id: string; kind: "schema"; path: string; schemaPath: string }
	| {
			id: string;
			kind: "block";
			path: string;
			blockType: string;
			name?: string;
	  }
	| {
			id: string;
			kind: "blockSetting";
			path: string;
			blockType: string;
			settingId: string;
			settingType?: string;
	  }
	| {
			id: string;
			kind: "setting";
			path: string;
			schemaPath: string;
			settingId: string;
			settingType?: string;
	  }
	| { id: string; kind: "shopifyObject"; object: string }
	| {
			id: string;
			kind: "shopifyProperty";
			object: string;
			propertyPath: string;
	  }
	| {
			id: string;
			kind: "metafieldDefinition";
			owner: string;
			namespace: string;
			key: string;
			type?: string;
	  }
	| {
			id: string;
			kind: "metafieldRead";
			fromPath: string;
			owner: string;
			namespace: string;
			key: string;
	  }
	| {
			id: string;
			kind: "storeSchema";
			path: string;
			state: "unknown" | "present" | "invalid";
			pulledAt?: string;
	  }
	| {
			id: string;
			kind: "renderArgument";
			argumentName: string;
			valueExpression: string;
			fromPath: string;
			targetName: string;
	  }
	| {
			id: string;
			kind: "expectedInput";
			path: string;
			name: string;
			required: boolean;
			requirement: "required" | "optional" | "unknown";
			provenance: "declared" | "inferred";
			inferredRequirement: "required" | "optional" | "unknown";
			declaredType?: string;
			origin: "freeVariable" | "ambientShopifyContext" | "docParam";
			propertyPaths: string[];
			evidenceIds: string[];
	  }
	| {
			id: string;
			kind: "capability";
			capability: string;
			confidence: number;
			evidenceIds: string[];
	  }
	| {
			id: string;
			kind: "classification";
			label: string;
			confidence: number;
			evidenceIds: string[];
			uncertainty: string[];
	  }
	| {
			id: string;
			kind: "unresolved";
			targetKind:
				| "snippet"
				| "section"
				| "sectionGroup"
				| "layout"
				| "themeBlock"
				| "asset"
				| "component"
				| "setting"
				| "localeKey"
				| "metafield";
			name?: string;
	  };

export type SemanticThemeGraphEdge = (
	| { id: string; kind: "declares"; from: string; to: string }
	| { id: string; kind: "implementedBy"; from: string; to: string }
	| { id: string; kind: "invokes"; from: string; to: string }
	| { id: string; kind: "resolvesRenderTarget"; from: string; to: string }
	| { id: string; kind: "hasArgument"; from: string; to: string }
	| { id: string; kind: "satisfiesInput"; from: string; to: string }
	| {
			id: string;
			kind: "renders";
			from: string;
			to: string;
			targetName?: string;
	  }
	| { id: string; kind: "imports"; from: string; to: string; specifier: string }
	| {
			id: string;
			kind: "referencesAsset";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "containsSectionGroup";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "usesLayout";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "referencesLocaleKey";
			from: string;
			to: string;
			key?: string;
	  }
	| { id: string; kind: "definesSchema"; from: string; to: string }
	| { id: string; kind: "definesSetting"; from: string; to: string }
	| { id: string; kind: "definesBlock"; from: string; to: string }
	| { id: string; kind: "definesBlockSetting"; from: string; to: string }
	| { id: string; kind: "pageUsesTemplate"; from: string; to: string }
	| {
			id: string;
			kind: "pageContainsSectionInstance";
			from: string;
			to: string;
	  }
	| {
			id: string;
			kind: "sectionInstanceContainsBlockInstance";
			from: string;
			to: string;
	  }
	| {
			id: string;
			kind: "blockInstanceContainsBlockInstance";
			from: string;
			to: string;
	  }
	| { id: string; kind: "instanceOfBlock"; from: string; to: string }
	| { id: string; kind: "readsSetting"; from: string; to: string }
	| { id: string; kind: "argumentReadsSetting"; from: string; to: string }
	| {
			id: string;
			kind: "accessesData";
			from: string;
			to: string;
			expression: string;
	  }
	| {
			id: string;
			kind: "passesArgument";
			from: string;
			to: string;
			argumentName: string;
			valueExpression: string;
	  }
	| {
			id: string;
			kind: "readsMetafield";
			from: string;
			to: string;
			namespace: string;
			key: string;
	  }
	| {
			id: string;
			kind: "resolvesMetafieldDefinition";
			from: string;
			to: string;
	  }
	| { id: string; kind: "missingMetafieldDefinition"; from: string; to: string }
	| { id: string; kind: "schemaFor"; from: string; to: string }
	| { id: string; kind: "hasCapability"; from: string; to: string }
	| { id: string; kind: "classifiedAs"; from: string; to: string }
	| { id: string; kind: "expectsInput"; from: string; to: string }
	| {
			id: string;
			kind: "templateContainsSection";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "templateContainsSectionInstance";
			from: string;
			to: string;
	  }
	| {
			id: string;
			kind: "instanceOf";
			from: string;
			to: string;
			targetName?: string;
	  }
) & { evidenceIds?: string[] };
