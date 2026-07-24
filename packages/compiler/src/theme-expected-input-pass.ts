import type { Diagnostic, SourceSpan } from "@nazare/core";
import type {
	ThemeDataAccessRecord,
	ThemeDeclaration,
	ThemeExpectedInputRecord,
	ThemeFact,
	ThemeRenderArgumentRecord,
	ThemeVariableReadRecord,
} from "./theme-facts.js";
import { CONTEXT_INPUT_OBJECTS } from "./theme-input-policy.js";

export function expectedInputId(path: string, name: string): string {
	return `expected-input:${path}:${name}`;
}

export function docParamEvidenceId(path: string, name: string): string {
	return `doc-param:${path}:${name}`;
}

function fileSpan(path: string): SourceSpan {
	const position = { line: 1, column: 1 };
	return { file: path, start: position, end: position };
}

export function deriveThemeExpectedInputs(
	declarations: ThemeDeclaration[],
	dataAccesses: ThemeDataAccessRecord[],
	variableReads: ThemeVariableReadRecord[],
	guardedObjects: Set<string>,
	defaultedObjects: Set<string>,
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[],
	renderArguments: ThemeRenderArgumentRecord[],
): ThemeExpectedInputRecord[] {
	const declaredByPathAndName = new Map(
		docParams.map((param) => [`${param.path}:${param.name}`, param]),
	);
	const snippetPathsByName = new Map(
		declarations
			.filter((declaration) => declaration.kind === "snippet")
			.map((declaration) => [declaration.name, declaration.path]),
	);
	const componentPaths = new Set(
		declarations
			.filter(
				(declaration) =>
					declaration.kind === "snippet" || declaration.kind === "component",
			)
			.map((declaration) => declaration.path),
	);
	const byId = new Map<string, ThemeExpectedInputRecord>();
	const directlyReadInputs = new Set(
		variableReads
			.filter((read) => read.usage !== "renderArgument")
			.map((read) => `${read.fromPath}:${read.name}`),
	);
	// A name that callers pass by name is a parameter of the target, whatever it
	// looks like from inside the body. Shopify's ambient objects are the case
	// that matters: a snippet reading `product.title` could be relying on page
	// context, but once a caller writes `product: featured`, the source has said
	// which it is. This is evidence, not preference — the argument is only
	// attributed when the render target resolves statically.
	const callerSuppliedInputs = new Set(
		renderArguments.flatMap((argument) => {
			const target = argument.targetName
				? snippetPathsByName.get(argument.targetName)
				: undefined;
			return target ? [`${target}:${argument.argumentName}`] : [];
		}),
	);
	// Only unconditional reads show the file needs the value on every render.
	const readsDataDirectly = new Set(
		dataAccesses
			.filter((access) => !access.conditional)
			.map((access) => `${access.fromPath}:${access.object}`),
	);
	/**
	 * Whether the file handles the input being absent. Guards and defaults both
	 * count: treating a guard as merely "unknown" instead was measured against
	 * the declared contracts and agreement fell from 68% to 40%, because authors
	 * overwhelmingly guard the inputs they consider optional.
	 */
	const absenceHandled = (key: string): boolean =>
		defaultedObjects.has(key) || guardedObjects.has(key);
	const inferredRequirement = (
		path: string,
		name: string,
		origin: ThemeExpectedInputRecord["origin"],
	): ThemeExpectedInputRecord["requirement"] => {
		const key = `${path}:${name}`;
		if (origin === "ambientShopifyContext") {
			// Without caller evidence an ambient read stays unknown: page context
			// and an omitted argument are indistinguishable from inside the file.
			if (!callerSuppliedInputs.has(key)) return "unknown";
			// A guard around an ambient object may be protecting against absent
			// page context rather than an omitted argument, so caller evidence
			// raises it only as far as "unknown" — never to a claim that the
			// caller may safely omit it. Measured: calling these optional buys
			// one more agreement and costs two more inputs wrongly described as
			// safe to omit, which is the direction that misleads a caller.
			if (absenceHandled(key)) return "unknown";
			return readsDataDirectly.has(key) ? "required" : "unknown";
		}
		if (absenceHandled(key)) return "optional";
		return directlyReadInputs.has(key) ? "required" : "unknown";
	};
	const addInput = (
		path: string,
		name: string,
		propertyPath: string | undefined,
		evidenceId: string,
		origin: ThemeExpectedInputRecord["origin"],
	): void => {
		const id = expectedInputId(path, name);
		const existing = byId.get(id);
		if (existing) {
			existing.propertyPaths = [
				...new Set([
					...existing.propertyPaths,
					...(propertyPath ? [propertyPath] : []),
				]),
			].sort((a, b) => a.localeCompare(b));
			existing.evidenceIds = [
				...new Set([...existing.evidenceIds, evidenceId]),
			];
			// A free-variable read is stronger evidence than ambient context.
			if (origin === "freeVariable" && existing.origin !== "docParam") {
				existing.origin = origin;
				existing.inferredRequirement = inferredRequirement(path, name, origin);
				if (existing.provenance === "inferred") {
					existing.requirement = existing.inferredRequirement;
					existing.required = existing.requirement === "required";
				}
			}
			return;
		}
		byId.set(
			id,
			reconciledInput(path, name, origin, [evidenceId], propertyPath),
		);
	};
	/**
	 * Effective requirement is the author's when they declared one, and the
	 * inferred requirement otherwise. Both are kept: the declaration is the
	 * answer, the inference is what makes disagreement visible.
	 */
	const reconciledInput = (
		path: string,
		name: string,
		origin: ThemeExpectedInputRecord["origin"],
		evidenceIds: string[],
		propertyPath?: string,
	): ThemeExpectedInputRecord => {
		const declared = declaredByPathAndName.get(`${path}:${name}`);
		const inferred = inferredRequirement(path, name, origin);
		const requirement = declared
			? declared.required
				? "required"
				: "optional"
			: inferred;
		return {
			id: expectedInputId(path, name),
			path,
			name,
			required: requirement === "required",
			requirement,
			provenance: declared ? "declared" : "inferred",
			inferredRequirement: inferred,
			origin,
			declaredType: declared?.paramType,
			propertyPaths: propertyPath ? [propertyPath] : [],
			evidenceIds: declared
				? [...evidenceIds, docParamEvidenceId(path, name)]
				: evidenceIds,
		};
	};
	for (const access of dataAccesses) {
		if (!componentPaths.has(access.fromPath)) continue;
		if (!CONTEXT_INPUT_OBJECTS.has(access.object)) continue;
		addInput(
			access.fromPath,
			access.object,
			access.propertyPath,
			access.id,
			"ambientShopifyContext",
		);
	}
	for (const read of variableReads) {
		if (!componentPaths.has(read.fromPath)) continue;
		addInput(
			read.fromPath,
			read.name,
			read.propertyPath,
			read.id,
			"freeVariable",
		);
	}
	// A declared parameter is part of the interface whether or not the body
	// happens to read it, so declarations seed inputs that no read produced.
	for (const param of docParams) {
		if (!componentPaths.has(param.path)) continue;
		const id = expectedInputId(param.path, param.name);
		if (byId.has(id)) continue;
		byId.set(id, reconciledInput(param.path, param.name, "docParam", []));
	}
	return [...byId.values()];
}

/**
 * Where a `{% doc %}` block and the source it documents disagree. A stale
 * declaration outranks correct inference, so these are what keep a contract
 * honest once declarations win.
 *
 * All of these are informational. None of them is a runtime defect: Liquid
 * renders an absent variable as empty rather than raising, so an unguarded
 * read of an optional parameter is how an optional class hook is *supposed*
 * to be written (`class='{{ item_class }}'`). These report a disagreement
 * between two descriptions of one interface, which is worth a human's
 * attention and is not worth a warning.
 *
 * Not reported: a declared-required input that inference calls optional or
 * unknown. Inference is deliberately conservative, so its silence is expected
 * and flagging it would blame the author for the compiler's caution. That
 * disagreement is still recorded on the input for the agreement harness.
 */
export function themeDocContractIssues(
	expectedInputs: ThemeExpectedInputRecord[],
	docParams: Extract<ThemeFact, { kind: "declaresDocParam" }>[],
	defaultedObjects: Set<string>,
): Diagnostic[] {
	if (docParams.length === 0) return [];
	const issues: Diagnostic[] = [];
	const documentedPaths = new Set(docParams.map((param) => param.path));
	const declaredByPathAndName = new Map(
		docParams.map((param) => [`${param.path}:${param.name}`, param]),
	);
	const defaultedNames = new Set(
		docParams
			.filter((param) => defaultedObjects.has(`${param.path}:${param.name}`))
			.map((param) => `${param.path}:${param.name}`),
	);
	for (const input of expectedInputs) {
		const declared = declaredByPathAndName.get(`${input.path}:${input.name}`);
		if (declared?.required && input.inferredRequirement === "optional") {
			const key = `${input.path}:${input.name}`;
			const how = defaultedNames.has(key)
				? "a fallback value is supplied when it is absent"
				: "every read of it is guarded";
			issues.push({
				severity: "info",
				code: "THEME_DOC_PARAM_FALLBACK",
				message: `@param ${input.name} is declared required, but ${how}; either the contract is stricter than the code or the fallback is unreachable`,
				phase: "resolve",
				span: declared.span,
			});
			continue;
		}
		if (declared && !declared.required) {
			if (input.inferredRequirement === "required") {
				issues.push({
					severity: "info",
					code: "THEME_DOC_PARAM_UNGUARDED",
					message: `@param ${input.name} is declared optional, but no read of it is guarded or defaulted; source evidence alone would call it required`,
					phase: "resolve",
					span: declared.span,
				});
			}
			continue;
		}
		if (!declared && documentedPaths.has(input.path)) {
			issues.push({
				severity: "info",
				code: "THEME_DOC_PARAM_UNDECLARED",
				message: `${input.path} uses ${input.name} as an input but its {% doc %} block does not declare it`,
				phase: "resolve",
				span: fileSpan(input.path),
			});
		}
	}
	return issues;
}
