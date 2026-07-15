# Climatic Health migration audit

Target repo: `/Users/fedori/Coding/hyuman/climatic-health`  
Scope: audit only; no target repo changes.

## Verdict

A move from Climatic Health to upstream Nazare is **more compelling than Alkamind**, but still should be staged.

Unlike Alkamind, Climatic Health has a simpler/older asset system: Gulp + SCSS, committed minified JS, global scripts, no module-level island runtime, no explicit Shopify section lifecycle handling, and no generated dependency graph. Upstream Nazare would provide clearer advantages here: component contracts, safer render calls, schema/merchant-data protection, ownership guardrails, and a path away from manual JS/CSS conventions.

Full migration is still risky because the theme has many large Liquid files, a large global JS surface, many schema/settings references, and product/cart flows tied to existing selectors.

Best path: **selective adoption first**, starting with small snippets and low-risk sections.

## What Climatic Health already has

Observed shape:

- 53 section Liquid files.
- 49 snippet Liquid files.
- 120 Liquid files in sections/snippets/templates/layout.
- 245 static `{% render %}` calls.
- 0 dynamic render calls found in scan.
- 53 section schemas.
- 521 settings references.
- 96 SCSS files.
- 21 files in `assets/`.
- 6 committed minified asset files.
- 5 custom element definitions in JavaScript.
- 23 inline `<script>` occurrences in Liquid.
- 7 cart API references.

Largest files:

- Sections:
  - `sections/s-features.liquid` — 479 lines.
  - `sections/product-hero.liquid` — 425 lines.
  - `sections/article-modules.liquid` — 419 lines.
  - `sections/account-gate.liquid` — 413 lines.
  - `sections/s-early-access-form-2.liquid` — 408 lines.
- Snippets:
  - `snippets/c-item-variants.liquid` — 502 lines.
  - `snippets/c-account-address-form.liquid` — 368 lines.
  - `snippets/c-product-form.liquid` — 292 lines.
  - `snippets/c-line-item.liquid` — 290 lines.
  - `snippets/c-product-filters-sort.liquid` — 281 lines.

Existing build/dev system:

- `npm run build`: `gulp build`.
- `npm run watch`: Gulp SCSS watcher.
- `npm run dev`: `shopify theme dev --store ibtwn9-bd`.
- SCSS entrypoints:
  - `styles/main.scss` -> `assets/main.min.css`.
  - `styles/preload.scss` -> `assets/preload.min.css`.
- CSS minification via `cssnano`.
- JS is vanilla ES6 in `assets/`; source and `.min.js` files are committed.
- README still mentions MinifyAll / VS Code-based JS minification.
- Layout manually preloads and loads CSS/JS.

Existing frontend architecture:

- Global scripts: `__preload`, `__preload-defer`, `js-shopify`, `js-main`.
- Third-party plugins: lazysizes, reframe, Embla, Vimeo, YouTube, Motion, Klaviyo, Okendo.
- Some custom elements, e.g. accordion.
- Large global selector-driven JavaScript surface.
- Cart/product behavior in global JS and Liquid data attributes.

## What upstream Nazare improves

Clear current advantages:

- Typed props for snippets/sections instead of implicit locals.
- Static validation for 245 render calls.
- Better missing/extra/wrong-typed argument diagnostics.
- Import graph and component contracts.
- Safer refactors for reused snippets like product forms, cards, media, accordions.
- Schema-lock drift detection across 53 schemas.
- Merchant-data migrations for setting/block renames/removals.
- Locale merge baseline.
- Output ownership manifest and overwrite protection.
- Cleaner registry/package story for reusable primitives.
- Potential migration away from manually committed `.min.js` workflow.

These advantages are stronger here than in Alkamind because Climatic Health does not already have a custom component graph, module runtime, generated preload map, or asset ownership model.

## Cons of full migration now

- High Liquid migration cost: 53 sections, 49 snippets, many large files.
- Very high schema/settings blast radius: 53 schemas and 521 settings references.
- Product/cart risk: product form, variants, selling plans, line items, cart, minicart, and upsell flows depend on existing Liquid/JS selectors.
- Global JS risk: `assets/js-main.js` and `assets/js-shopify.js` are large selector-driven files; cutting them into islands is non-trivial.
- Inline script cleanup needed: layout/sections/snippets contain inline scripts that would not automatically become Nazare islands.
- SCSS mismatch: current theme uses SCSS partials, mixins, variables, and two global CSS entrypoints; upstream Nazare is not an SCSS pipeline replacement.
- Committed minified JS workflow mismatch: upstream Nazare expects compiler/build ownership, while this repo commits source + minified JS.
- Third-party integration risk: Klaviyo, Okendo, Motion, lazysizes, Embla, Vimeo, YouTube must be preserved exactly.
- Custom element lifecycle mismatch: existing custom elements use browser lifecycle, not Nazare island conventions.
- Shopify editor lifecycle not currently handled explicitly; adding generated/runtime behavior may expose bugs that existing global JS hid.
- Generated output mismatch risk: Liquid ordering, schema JSON, and layout asset tags may change.
- No visual regression safety found in repo.

## Where upstream Nazare would help most

Good candidates for selective adoption:

- `snippets/c-media.liquid`: reusable media API; contract would reduce image/video argument mistakes.
- `snippets/c-img-srcset.liquid`: clear typed utility candidate.
- `snippets/c-item-price.liquid`: small pricing contract candidate.
- `snippets/c-accordion.liquid`: reusable markup with JS behavior; good island pilot after runtime parity.
- `snippets/c-search-form.liquid`: small, contained form component.
- `snippets/c-article-card.liquid`: reusable card component.
- `sections/s-banner.liquid`: likely lower-risk content section.
- `sections/s-banner-text.liquid`: likely lower-risk content section.
- `sections/s-certification.liquid` / `sections/s-certifications.liquid`: structured content candidates.
- `sections/s-stats.liquid`: structured content candidate.

Avoid early migration:

- `sections/product-hero.liquid`.
- `sections/g-minicart.liquid`.
- `sections/cart-content.liquid`.
- `sections/collection-content.liquid`.
- `sections/account-gate.liquid`.
- `snippets/c-product-form.liquid`.
- `snippets/c-item-variants.liquid`.
- `snippets/c-line-item.liquid`.
- `snippets/c-cart.liquid`.
- `assets/js-shopify.js` / cart and variant systems.

## Required clear advantages before full migration

For upstream Nazare to clearly beat this repo, it should provide:

1. **SCSS/global asset compatibility**
   - Keep or replace SCSS partial workflow.
   - Support global CSS entrypoints like `preload` and `main`.
   - Minify CSS without manual Gulp ceremony.
   - Preserve asset preload ordering in `layout/theme.liquid`.

2. **JS modernization path**
   - Replace committed `.min.js` workflow with deterministic build output.
   - Allow gradual splitting of global JS into islands.
   - Preserve third-party plugin loading and globals.
   - Support island teardown and Shopify editor section reloads.

3. **Contract wins over implicit Liquid locals**
   - Typed props for reused snippets.
   - Static render argument checks.
   - Useful diagnostics on product/card/media/form components.
   - Source spans good enough for large Liquid files.

4. **Merchant-data safety**
   - Schema-lock drift reports.
   - Migrations for setting/block renames/removals.
   - Locale merge baseline.
   - Store-schema checks when `pull-schema` lands.

5. **Low-blast-radius coexistence**
   - Mix `.nz.liquid` components with existing `.liquid` sections/snippets.
   - Keep existing SCSS/JS initially.
   - Avoid forcing rewrite of layout and global scripts on day one.
   - Make output diffs reviewable.

6. **Regression protection**
   - Theme Check integration.
   - Render checks or visual regression for key templates.
   - Safe generated-output ownership.

## Recommended plan

Do not do full migration in one pass.

Stage adoption:

1. Keep current Shopify + Gulp workflow initially.
2. Pilot upstream Nazare on utility snippets:
   - `c-img-srcset`
   - `c-item-price`
   - `c-media`
3. Add one low-risk content section:
   - `s-banner-text`
   - `s-certification`
   - `s-stats`
4. Compare generated Liquid output and section editor behavior.
5. Introduce schema-lock/migrations for migrated sections.
6. Only then pilot behavior components like `c-accordion`.
7. Leave cart/product/variant flows until runtime/dev-server and JS-island migration story are stronger.

## Product lesson for Nazare

Climatic Health shows a different opportunity than Alkamind.

Alkamind already has a strong custom island/build system, so Nazare must beat it on parity + safety.

Climatic Health has a more traditional Shopify stack: global SCSS, global JS, committed minified assets, manual conventions. Nazare can provide clearer value by becoming the safer modernization path:

- turn implicit snippet APIs into checked contracts;
- protect merchant schemas/settings during refactors;
- replace manual minification/build conventions over time;
- gradually split global JS into lifecycle-aware islands;
- preserve Shopify theme output while making large themes refactorable.

If Nazare supports coexistence with existing SCSS/JS and delivers contract/schema safety, migration becomes compelling for Climatic Health earlier than for Alkamind.
