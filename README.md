# Nazare Registry

Component registry for Nazare Shopify themes.

Registry stores component source and metadata. Themes pull from this repo, then generate theme-local build entries and compiled Shopify assets.

## Contract

- Registry is source of truth for components.
- Theme config points to registry repo/ref/manifest.
- CLI resolves dependencies, copies source files, generates CSS entries, then theme build compiles assets.

## Files

```txt
nazare.registry.yml     # component manifest
sections/               # section Liquid source
snippets/               # snippet Liquid source
scripts/                # script source
tooling/                # installable tooling source
vite.config.js          # build preset template
```

No `assets/` here. Shopify `assets/` are compiled theme output.

No `styles/` here by default. Section CSS entry files are generated in theme from manifest `css.sources`.

CSS load policy lives in manifest `css.load`:

- `preload` adds `<link rel="preload" as="style">` plus normal stylesheet.
- `normal` uses normal stylesheet only.

## Manifest

Each component declares files it owns and optional dependencies. Tooling components may also declare package scripts and dev dependencies.

```yaml
components:
  build-vite:
    kind: tooling
    package:
      scripts:
        build: vite build
        registry: node tooling/registry.mjs
        watch: vite build --watch --emptyOutDir=false
      dependencies:
        reefjs: ^13.0.6
      devDependencies:
        "@tailwindcss/vite": ^4.0.0
        tailwindcss: ^4.0.0
        vite: ^6.0.0
        yaml: ^2.9.0
    files:
      - vite.config.js
      - tooling/registry.mjs

  s-hero:
    kind: section
    dependencies:
      - core
      - c-button
      - c-video
    css:
      mode: generated
      entry: styles/s-hero.css
      output: assets/s-hero.css
      load: preload
      sources:
        - sections/s-hero.liquid
        - snippets/c-button.liquid
        - snippets/c-video.liquid
    files:
      - sections/s-hero.liquid
```

## Install flow

Expected CLI behavior:

1. Read theme `nazare.config.yml`.
2. Fetch `registry.repo` at `registry.ref`.
3. Read `registry.manifest`.
4. Resolve requested components plus dependencies.
5. Merge component `package.scripts`, `package.dependencies`, and `package.devDependencies` into theme `package.json`.
6. Copy `files` into theme.
7. Generate `css.entry` files in theme for `css.mode: generated`.
8. Run theme build so Vite emits `css.output` into `assets/`.
9. Update theme lockfile.

## Components

Current components:

- `build-vite`
- `core`
- `c-button`
- `c-video`
- `c-marquee`
- `s-announcement`
- `s-hero`
- `s-social-video-gallery`
