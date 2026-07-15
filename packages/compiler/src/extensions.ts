import type { EmitResult } from "./emit.js";
import type { CompileResult } from "./index.js";

export type NazareExtensionContext = {
	projectRoot: string;
	sourceRoot: string;
	outDir: string;
	/** Per-extension options from nazare.theme.json. */
	options?: unknown;
	/** Every compiled component in this theme build. */
	components: CompileResult[];
};

export type NazareExtension = {
	name: string;
	/** Emits secondary theme files. Runs once per theme build, after components compile. */
	emit?: (context: NazareExtensionContext) => EmitResult | Promise<EmitResult>;
};

export type NazareExtensionRegistration = {
	extension: NazareExtension;
	options?: unknown;
};
