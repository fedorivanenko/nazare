# Alkamind migration audit

Target repo: `/Users/fedori/Coding/hyuman/alkamind/alkamind-nazare`  
Scope: audit only; no target repo changes.

## Verdict

A full move from the existing Alkamind theme build system to current upstream Nazare would **not be a clear net improvement today**.

Alkamind already has many roadmap features that upstream Nazare has not shipped yet: asset watching, Tailwind v4 scanning, JS code splitting, preload generation, lazy hydration, Shopify section lifecycle hooks, and module teardown.

Best path: **selective adoption**. Upstream Nazare must provide clear advantages over the previous repo before a full migration makes sense.

## What Alkamind already has

Observed shape:

- 53 section Liquid files.
- 60 snippet Liquid files.
- 241 static `{% render %}` calls.
- 0 dynamic render calls found in scan.
- 54 CSS files.
- 39 JavaScript files.
- 38 `data-nazare-use` mounts.
- 53 section schemas.
- 306 settings references.

Existing custom system includes:

- `pnpm dev`: asset watcher + `shopify theme dev`.
- `pnpm build`: production asset build.
- Tailwind v4 compiler/scanner via `@tailwindcss/node` and `@tailwindcss/oxide`.
- Global `assets/base.css` output.
- esbuild bundling, splitting, minify, sourcemaps.
- Generated `scripts/theme.js` runtime.
- `data-nazare-use="sections/...|snippets/...|behaviors/..."` module mounting.
- `data-nazare-lazy` lazy hydration with `IntersectionObserver`.
- `shopify:section:load` / `shopify:section:unload` lifecycle hooks.
- `init()` / `destroy()` module lifecycle convention.
- Generated `snippets/preload-js.liquid` for modulepreload.
- Generated `layout/theme.liquid` from `layout/theme.source.liquid`.
- Generated `config/settings_schema.json` from split settings files.
- Public asset copy into Shopify `assets/`.
- Manifest-based generated asset cleanup.

## What upstream Nazare improves

Clear current advantages:

- Typed component props instead of implicit Liquid locals.
- Render contract validation across components.
- Better diagnostics around missing/extra/wrong-typed props.
- Component import graph as compiler artifact.
- Schema generation from component contracts.
- Schema-lock drift detection.
- Merchant-data migrations for renamed/removed section settings/blocks.
- Locale merge baseline.
- Output ownership manifest and overwrite guardrails.
- Registry packaging/install/update/diff/publish flow.
- Reusable component distribution model.

These are real advantages, but mostly **safety and maintainability**, not asset/runtime/dev-loop improvements.

## Cons of full migration now

- Runtime regression: Alkamind already has lazy hydration, Shopify section lifecycle, teardown, and dynamic module loading; upstream Nazare runtime is not yet at parity.
- Asset pipeline regression: Alkamind already has Tailwind v4 scanning, esbuild splitting, minify, sourcemaps, and preload mapping; upstream Nazare does not replace this cleanly yet.
- Dev loop regression: Alkamind has a working watcher + Shopify dev loop; upstream `nazare dev` is still roadmap work.
- High migration cost: 113 Liquid component files, many large and store-specific.
- Complex product behavior risk: mini-cart, PLP filtering/sorting, purchase options, product cards, ratings, and galleries depend on existing conventions.
- Tailwind extraction risk: repo uses dynamic classes and `@source inline()` workarounds; generated-output changes could drop classes.
- Schema migration risk: 53 section schemas and many merchant settings references mean full conversion can break saved storefront data if not staged.
- Duplicated abstraction risk: upstream Nazare would overlap with the custom `nazare/build/*` system instead of replacing it cleanly.
- Generated output mismatch risk: small Liquid/schema/runtime differences may cause visual or editor regressions.
- Registry value is limited initially: many components are brand/store-specific rather than generic reusable catalog items.
- Short-term developer UX may not improve: main gain is contracts, while existing dev/build workflow is already strong.
- Upstream churn risk: Nazare APIs/file formats are still under active development.

## Where upstream Nazare would help most

Good candidates for selective adoption:

- `snippets/c-button.liquid`: small, reused, implicit prop-like locals.
- `snippets/c-badge.liquid`: small primitive, good contract candidate.
- `snippets/c-heading.liquid`: typography primitive, high reuse.
- `snippets/c-media.liquid`: reusable media contract.
- `snippets/c-carousel.liquid`: reusable behavior+markup contract, but watch Tailwind dynamic classes.
- `sections/s-trust-bar.liquid`: lower-risk section.
- `sections/s-hero.liquid`: good schema/props example, moderate complexity.

Avoid early migration:

- `snippets/c-mini-cart.liquid` and `scripts/snippets/c-mini-cart.js`.
- `snippets/c-product-family-card.liquid`.
- `sections/s-plp-grid.liquid`.
- `sections/s-product-hero.liquid`.
- Purchase-option/bundle flows.

## Required clear advantages before full migration

For upstream Nazare to beat the previous repo, it should provide these advantages without losing existing strengths:

1. **Runtime parity or better**
   - `data-nazare-use`-equivalent island mounting.
   - Lazy strategies: load/idle/visible/interaction.
   - Shopify section load/unload handling.
   - Teardown/disposer support.
   - Code-on-demand per island/module.

2. **Asset pipeline parity or better**
   - Tailwind v4 scanning support for Liquid + generated sources.
   - JS code splitting and modulepreload hints.
   - CSS/JS minify and sourcemaps.
   - Public asset copy.
   - Generated asset cleanup/ownership.

3. **Dev-loop parity or better**
   - `nazare dev` watcher.
   - Incremental rebuild.
   - No baseline churn during dev.
   - Smooth `shopify theme dev` integration.

4. **Contract wins that current repo cannot provide**
   - Typed props for snippets/sections.
   - Static validation for render args.
   - Better diagnostics with source spans.
   - Safer refactors for props/settings.

5. **Merchant-data safety**
   - Schema-lock drift reports.
   - Migrations for setting/block renames/removals.
   - Locale merge baseline.
   - Pull/check against live Shopify schema eventually.

6. **Migration path with low blast radius**
   - Ability to mix generated `.nz.liquid` components with existing Liquid.
   - No forced rewrite of asset/runtime system at first.
   - Output diff small enough to review.
   - Visual regression path for large sections.

## Recommended plan

Do not do full migration now.

Stage adoption:

1. Keep Alkamind custom build/runtime.
2. Pilot upstream Nazare on primitives: `c-button`, `c-badge`, `c-heading`.
3. Add one low-risk section: `s-trust-bar` or `s-hero`.
4. Compare generated Liquid output and Shopify editor behavior.
5. Measure value of prop diagnostics and schema-lock drift.
6. Only migrate complex AJAX/cart/product flows after upstream runtime/dev-server phases reach parity.

## Product lesson for Nazare

Nazare must not merely be another Shopify asset builder. Alkamind proves teams can already build a good bespoke pipeline.

Nazare's clear advantage should be:

- **Contracts**: make Liquid component APIs explicit and checked.
- **Safety**: protect merchant state, schemas, locales, ownership.
- **Refactorability**: make large Shopify themes easier to change safely.
- **Runtime ergonomics**: islands and Shopify section lifecycle without custom glue.
- **Distribution**: registry components as editable source.

If Nazare can keep Alkamind's runtime/dev/asset strengths while adding contracts and merchant-data safety, migration becomes compelling.
