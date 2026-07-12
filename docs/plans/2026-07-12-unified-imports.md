# Unified import grammar + relative component compilation

Build step 1 of the frozen 2026-07-12 mega-design (shadcn pivot). Steps 2–4
(CSS modules, island placement, registry-as-install-tooling) come after.

## Frozen design being built

One import form, everything else dies:

```liquid
{% import Link from "../link/link.nz.liquid" %}   component — capitalized
{% import Gallery from "./gallery.nz.liquid" %}   private sub-component
{% import counter from "./counter.ts" %}          behavior — lowercase
{% import styles from "./counter.css" %}          style — lowercase
```

Rules:

- Every import binds a name to a **relative path** (`./` or `../`) to a real
  file in the project. Bare specifiers (`link`, `@nazare/cn`) are errors
  everywhere — Liquid and TS. Nazare registry is shadcn-style: install copies
  source into the project; there are no packages at compile/build time.
- Paths resolve against the importing file and must stay inside the project
  root. All files are identified by project-relative POSIX paths.
- Extension decides the import kind: `.liquid` component (name must be
  capitalized), `.ts`/`.js` behavior, `.css` style (names must be lowercase).
- Component imports are **compile-that-file**: the compiler derives the
  imported file's contract by parsing + binding it (recursively, cycle-guarded)
  through the single `readFile(path)` option. Contract identity = file path.
  An imported component's symbol id equals the id its own compile produces.
- Side-effect form `{% import "./x.ts" %}` is a parse error with guidance.
- `{% blocks %}` takes plain theme-block type names (`{% blocks "notice" %}`),
  not package ids.

## Retired

- `compileNazareArtifactWithResolver`, `ContractResolver`,
  `CONTRACT_RESOLUTION_FAILED`
- compile options `contracts`, `packageId`, `dependencies`, `readAsset`
  (replaced by `kind` + `readFile`)
- `checkDependencies` + `CONSTRAINT_UNDECLARED_DEPENDENCY` /
  `CONSTRAINT_UNUSED_DEPENDENCY` (manifest deps are registry input only)
- function packages via bare script imports; `readPackageModule` in emit,
  bundle, and check-script; `SCRIPT_PACKAGE_IMPORT_UNRESOLVED`
- `ArtifactContract.packageId` → `path`; hoisted `sourcePackageId` →
  `sourcePath`; `ArtifactSymbol.packageId` and `manifest`/`registry` symbol
  sources
- CLI `localContractResolver` / `localPackageModuleReader` (folder-layout
  knowledge; reframed later as shadcn install tooling)

## New diagnostics

| Code | When |
| --- | --- |
| `NAZARE_IMPORT_BARE_SPECIFIER` | specifier is not `./`- or `../`-relative |
| `NAZARE_IMPORT_OUTSIDE_PROJECT` | path escapes the project root |
| `NAZARE_IMPORT_UNSUPPORTED_EXTENSION` | not .liquid/.ts/.js/.css |
| `NAZARE_IMPORT_COMPONENT_CASE` | component import name not capitalized |
| `NAZARE_IMPORT_BINDING_CASE` | behavior/style import name capitalized |
| `IMPORT_NOT_FOUND` | readFile returned undefined (replaces ASSET_IMPORT_NOT_FOUND) |
| `IMPORT_CYCLE` | component import cycle while deriving contracts |
| `SCRIPT_IMPORT_BARE` | bare specifier in a behavior script (bundle time) |

## Work sequence (✅ done so far)

1. ✅ core: `ArtifactContract.path`/`sourcePath`, `ImportSyntaxNode.path`,
   `BlocksSlotSyntaxNode.blockTypes`, symbol source slimmed
2. ✅ compiler `paths.ts` (pure path math: resolve, root boundary, basename)
3. ✅ `diagnostics.ts` (new codes in, retired codes out)
4. ✅ `ast.ts` (named asset imports, `bindingName` on script/style nodes)
5. ✅ `parser.ts` (single import grammar, case rules, blocks slot rename)
6. ✅ `index.ts` (options `{kind, readFile}`, recursive contract derivation
   with cycle guard, project-relative asset resolution, resolver API deleted)
7. ✅ `ids.ts` + `symbols.ts` (`componentSymbolIdForFile`, contract by path)
8. ✅ `hoist.ts` (alias→path map, `sourcePath`)
9. ✅ `check.ts` (drop checkDependencies; options lose `dependencies`)
10. ✅ `schema.ts` (blocks slot `blockTypes` verbatim; hoisted `info: "From
    <path>"`)
11. ✅ `bundle.ts` (project-relative module ids, root boundary, bare import
    = error, drop readPackageModule)
12. ✅ `check-script.ts` (virtual fs serves `/` + project-relative paths;
    entry lives beside the component so `../` resolves; drop package paths)
13. ✅ `emit.ts` (options `{name, kind?, readFile?}`, snippet names from
    import path basename, header `sourcePath`, bundle entry ids =
    project-relative paths)
14. ✅ `cli-client` (project root = cwd, relativized entry path, one
    readFile; keep reading entry's nazare.json only for `kind`)
15. ✅ examples migration (announcement-bar → `../link/link.nz.liquid`;
    counter.ts → `../cn/cn.ts`; cn.nz.ts renamed cn.ts; price named imports;
    notice-board `{% blocks "notice" %}`)
16. ✅ tests migration (18 files) + golden snapshot refresh
17. ✅ README rules update

## Notes / decisions made while building

- Imported-file diagnostics are NOT surfaced into the consumer's compile —
  each file is compiled on its own to see its errors. Only `IMPORT_NOT_FOUND`
  and `IMPORT_CYCLE` surface at the import site.
- `CompileResult.contract` is now always present (identity = entry path).
- Blocks stay string-named: a blocks slot is a schema declaration (accepted
  theme-block types), not a render of a file, so it doesn't use imports.
  Kind of an imported component is not modeled yet (no manifest at compile
  time); render-of-a-section errors are future work.
- Step 2 (CSS modules) will consume `bindingName` already carried on
  script/style nodes.

## Completed 2026-07-12

All 17 steps done; 140 tests green; every example builds error-free via the
CLI. Hard-won fix along the way: TS module resolution silently skips files in
directories the compiler host says don't exist — check-script now overrides
`host.directoryExists` for virtual `/`-rooted paths (see check-script.ts).

## Step 2: CSS modules (completed 2026-07-12)

- `{% stylesheet styles %}` and `{% import styles from "./x.css" %}` bind a
  class map; `{{ styles.wrapper }}` / `{{ styles["hero-image"] }}` lower at
  compile time to `nz-<component>__<class>`; bound sheets' selectors are
  rewritten to match (css-modules.ts: prelude-scanned class tokens, so
  url(...)/0.5rem/keyframe percentages never match).
- Unknown `styles.x` = CONSTRAINT_UNKNOWN_STYLE_CLASS (error); defined but
  unread class = CONSTRAINT_UNUSED_STYLE_CLASS (warning, span into the css).
- Bare `{% stylesheet %}` passes through untouched (vanilla behavior);
  binding is the scoping opt-in. scope-css.ts deleted; `data-nz-component`
  is stamped only for scripts/blocks (island mount hook).
- Render-argument reads (`class: styles.cta`) lower to a quoted literal.
- Examples: price fully migrated (import-bound); counter/disclosure/notice
  stay unbound on purpose — their scripts toggle class strings at runtime
  (`nazare-counter--positive`), which a static class map cannot see.
