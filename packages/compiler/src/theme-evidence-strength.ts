/**
 * Strength of evidence behind an inferred capability or classification.
 *
 * - `direct`: syntax names the behavior or platform endpoint explicitly.
 * - `strong`: syntax is distinctive, but another behavior can share it.
 * - `suggestive`: broad context supports the inference but cannot identify it.
 */
export type ThemeEvidenceStrength = "direct" | "strong" | "suggestive";

export function strongerThemeEvidence(
	left: ThemeEvidenceStrength,
	right: ThemeEvidenceStrength,
): ThemeEvidenceStrength {
	if (left === "direct" || right === "direct") return "direct";
	if (left === "strong" || right === "strong") return "strong";
	return "suggestive";
}
