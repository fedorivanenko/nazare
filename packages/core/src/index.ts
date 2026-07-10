// @nazare/core is types only: the vocabulary shared between the compiler,
// CLI, and registry. One module per pipeline layer, ordered here roughly
// source-to-graph. No runtime logic beyond constants.
export * from "./contract.js";
export * from "./diagnostic.js";
export * from "./graph.js";
export * from "./id.js";
export * from "./ir.js";
export * from "./manifest.js";
export * from "./semantic.js";
export * from "./source.js";
export * from "./symbol.js";
export * from "./syntax.js";
export * from "./theme-schema.js";
