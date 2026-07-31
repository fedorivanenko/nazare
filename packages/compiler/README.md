# @nazare/compiler

`@nazare/compiler` turns Nazare Liquid component source into checked compiler artifacts and Shopify theme files. It is the package that understands Nazare tags (`{% props %}`, `{% import %}`, Nazare render syntax, refs, islands, bound stylesheets, scripts) and projects them back into vanilla Shopify Liquid, CSS, JavaScript, and schema JSON.

The compiler is designed as a small multi-pass compiler: each pass owns one concern, produces explicit data, and avoids hidden output rewriting.

## Purpose

Use this package to:

- parse a Nazare component;
- resolve local component/script/style imports;
- derive component contracts;
- check render sites against contracts;
- validate refs, islands, data channels, CSS module reads, script constraints, and inert Nazare HTML such as `<slot>`;
- inspect syntax / IR / graph output;
- emit Shopify theme files.

## Architecture

```txt
source
  │
  ▼
compiler frontend selection
  - explicit frontend option
  - caller frontends in order
  - built-in Tree-sitter frontends for .nz.liquid and .liquid
  - unsupported inputs return diagnostics, not fabricated contracts
  │
  ▼
selected frontend
  ├─ nazare-ast result
  │    projectTreeSitterNazareAst
  │      - fail-closed Tree-sitter parse
  │      - extracts Nazare nodes and canonical Liquid facts
  │      - records UTF-16 source spans
  │    resolveComponentContracts / resolveAssetImports
  │      - only place that reads project files through readFile(path)
  │      - component imports become contracts
  │      - script/css imports become script/style nodes
  │    syntaxFromAst
  │      - converts parse nodes into flat syntax records
  │      - preserves occurrence identity and spans
  │    bindArtifactIR
  │      - creates symbols and resolutions
  │      - records facts only; no diagnostics
  │
  └─ direct-ir result
       - frontend provides syntax + IR facts directly
  │
  ▼
shared projection in compileArtifact
  - artifactGraphFromIR
  - checkArtifactIR / checkVanillaSchema where applicable
  - validateArtifactIR / validateArtifactGraph
  - contractFromIR
  │
  ▼
emitTheme
  - span-based Liquid projection
  - CSS class rewriting
  - script bundling/runtime registration
  - Shopify schema generation
```

`compileArtifact()` runs the generic frontend-based compile pipeline. It selects a frontend, projects frontend output through shared compiler passes, and returns either `ok: true` with compiler facts or `ok: false` with diagnostics only. `compileNazareArtifact()` is the compatibility wrapper for `.nz.liquid`. `buildNazareThemeWorkspace()` analyzes a theme workspace, selects a build scope, then emits theme files.

## Main entry points

### `compileArtifact(options)`

Compiles one artifact through a selected `CompilerFrontend`. It does **not** emit files.

Selection order:

1. explicit `frontend` option;
2. caller-provided `frontends` whose `accepts(file, source)` returns true;
3. built-in `treeSitterNazareLiquidFrontend` for `.nz.liquid` files;
4. built-in `treeSitterPlainLiquidFrontend` for plain `.liquid` files;
5. unsupported-input diagnostic.

Returns a discriminated result:

- success: `ok: true` plus frontend-agnostic compiler data;
- failure: `ok: false` plus diagnostics, with no fabricated semantic model.

Success adds:

- `frontend` — selected frontend name;
- `frontendSupport` — source syntax features the frontend supports;
- `contractProvenance` — `explicit`, `inferred`, `mixed`, or `none`;
- `sourceForEmit` — source the emitter should use;
- optional `ast` — present for the built-in Nazare Liquid frontend;
- `frontendMetadata` — frontend-owned metadata for typed wrappers and tooling.

Frontend-specific options travel through `frontendOptions`. Built-in plain Liquid frontend accepts `{ parseMode: "strict" | "liquid-only" }`.

Built-in frontend support:

- `treeSitterNazareLiquidFrontend` — `.nz.liquid` component frontend with explicit props/imports/behavior syntax;
- `treeSitterPlainLiquidFrontend` — plain Shopify `.liquid` frontend for coexistence validation and dependency indexing.

### `compilePlainLiquid(source, file)`

Parses one existing Shopify `.liquid` file without interpreting Nazare syntax. Returns Liquid parse diagnostics, authored schema diagnostics, static/dynamic dependencies from `{% render %}`, `{% include %}`, `{% section %}`, `{% sections %}`, and `{% layout %}`, plus a `canEmit` flag. Strict HTML + Liquid parsing is the default; pass `{ parseMode: "liquid-only" }` to mask HTML while retaining strict Liquid structure validation.

Use this for coexistence mode: legacy theme files stay plain Shopify Liquid, but the compiler can still validate and index them beside `.nz.liquid` components.

### `buildPlainLiquid(source, file)`

Runs `compilePlainLiquid()` and emits the source unchanged at the same theme-relative path when no error diagnostics exist. Pass `{ emitOnError: true }` for explicit preview-style pass-through output.

`compilePlainLiquid()` is a typed convenience wrapper around `compileArtifact({ frontend: treeSitterPlainLiquidFrontend })`, so it shares the same frontend selection/projection path rather than maintaining a parallel compiler flow.

### `compileNazareArtifact(source, file, options?)`

Compiles one `.nz.liquid` artifact through `treeSitterNazareLiquidFrontend` and returns structured compiler data. It does **not** emit files.

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

### `computeNazareTheme(files, options)`

Builds the canonical computation-oriented theme program. Typed semantic records and direct indexes own meaning; public graph JSON is a lazy projection rather than the query substrate.

```ts
const computation = computeNazareTheme(files);
const impact = computation.getFileImpact("snippets/product-card.liquid");
const allImpacts = computation.getFileImpacts();
const graph = computation.toInspectGraph();
```

`getFileImpact()` and `getFileImpacts()` read semantic indexes directly and do not materialize the public graph. `toInspectGraph()` creates and memoizes the deterministic public projection only when requested.

### `analyzeNazareTheme(files, options)` / `inspectNazareTheme(files, options)`

Build deterministic whole-theme semantics from ordinary Shopify theme files and optional Nazare components. `analyzeNazareTheme()` returns canonical version 3 `ThemeSemanticModel` IR. `inspectNazareTheme()` is a convenience wrapper around `computeNazareTheme(...).toInspectGraph()` and projects that IR into version 4 graph nodes, edges, evidence, query views, and impact indexes. Version 4 removes inverse declaration edges and direct render shortcuts; occurrence topology is canonical.

Every included source passes through exactly one whole-theme `ThemeSourceFrontend`. Built-ins analyze Nazare Liquid, plain Liquid, Shopify JSON, CSS, JavaScript, and opaque assets. Ambiguous or unsupported ownership fails explicitly. Frontends emit file-owned Shopify semantic facts; the whole-theme linker alone resolves cross-file and cross-language relationships.

Build, diagnostics, and targeted query callers should consume computation records/indexes without constructing `InspectNazareThemeResult`. Semantic output distinguishes:

- direct source facts, carrying source evidence;
- derived value-flow facts, such as a passed `product` becoming `product.price` inside a snippet;
- inferred inputs, with `required`, `optional`, or `unknown` requirement state;
- capabilities/classifications, carrying categorical evidence strength and uncertainty;
- unresolved dynamic or missing targets.

Graph structure includes pages, templates, layouts, section groups, section and block instances, reusable theme blocks, render sites, render arguments, input satisfaction, Shopify data properties, settings, assets, locales, optional Shopify metafield definitions, DOM hooks, CSS custom properties, JavaScript events, and custom elements. Render calls project explicitly as:

```txt
caller file → render site → target snippet
                    └────→ argument → expected input
                                      → Shopify data or setting origin
```

Theme analysis uses `liquid-only` parsing by default: HTML is masked to avoid branch-balancing false positives, while Liquid structure is validated strictly. Static HTML classes, ids, data attributes, and custom-element tags become markup contracts. PostCSS and `postcss-selector-parser` extract CSS selectors and custom-property definitions/reads. The TypeScript AST extracts literal JavaScript DOM queries, class mutations, dataset and `data-*` attribute reads/writes, event listeners/dispatches, custom-element definitions, and local static module imports/re-exports. Dynamic markup, selectors, dataset keys, attribute names, and imports produce explicit partial-analysis boundaries. A failed parse emits diagnostics and never fabricates skipped facts.

Pass `.shopify/metafields.json` through `options.metafields` to join store definitions with theme reads; missing snapshots remain `unknown`, never proof of absence. Inspect output exposes consumed, unconsumed, broken, and page-impact queries. `getThemeFileImpact(graph, path)` projects direct dependencies, direct dependents, transitive affected pages, usage, diagnostics, and source-analysis uncertainty for one theme-relative file. Behavior dependencies do not broaden affected pages through globally loaded assets. Pass `.theme-check.yml` through `options.themeCheck` to validate and expose the configured ignore list. Shopify rule names are not assumed to match Inspect diagnostics.

The lightweight `@nazare/compiler/inspect-cache` entry point validates and serializes persisted fact buckets plus compiler-owned `ThemeFileImpact` projections. It imports no language frontend. Callers must key projections by an exact input fingerprint; stale fact revisions, unsafe paths, malformed diagnostics, mismatched file/impact sets, and unsupported cache versions are rejected.

### `buildNazareThemeWorkspace(files, options)`

Analyzes workspace files and emits Shopify theme files for the selected scope.

Scopes:

- `{ kind: "workspace" }` — emit all buildable `.nz.liquid` artifacts.
- `{ kind: "closure", path }` — analyze and emit an entry plus its transitive component-import closure.
- `{ kind: "file", path }` — analyze the import closure but emit only the entry artifact, while using workspace files as dependency read context.

Adds:

- analysis diagnostics;
- emitted Liquid/CSS/JS/runtime files;
- `emittedOnError`, showing whether emit ran despite errors.

Workspace builds use exported `THEME_BUILD_DEFAULTS`: strict checking, strict plain-Liquid parsing, workspace scope, and `emitOnError: false`. Build pipelines expose no output when errors exist. Tooling previews that need best-effort output must pass `emitOnError: true` explicitly. Analysis/inspect uses exported `THEME_ANALYSIS_DEFAULTS`, including `liquid-only` parsing that masks HTML while rejecting malformed Liquid structure.

## Minimal compile

```ts
import { compileArtifact, compileNazareArtifact } from "@nazare/compiler";

const source = `{% props { title: string.required() } %}
<h2>{{ props.title }}</h2>`;

const generic = compileArtifact({
	source,
	file: "components/heading.nz.liquid",
});

if (!generic.ok) {
	console.error(generic.issues);
	process.exit(1);
}

console.log(generic.frontend);
console.log(generic.contract);
console.log(generic.ir.syntax.length);

const result = compileNazareArtifact(source, "components/heading.nz.liquid");
console.log(result.ast.file);
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
import { buildNazareThemeWorkspace } from "@nazare/compiler";

const built = buildNazareThemeWorkspace(
	[{ path: "components/heading.nz.liquid", contents: source }],
	{
		name: "heading",
		scope: { kind: "file", path: "components/heading.nz.liquid" },
	},
);

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

## Frontends

A frontend is an explicit source-language adapter:

```ts
type CompilerFrontend = {
	name: string;
	accepts(file: string, source: string): boolean;
	compile(input: CompileInput): FrontendResult;
};
```

`FrontendResult` is discriminated:

- `kind: "nazare-ast"` returns a `NazareAst`, dependency contracts, and resolve diagnostics. `compileArtifact()` performs syntax, IR, graph, check, validate, and contract projection.
- `kind: "direct-ir"` returns syntax and IR directly. `compileArtifact()` still owns graph, shared IR checks, validation, and contract projection.

Frontend metadata is separated from artifact facts:

- `frontendSupport` describes syntax/features the selected frontend supports.
- `contractProvenance` describes this artifact's contract source: `explicit`, `inferred`, `mixed`, or `none`.

Unsupported input returns `{ ok: false, issues, notes, canEmit: false }`. It does not invent a contract, IR, or graph.

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
type CompileInput = {
	source: string;
	file: string;
	readFile?: (path: string) => string | undefined;
	strictness?: "strict" | "loose";
};

type CompileArtifactOptions = CompileInput & {
	frontend?: CompilerFrontend;
	frontends?: CompilerFrontend[];
};

type CompileNazareArtifactOptions = Pick<
	CompileInput,
	"readFile" | "strictness"
>;

type BuildNazareThemeOptions = CompileNazareArtifactOptions & {
	name: string;
	emitOnError?: boolean;
};
```

- `strict` mode is the default package-author mode. It rejects unchecked type gaps such as unknown render-argument expressions and unknown data-binding parse kinds as errors.
- `loose` mode keeps only migration/build essentials.
- `readFile` receives normalized project-relative paths.

## Design invariants

- Frontend selection is explicit and deterministic.
- Unsupported inputs return diagnostics without fabricated semantic facts.
- Frontends adapt source languages; shared projection owns graph, checks, validation, and contract derivation.
- Parse locates source facts.
- Resolver owns project file access.
- Syntax is flat and serializable.
- Bind records facts, not judgments.
- Check emits user diagnostics.
- Validate emits compiler-invariant diagnostics.
- Emit projects known spans and generated facts into Shopify files.
- IDs are opaque; consumers should navigate syntax/resolution records instead of parsing IDs.
