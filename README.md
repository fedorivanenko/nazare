# Nazare Registry

Component registry for Nazare Shopify themes.

Registry stores component source, starter template, installer, and metadata. Themes are generated from this repo, then pull/update components from this repo.

## Install CLI

```bash
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare-registry/main/install.sh | sh
```

Create theme:

```bash
nazare init my-store
cd my-store
cp .example.env .env
pnpm install
pnpm dev
```

List and pull components:

```bash
nazare list
nazare pull s-hero
```

Update CLI:

```bash
nazare self update
```

## Contract

- Registry is source of truth for components.
- Theme config points to registry repo/ref/manifest.
- Global `nazare` CLI resolves dependencies, copies source files, generates CSS entries, generates `snippets/section-css.liquid`, then theme build compiles assets.

## Files

```txt
nazare.registry.yml     # component manifest
templates/default/      # empty starter theme used by nazare init
components/sections/    # section Liquid source
components/snippets/    # snippet Liquid source
components/scripts/     # script source
```

Registry root has no `assets/`; Shopify `assets/` are compiled theme output.

Registry root has no `styles/` by default. Section CSS entry files are generated in theme from manifest `css.sources`.

CSS load policy lives in manifest `css.load`:

- `preload` adds `<link rel="preload" as="style">` plus normal stylesheet.
- `normal` uses normal stylesheet only.

## Manifest

Each component declares files it owns and optional dependencies. Base build tooling comes from `templates/default`; component pulls should not reinstall it.

```yaml
components:
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
      - from: components/sections/s-hero.liquid
        to: sections/s-hero.liquid
```

## Install flow

Expected CLI behavior:

1. Read theme `nazare.config.yml`.
2. Fetch `registry.repo` at `registry.ref`.
3. Read `registry.manifest`.
4. Resolve requested components plus dependencies.
5. Copy `files` into theme.
6. Generate `css.entry` files in theme for `css.mode: generated`.
7. Generate `snippets/section-css.liquid` from installed section CSS policies.
8. Run theme build so Vite emits `css.output` into `assets/`.
9. Update theme lockfile.

## Components

Current components:

- `core`
- `c-button`
- `c-video`
- `c-marquee`
- `s-announcement`
- `s-hero`
- `s-social-video-gallery`
