# @nazare/compiler

`@nazare/compiler` turns Nazare Liquid component source into checked compiler artifacts and Shopify theme files. It is the package that understands Nazare tags (`{% props %}`, `{% import %}`, Nazare render syntax, refs, islands, bound stylesheets, scripts) and projects them back into vanilla Shopify Liquid, CSS, JavaScript, and schema JSON.

The compiler is designed as a small multi-pass compiler: each pass owns one concern, produces explicit data, and avoids hidden output rewriting.

## Purpose

Use this package to:

- parse a Nazare component;
- resolve local component/script/style imports;
- derive component contracts;
- check render sites against contracts;
- validate refs, islands, data channels, CSS module reads, and script constraints;
- inspect syntax / IR / graph output;
- emit Shopify theme files.

## Architecture

```txt
source
  │
  ▼
compiler frontend
  - explicit source-language adapter
  - built-in nazareLiquidFrontend for .nz.liquid
  - future frontends can translate other inputs into compiler facts
  │
  ▼
parseNazareLiquid (.nz.liquid frontend)
  - tolerant LiquidHTML parse
  - extracts Nazare nodes
  - records source spans
  - records unsupported Liquid/HTML notes
  │
  ▼
resolveComponentContracts / resolveAssetImports
  - only place that reads project files through readFile(path)
  - component imports become contracts
  - script/css imports become script/style nodes
  │
  ▼
syntaxFromAst
  - converts parse nodes into flat syntax records
  - preserves occurrence identity and spans
  │
  ▼
bindArtifactIR
  - creates symbols and resolutions
  - records facts only; no diagnostics
  │
  ▼
artifactGraphFromIR
  - projects IR into graph nodes/edges for inspection
  │
  ▼
checkArtifactIR / checkVanillaSchema
  - user-facing constraints
  - contract checks, refs, islands, props, styles, scripts
  │
  ▼
validateArtifactIR / validateArtifactGraph
  - compiler invariants
  - catches malformed compiler output
  │
  ▼
emitTheme
  - span-based Liquid projection
  - CSS class rewriting
  - script bundling/runtime registration
  - Shopify schema generation
```

`compileArtifact()` runs the generic frontend-based compile pipeline. `compileNazareArtifact()` is the compatibility wrapper for `.nz.liquid`. `buildNazareTheme()` runs Nazare compile, checks dependencies, then emits theme files.

## Main entry points

### `compileArtifact(options)`

Compiles one artifact through a selected `CompilerFrontend`. It does **not** emit files.

Selection order:

1. explicit `frontend` option;
2. caller-provided `frontends` whose `accepts(file, source)` returns true;
3. built-in `nazareLiquidFrontend` for `.nz.liquid` files;
4. unsupported-input diagnostic.

Returns frontend-agnostic compiler data plus:

- `frontend` — selected frontend name;
- `capabilities` — explicit/inferred contract flags;
- `sourceForEmit` — source the emitter should use;
- optional `ast` — present for the built-in Nazare Liquid frontend.

### `compileNazareArtifact(source, file, options?)`

Compiles one `.nz.liquid` artifact through `nazareLiquidFrontend` and returns structured compiler data. It does **not** emit files.

Returns:

- `ast` — parser output plus full LiquidHTML AST;
- `syntax` — flat syntax nodes;
- `ir` — symbols and resolutions;
- `graph` — graph projection;
- `issues` — diagnostics from compile passes;
- `notes` — informational parse notes;
- `contract` — this component's public contract;
- `contracts` — imported component contracts;
- `canEmit` — false if compile errors exist.

### `buildNazareTheme(source, file, options)`

Compiles and emits Shopify theme files.

Adds:

- dependency diagnostics;
- emitted Liquid/CSS/JS/runtime files;
- `emittedOnError`, showing whether emit ran despite errors.

By default `emitOnError` is `true`, useful for tooling previews. Set `emitOnError: false` for build pipelines that should skip output when errors exist.

## Minimal compile

```ts
import { compileArtifact, compileNazareArtifact } from "@nazare/compiler";

const source = `{% props { title: string.required() } %}
<h2>{{ props.title }}</h2>`;

const generic = compileArtifact({
	source,
	file: "components/heading.nz.liquid",
});

const result = compileNazareArtifact(source, "components/heading.nz.liquid");

if (!result.canEmit) {
	console.error(result.issues);
}

console.log(result.contract);
console.log(result.ir.syntax.length);
```

## Compile with imports

All imports are project-relative. The compiler never reads the filesystem directly; callers provide `readFile(path)`.

```ts
import { compileNazareArtifact } from "@nazare/compiler";

const files: Record<string, string> = {
	"components/link.nz.liquid": `{% props { href: url.required(), text: string.required() } %}`,
};

const result = compileNazareArtifact(
	`{% import Link from "./link.nz.liquid" %}
{% render Link { href: "https://example.com", text: "Go" } %}`,
	"components/card.nz.liquid",
	{ readFile: (path) => files[path] },
);

console.log(result.issues);
```

## Build theme files

```ts
import { buildNazareTheme } from "@nazare/compiler";

const built = buildNazareTheme(source, "components/heading.nz.liquid", {
	name: "heading",
	readFile: (path) => files[path],
	emitOnError: false,
});

for (const file of built.emitted.files) {
	console.log(file.path);
	console.log(file.contents);
}
```

Emitted file paths use Shopify directories:

- `sections/<name>.liquid` for section components;
- `blocks/<name>.liquid` for block components;
- `snippets/<name>.liquid` for snippet components;
- `assets/<name>.css` when styles exist;
- `assets/<name>.js` and `assets/nazare-runtime.js` when scripts exist.

## Diagnostics

Diagnostics use `Diagnostic` from `@nazare/core`.

```ts
const errors = result.issues.filter((issue) => issue.severity === "error");
const byPhase = result.issues.groupBy?.((issue) => issue.phase);
```

Fields:

- `severity`: `error`, `warning`, `info`;
- `code`: stable diagnostic code;
- `phase`: `parse`, `resolve`, `check`, `validate`, or `emit`;
- `span`: source location when available;
- `nodeId` / `edgeId`: related compiler artifact when available.

## Options

```ts
type CompileNazareArtifactOptions = {
	readFile?: (path: string) => string | undefined;
	strictness?: "strict" | "loose";
};

type BuildNazareThemeOptions = CompileNazareArtifactOptions & {
	name: string;
	emitOnError?: boolean;
};
```

- `strict` mode is the default package-author mode.
- `loose` mode keeps only migration/build essentials.
- `readFile` receives normalized project-relative paths.

## Design invariants

- Parse locates source facts.
- Resolver owns project file access.
- Syntax is flat and serializable.
- Bind records facts, not judgments.
- Check emits user diagnostics.
- Validate emits compiler-invariant diagnostics.
- Emit projects known spans and generated facts into Shopify files.
- IDs are opaque; consumers should navigate syntax/resolution records instead of parsing IDs.
