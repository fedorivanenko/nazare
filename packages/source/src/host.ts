import { SourceFile } from "./document.js";
import type { SourceParserRegistry } from "./registry.js";
import type {
	SourceDocument,
	SourceEdit,
	SourceLanguage,
	SourceUpdate,
} from "./types.js";

export class SourceAnalysisHost {
	private readonly files = new Map<string, SourceFile>();

	constructor(private readonly registry: SourceParserRegistry) {}

	openFile(
		path: string,
		language: SourceLanguage,
		text: string,
	): SourceDocument {
		if (this.files.has(path))
			throw new Error(`Source file already open: ${path}`);
		const file = new SourceFile(this.registry, path, language, text);
		this.files.set(path, file);
		return file.document;
	}

	updateFile(path: string, edits: readonly SourceEdit[]): SourceUpdate {
		return this.requireFile(path).update(edits);
	}

	closeFile(path: string): void {
		this.requireFile(path);
		this.files.delete(path);
	}

	getDocument(path: string): SourceDocument | undefined {
		return this.files.get(path)?.document;
	}

	private requireFile(path: string): SourceFile {
		const file = this.files.get(path);
		if (!file) throw new Error(`Source file is not open: ${path}`);
		return file;
	}
}
