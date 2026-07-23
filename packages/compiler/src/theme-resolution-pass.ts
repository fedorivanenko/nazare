import type { Diagnostic } from "@nazare/core";
import type { ThemeDeclaration, ThemeReference } from "./theme-facts.js";

export type ThemeResolutionPassResult = {
	references: ThemeReference[];
	declarationByKey: Map<string, ThemeDeclaration>;
	declarationIdsByKey: Map<string, string[]>;
	issues: Diagnostic[];
};

export function resolveThemeDeclarationsAndReferences(
	declarations: ThemeDeclaration[],
	references: ThemeReference[],
): ThemeResolutionPassResult {
	const declarationsByKey = indexDeclarations(declarations);
	const declarationByKey = new Map<string, ThemeDeclaration>();
	const declarationIdsByKey = new Map<string, string[]>();
	for (const [key, candidates] of declarationsByKey) {
		const unique = deduplicateDeclarations(candidates);
		declarationIdsByKey.set(
			key,
			unique.map((declaration) => declaration.id).sort(),
		);
		if (unique.length === 1 && unique[0]) {
			declarationByKey.set(key, unique[0]);
		}
	}

	const issues = duplicateDeclarationIssues(declarations);
	const resolvedReferences = references.map((reference) => {
		const candidates = referenceCandidates(reference, declarationsByKey);
		const declaration = candidates.length === 1 ? candidates[0] : undefined;
		if (!reference.static || declaration) {
			return withResolvedDeclaration(reference, declaration?.id);
		}
		if (candidates.length > 1) {
			issues.push({
				severity: "warning",
				code: "THEME_AMBIGUOUS_REFERENCE",
				message: `Ambiguous ${reference.targetKind} reference${reference.targetName ? ` ${reference.targetName}` : ""} from ${reference.fromPath}`,
				phase: "resolve",
				span: reference.span,
			});
		} else {
			issues.push({
				severity: "warning",
				code: "THEME_UNRESOLVED_REFERENCE",
				message: `Unresolved ${reference.targetKind} reference${reference.targetName ? ` ${reference.targetName}` : ""} from ${reference.fromPath}`,
				phase: "resolve",
				span: reference.span,
			});
		}
		return withResolvedDeclaration(reference, undefined);
	});

	return {
		references: resolvedReferences,
		declarationByKey,
		declarationIdsByKey,
		issues,
	};
}

function indexDeclarations(
	declarations: ThemeDeclaration[],
): Map<string, ThemeDeclaration[]> {
	const index = new Map<string, ThemeDeclaration[]>();
	for (const declaration of declarations) {
		addDeclaration(
			index,
			`${declaration.kind}:${declaration.name}`,
			declaration,
		);
		if (declaration.kind === "component" || declaration.kind === "asset") {
			addDeclaration(
				index,
				`${declaration.kind}:${declaration.path}`,
				declaration,
			);
		}
	}
	return index;
}

function duplicateDeclarationIssues(
	declarations: ThemeDeclaration[],
): Diagnostic[] {
	const primary = new Map<string, ThemeDeclaration[]>();
	for (const declaration of declarations) {
		addDeclaration(
			primary,
			`${declaration.kind}:${declaration.name}`,
			declaration,
		);
	}
	const issues: Diagnostic[] = [];
	for (const [key, candidates] of primary) {
		const paths = [
			...new Set(candidates.map((candidate) => candidate.path)),
		].sort();
		if (paths.length <= 1) continue;
		issues.push({
			severity: "warning",
			code: "THEME_DUPLICATE_DECLARATION",
			message: `Duplicate theme declaration ${key} in ${paths.join(", ")}`,
			phase: "resolve",
		});
	}
	return issues;
}

function referenceCandidates(
	reference: ThemeReference,
	declarationsByKey: Map<string, ThemeDeclaration[]>,
): ThemeDeclaration[] {
	for (const key of referenceKeys(reference)) {
		const candidates = deduplicateDeclarations(
			declarationsByKey.get(key) ?? [],
		);
		if (candidates.length > 0) return candidates;
	}
	return [];
}

function referenceKeys(reference: ThemeReference): string[] {
	if (reference.targetPath) {
		return [`${reference.targetKind}:${reference.targetPath}`];
	}
	if (!reference.targetName) return [];
	if (reference.kind === "referencesAsset") {
		return [
			`asset:${reference.targetName}`,
			`asset:assets/${reference.targetName}`,
		];
	}
	return [`${reference.targetKind}:${reference.targetName}`];
}

function withResolvedDeclaration(
	reference: ThemeReference,
	resolvedDeclarationId: string | undefined,
): ThemeReference {
	if (reference.resolvedDeclarationId === resolvedDeclarationId)
		return reference;
	const next = { ...reference };
	if (resolvedDeclarationId) next.resolvedDeclarationId = resolvedDeclarationId;
	else delete next.resolvedDeclarationId;
	return next;
}

function addDeclaration(
	index: Map<string, ThemeDeclaration[]>,
	key: string,
	declaration: ThemeDeclaration,
): void {
	const candidates = index.get(key) ?? [];
	candidates.push(declaration);
	index.set(key, candidates);
}

function deduplicateDeclarations(
	declarations: ThemeDeclaration[],
): ThemeDeclaration[] {
	return [...new Map(declarations.map((item) => [item.id, item])).values()];
}
