import Liquid from "@nazare/tree-sitter-liquid";
import NazareLiquid from "@nazare/tree-sitter-nazare-liquid";
import Parser from "tree-sitter";
import type { SourceLanguage } from "./types.js";

export class UnsupportedSourceLanguageError extends Error {
	constructor(readonly language: string) {
		super(`Unsupported source language: ${language}`);
		this.name = "UnsupportedSourceLanguageError";
	}
}

export class MissingSourceGrammarError extends Error {
	constructor(readonly language: SourceLanguage) {
		super(`No Tree-sitter grammar registered for ${language}`);
		this.name = "MissingSourceGrammarError";
	}
}

export class SourceParserRegistry {
	private readonly languages = new Map<SourceLanguage, unknown>();

	register(language: SourceLanguage, grammar: unknown): void {
		if (!grammar) throw new MissingSourceGrammarError(language);
		this.languages.set(language, grammar);
	}

	createParser(language: SourceLanguage): Parser {
		if (language !== "liquid" && language !== "nazare-liquid") {
			throw new UnsupportedSourceLanguageError(language);
		}
		const grammar = this.languages.get(language);
		if (!grammar) throw new MissingSourceGrammarError(language);
		const parser = new Parser();
		parser.setLanguage(grammar);
		return parser;
	}
}

/** Explicit built-in registration; no extension callbacks or fallback IDs. */
export function createDefaultSourceParserRegistry(): SourceParserRegistry {
	const registry = new SourceParserRegistry();
	registry.register("liquid", Liquid);
	registry.register("nazare-liquid", NazareLiquid);
	return registry;
}
