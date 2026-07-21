import {
	type BundledLanguage,
	type BundledTheme,
	createHighlighter,
} from "shiki";

export type CodeLanguage = BundledLanguage | "nz.liquid" | "nz-liquid";

const lightTheme = "github-light" satisfies BundledTheme;
const darkTheme = "github-dark" satisfies BundledTheme;

const loadedLanguages = [
	"bash",
	"css",
	"diff",
	"javascript",
	"json",
	"liquid",
	"typescript",
] satisfies BundledLanguage[];

const loadedLanguageSet = new Set<string>(loadedLanguages);

const languageAliases: Partial<Record<CodeLanguage, BundledLanguage>> = {
	"nz-liquid": "liquid",
	"nz.liquid": "liquid",
};

const highlighterPromise = createHighlighter({
	themes: [lightTheme, darkTheme],
	langs: loadedLanguages,
});

export async function highlightCode(
	code: string,
	language: CodeLanguage | string = "text",
) {
	const highlighter = await highlighterPromise;
	const lang = resolveLanguage(language);

	return highlighter.codeToHtml(code, {
		lang,
		defaultColor: false,
		themes: {
			light: lightTheme,
			dark: darkTheme,
		},
	});
}

function resolveLanguage(
	language: CodeLanguage | string,
): BundledLanguage | "text" {
	if (language in languageAliases) {
		return languageAliases[language as CodeLanguage] ?? "text";
	}

	if (loadedLanguageSet.has(language)) {
		return language as BundledLanguage;
	}

	return "text";
}
