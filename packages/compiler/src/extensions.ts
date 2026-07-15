import type { ArtifactContract, ArtifactIR } from "@nazare/core";
import type { AuthoredSchema } from "./ast.js";
import type { EmitResult } from "./emit.js";

// One compiled component, projected to serializable facts. The extension
// boundary is the serialization boundary: no LiquidHTML AST, no raw
// diagnostics (the build owns those). For a whole-repo view, an extension
// merges these IRs itself: `artifactGraphFromIR(mergeArtifactIR(components.map((c) => c.ir)))`.
export type NazareComponent = {
	/** Path is identity (filename-addressing). */
	file: string;
	/** Raw .nz.liquid source; use this, not a parser AST, if you need text. */
	source: string;
	schema?: AuthoredSchema;
	/** Full component IR — facts only. Flat arrays; serializes cleanly. */
	ir: ArtifactIR;
	/** This component's typed prop/setting interface. */
	contract: ArtifactContract;
	/** False when the component produced error-severity compile diagnostics. */
	canEmit: boolean;
};

export type NazareExtensionContext<TOptions = unknown> = {
	/** Read-only build context. Extensions emit files; they never mutate the build. */
	projectRoot: string;
	sourceRoot: string;
	outDir: string;
	/** This extension's options block from nazare.theme.json. */
	options: TOptions;
	/** Every compiled component in this theme build. */
	components: NazareComponent[];
};

export type NazareExtension<TOptions = unknown> = {
	name: string;
	/** Emits secondary theme files. Runs once per theme build, after components compile. */
	emit?: (
		context: NazareExtensionContext<TOptions>,
	) => EmitResult | Promise<EmitResult>;
};

export type NazareExtensionRegistration<TOptions = unknown> = {
	extension: NazareExtension<TOptions>;
	options?: TOptions;
};
