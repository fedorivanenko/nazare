# Theme graph semantic model plan

## Product definition

Nazare Inspect generates a deterministic semantic model of a Shopify theme.

It reconstructs the theme architecture, data dependencies, component interfaces, configuration, capabilities, and change impact from ordinary Liquid source code. AI may consume the model, but AI must not be required to create it.

## Goal

Transform the current theme graph from a map of files and render relationships into a semantic model of a Shopify theme.

The graph should explain:

- what the theme contains;
- how templates, sections, snippets, blocks, settings, assets, layouts, and locales relate;
- what Shopify data each part uses;
- how render inputs flow;
- what configuration controls;
- what storefront concepts/capabilities exist;
- what may be affected by a change;
- why each important relationship/classification exists.

## Current status

Implemented foundation:

- Theme files/declarations:
  - templates;
  - sections;
  - snippets;
  - assets;
  - layouts;
  - locales.
- Theme references:
  - render snippet;
  - contains section;
  - imports component;
  - references assets where known.
- Template JSON section instances:
  - `sectionInstance` nodes;
  - `templateContainsSectionInstance` edges;
  - `instanceOf` edges.
- Schema/settings:
  - schema nodes;
  - setting nodes;
  - setting read records/edges.
- Shopify data access foundation:
  - `shopifyObject` nodes;
  - `shopifyProperty` nodes;
  - `accessesData` edges.
- Render argument foundation:
  - `renderArgument` nodes;
  - `passesArgument` edges;
  - basic source object/property capture.
- Basic deterministic capabilities:
  - `displaysProductPrice`;
  - `displaysProductMedia`;
  - `displaysCartItems`;
  - `usesCart`;
  - `usesSearch`;
  - `displaysRecommendations`;
  - `usesLocalization`.
- Uncertainty handling foundation:
  - unresolved references;
  - ambiguous references;
  - duplicate declarations.

Estimated spec coverage: 80–90% after implementation through commit `8b2a1f1`.

Implemented since this note was created:

- render input inference;
- missing/unknown/inconsistent render input diagnostics;
- evidence records;
- page composition nodes;
- block and block setting nodes;
- asset filter references;
- locale key extraction and references;
- action capabilities;
- storefront classifications;
- impact summary;
- graph view indexes.

Known remaining gaps:

- scanner still uses deterministic regex foundations for some Liquid facts; final robustness should move more extraction to Liquid AST traversal;
- block instances from runtime dynamic Liquid loops are not fully reconstructed;
- setting-to-controlled-component influence is partial, based on reads, not full control-flow slicing;
- classifiers are deterministic but intentionally conservative; more Shopify patterns should be added over time.

## Target requirements

### 1. Represent theme structure

The graph must represent:

- templates;
- sections;
- snippets;
- blocks;
- settings;
- assets;
- layouts;
- locales.

It must show how these elements contain, render, reference, or depend on one another.

### 2. Represent Shopify data usage

The graph must identify which parts of the theme use Shopify concepts such as:

- products;
- variants;
- collections;
- cart;
- customer;
- search;
- recommendations;
- localization;
- metafields;
- metaobjects.

It should support both object-level and property-level usage.

Examples:

```text
Product card uses Product
Price component reads Product.price
Cart drawer uses Cart.items
```

### 3. Represent component inputs

For every rendered snippet or component, the graph must identify:

- which arguments are passed to it;
- which inputs it expects;
- which inputs appear required;
- where input values originate;
- inconsistent usage across render sites.

### 4. Represent configuration

The graph must connect sections and blocks to their schema settings.

It must show:

- which settings exist;
- which settings are read;
- which Shopify resources they select;
- which settings influence particular components or behaviour.

### 5. Represent pages as compositions

The graph must describe each storefront page as a composition of sections and components.

Examples:

```text
Product page
  → Product gallery
  → Product information
  → Product form
  → Recommendations
```

It must distinguish between a reusable section type and an instance of that section on a page.

### 6. Recognize storefront concepts

The graph should identify common storefront concepts when sufficient evidence exists.

Examples:

- product card;
- product form;
- collection grid;
- cart drawer;
- search overlay;
- navigation;
- product gallery;
- recommendations;
- localization selector.

Classifications must expose:

- confidence;
- supporting evidence;
- uncertainty.

The graph must not present uncertain classifications as facts.

### 7. Represent capabilities

The graph must identify what components do, independently of how they are named.

Examples:

- displays product price;
- displays media;
- selects variants;
- adds items to cart;
- updates cart;
- performs predictive search;
- filters collections;
- switches localization.

A component may expose several capabilities.

### 8. Support impact analysis

The graph must answer:

- what uses this component;
- what this component depends on;
- which pages contain it;
- which components use a Shopify object;
- what may be affected by changing or removing it;
- whether an artifact appears unused.

### 9. Preserve evidence

Every important relationship or classification must be explainable from the source theme.

The graph must be able to answer:

```text
Why does Nazare believe this?
```

The answer should point to the relevant file, expression, render call, schema setting, or template configuration.

### 10. Handle uncertainty

The graph must support:

- unresolved dynamic renders;
- ambiguous variables;
- incomplete themes;
- conflicting component inputs;
- uncertain classifications.

Unknown information must remain explicitly unknown rather than being guessed.

### 11. Work with plain Shopify themes

The graph must work with ordinary Shopify Liquid themes without requiring:

- Nazare syntax;
- type annotations;
- configuration changes;
- AI services.

Nazare-specific information may enrich the graph when available.

### 12. Produce a stable canonical graph

The same unchanged theme must produce the same graph.

The graph must avoid duplicate representations of the same file, asset, component, or Shopify concept.

### 13. Support multiple views

The same graph must support at least these views:

#### Theme structure

```text
Template → Section → Snippet → Asset
```

#### Shopify data

```text
Product → Components that use Product
```

#### Storefront architecture

```text
Page → User-facing components
```

#### Configuration

```text
Section → Setting → Controlled component
```

#### Change impact

```text
Changed artifact → Dependent components → Affected pages
```

## Core queries

The completed graph must answer:

```text
What renders this snippet?
What does this section depend on?
Which pages use this component?
Which components access the cart?
Where is Product.price used?
Which setting controls this behaviour?
Which arguments does this snippet expect?
Which render calls are inconsistent?
Which components are probably product cards?
Why was this component classified that way?
What may break if this file changes?
Which artifacts appear unused?
```

## Architecture principle

Do not patch graph JSON directly.

Maintain this pipeline:

```text
source files → fact collectors → ThemeSemanticModel IR → graph projection/views
```

The canonical source of truth is `ThemeSemanticModel`. `theme-graph.json` is a projection for query/visualization.

## Build plan

### Phase 1 — Input/interface inference

Goal: answer render input questions.

Add:

- `ThemeExpectedInputRecord`
- `ThemeRenderSiteRecord`
- `ThemeInputUsageRecord`
- diagnostics:
  - `THEME_RENDER_ARGUMENT_MISSING`
  - `THEME_RENDER_ARGUMENT_UNKNOWN`
  - `THEME_RENDER_ARGUMENT_INCONSISTENT`

Extract:

- named render args from `{% render 'snippet', key: value %}`;
- snippet variable reads that imply expected inputs;
- required/optional inference from guarded usage/default patterns;
- source origin for each passed argument.

### Phase 2 — Evidence model

Goal: every edge/classification can answer “why”.

Add:

- `ThemeEvidenceRecord`
- evidence ids on references, data accesses, setting reads, capabilities, classifications, render args.

Evidence shape:

```ts
{
  id: string;
  kind: "span" | "templateConfig" | "schemaSetting" | "renderCall" | "dataRead";
  file: string;
  span?: SourceSpan;
  source?: string;
  extractor: string;
}
```

### Phase 3 — Blocks and configuration graph

Goal: represent section/block schema and setting control.

Add:

- block declarations from section schema;
- block instances where discoverable;
- section/block setting definitions;
- setting resource kinds from schema type:
  - `product`, `collection`, `url`, `image_picker`, etc.;
- setting → read → component influence edges.

### Phase 4 — Page composition

Goal: user-facing storefront architecture.

Add:

- `page` nodes derived from template file names/types;
- page → template → sectionInstance → section declaration;
- optional page type classification:
  - product page;
  - collection page;
  - cart page;
  - search page;
  - index page.

### Phase 5 — Capability rule engine

Goal: identify behavior independently of names.

Expand deterministic rules for:

- add to cart:
  - forms posting to `/cart/add`, `routes.cart_add_url`, variant id fields;
- update cart:
  - `/cart/change`, `/cart/update`, quantity inputs;
- variant selection:
  - variant option inputs/selectors, `product.variants`, selected variant reads;
- predictive search:
  - predictive search routes/APIs;
- collection filtering:
  - `filter`, `facets`, collection filter params;
- localization switching:
  - localization forms/selectors;
- media gallery:
  - product media iteration, thumbnails, media ids.

Each capability must include confidence and evidence ids.

### Phase 6 — Storefront concept classifiers

Goal: classify product card/form/cart drawer/search overlay/etc. without pretending uncertainty is fact.

Add:

- `ThemeClassificationRecord`
- labels:
  - `productCard`
  - `productForm`
  - `collectionGrid`
  - `cartDrawer`
  - `searchOverlay`
  - `navigation`
  - `productGallery`
  - `recommendations`
  - `localizationSelector`

Each classification:

```ts
{
  id: string;
  targetId: string;
  label: string;
  confidence: number;
  evidenceIds: string[];
  uncertainty: string[];
}
```

### Phase 7 — Impact and unused analysis

Goal: change-safety queries.

Add derived analysis/helpers:

- reverse dependency index;
- page containment index;
- data usage index;
- unused artifact detector;
- possible breakage set for changed file/component/setting.

Queries:

- what uses this component;
- what this component depends on;
- which pages contain it;
- which components use Shopify object/property;
- what may break if file changes;
- which artifacts appear unused.

### Phase 8 — Stable views/API

Goal: expose multiple deterministic views from same model.

Add view builders:

- theme structure view;
- Shopify data view;
- storefront architecture view;
- configuration view;
- change impact view.

Keep `inspectNazareTheme()` backwards-compatible if possible, or version output explicitly.

## Notes / constraints

- No AI-generated facts in compiler output.
- Regex scanner is acceptable only as a stepping stone; final data/input extraction should prefer Liquid AST where possible.
- Unknown/dynamic values must remain explicit.
- Avoid hidden defaults and silent fallbacks.
- Preserve stable IDs and sorted output.
