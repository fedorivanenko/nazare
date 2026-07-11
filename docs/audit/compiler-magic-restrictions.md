# Compiler audit: magic and restrictions

## Summary

Compiler architecture is clean, but v0 currently carries too much implicit magic and too many default restrictions for the stated principle: every valid Shopify theme should remain at least partially readable without rewrite.

Best direction: keep the default compiler loose and predictable; move stricter guarantees behind an explicit strict/debug mode.

## Good parts

- Unknown Liquid is preserved rather than rejected.
- Contract resolution failure degrades to diagnostics instead of aborting compilation.
- TypeScript script checking is separated from the main compile path.
- Pass boundaries are clear: parse, syntax, bind, check, graph, validate, emit.
- Diagnostics are centralized in `packages/compiler/src/diagnostics.ts`.

## High-magic areas

### Textual props lowering

`lowerPropsReads()` rewrites `props.x` text across the whole emitted Liquid output.

Risk: it may rewrite occurrences outside intended Liquid expression semantics.

Prefer: rewrite only modeled Liquid expression spans, or keep authored expressions intact unless compiler owns that syntax.

### Regex-based script introspection

`refs.foo` and `data.ref.prop` are collected with regexes.

Risk: strings/comments can be detected as real accesses; computed access is unsupported.

Prefer: TypeScript AST scan for TypeScript scripts; conservative/no scan for JavaScript unless explicit opt-in.

### Regex extraction for script/style blocks

`{% script %}` and `{% stylesheet %}` are extracted with regex before LiquidHTML parsing.

Works for v0, but brittle for edge cases.

Prefer: proper Liquid AST integration when possible.

### Lightweight CSS scoping parser

CSS scoping walks braces and splits selectors by comma.

Risk: complex selectors like `:is(.a, .b)` may be split incorrectly.

Prefer: real CSS selector/parser dependency, or document supported subset.

### Auto root stamping

Emit auto-injects `data-nz-component="name"` into the first top-level element.

Risk: hidden behavior; no explicit author marker.

Prefer: document strongly, or support explicit root marker.

### Custom render mini-language

`{% render Component { ... } %}` uses regex + top-level splitting.

Risk: syntax divergence from Shopify Liquid and fragile parsing.

Prefer: keep minimal, document exact grammar, add parser tests for edge cases.

### Type-expression DSL growth

The prop DSL already includes many builder methods:

- `.setting()`
- `.required()`
- `.optional()`
- `.or()`
- `.enum()`
- `.default()`
- `.min()`
- `.max()`
- `.step()`
- `.unit()`
- `.returns()`

Risk: increasing DSL surface creates framework-specific type system and unclear unsupported behavior.

Prefer: keep core types small; make unknown calls diagnostics instead of silent no-ops.

## Restrictions that may be too strict

- `ref` must be a static valid identifier.
- Duplicate `ref` is an error.
- `data.*` script reads must match a `data-*` binding on the referenced element.
- Only `data-*="{{ expr }}"` single-output bindings are modeled.
- Render argument keys must be identifiers.
- Asset imports must be `./`-relative `.ts`, `.js`, or `.css`, with no `..`.
- Script emit expects `export default island(...)`.
- Type inference only handles literals and simple `props.x`; richer expressions become `unknown`.

Some of these are reasonable for strict component guarantees, but too strict as default behavior if the compiler's baseline promise is Shopify compatibility.

## Recommended policy

### Default: loose mode

Default compile should:

- Preserve all unknown Shopify Liquid and HTML.
- Error only on malformed Nazare-owned syntax.
- Avoid failing on incomplete model coverage.
- Prefer warnings/info for unsupported modeling.
- Avoid hidden semantic rewrites where possible.

Candidate diagnostics to downgrade, suppress, or make debug-only by default:

- `IR_NODE_NOT_PROMOTED_HTML`
- `IR_PARTIAL_LOWERING_CONTROL_FLOW`
- `CONSTRAINT_UNUSED_REF`
- `CONSTRAINT_UNUSED_DATA_BINDING`

### Strict mode

Add explicit `strict: true` / `checks` options for:

- ref uniqueness/use checks
- data-channel checks
- required prop checks
- prop type mismatch checks
- range checks
- TypeScript script checks
- unused warnings

This lets package authors request guarantees without surprising theme migration users.

## Recommended implementation changes

1. Add compile/check options:

```ts
export type CompilerStrictness = "loose" | "strict";

export type CompileNazareArtifactOptions = {
  contracts?: ArtifactContract[];
  packageId?: string;
  readAsset?: (relativePath: string) => string | undefined;
  strictness?: CompilerStrictness;
};
```

2. Split checks into categories:

- contract checks
- ref checks
- data-channel checks
- unused checks
- debug lowering notices

3. Make `htmlNotPromoted` and `controlFlowNotLowered` optional debug diagnostics.

4. Replace global `props.x` text rewrite with span-based or AST-aware rewrite.

5. Replace CSS scoping with a real parser before production use.

6. Replace TypeScript source regex scans with AST scans.

7. Add grammar docs for Nazare-owned tags.

## Bottom line

Architecture is solid. Main issue is product semantics: too many implicit compiler behaviors and too many constraints run by default. Make the default compiler permissive and boring; put strong component guarantees behind explicit strict mode.
