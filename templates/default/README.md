<h1 align="center">Nazare</h1>

Empty Nazare Shopify theme template built with Liquid, Tailwind CSS v4, Vite, Reef, and pnpm.

## Stack

- Shopify Liquid
- Tailwind CSS v4
- Vite
- Reef
- pnpm

## Scripts

```bash
pnpm dev            # node tooling/dev.mjs
pnpm dev:protected  # node tooling/dev.mjs --protected
nazare list         # list registry components
nazare pull         # pull registry components
pnpm watch          # vite build --watch
pnpm build          # vite build
```

## Store setup

Copy `.example.env` to `.env` and set:

```bash
SHOPIFY_STORE_URL=nazare-xf2l9xoq
SHOPIFY_STORE_PASSWORD=your-store-password
```

Then run:

```bash
pnpm dev
```

If store is password protected:

```bash
pnpm dev:protected
```

Shopify CLI can also take full domain:

```bash
shopify theme dev --store your-store.myshopify.com
```

## Theme structure

Shopify theme files stay in the plain Shopify root structure:

- `assets/`
- `config/`
- `layout/`
- `locales/`
- `sections/`
- `snippets/`
- `templates/`

Build inputs stay in theme root folders:

- `styles/base.css` -> `assets/base.css`
- `scripts/theme.js` -> `assets/theme.js`

Section CSS is loaded through generated `snippets/section-css.liquid`. Above-the-fold sections can preload CSS; other sections use normal stylesheet loading.

## Registry config

- `nazare.config.yml` points to registry repo/ref/manifest.
- `nazare.lock.yml` records installed registry components.
- Registry owns component source and metadata.
- Theme owns generated CSS entry files and compiled `assets/` output.

Generated CSS entries use Tailwind `@source` directives. Vite scans `styles/*.css` and emits matching files into `assets/`.

Pull components:

```bash
nazare list
nazare pull s-hero
nazare pull s-social-video-gallery --yes
```

The registry CLI checks existing files and asks before overriding changed files. Use `--dry-run` to preview writes.

## Notes

- Use `pnpm`, not `npm` or `yarn`.
- `pnpm watch` rebuilds assets only; Shopify CLI handles theme dev separately.
- Tailwind content scan is explicit in each CSS file using `@source`.
