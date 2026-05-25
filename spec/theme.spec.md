# Nazare Theme Spec

## Purpose

Minimal Shopify Liquid theme scaffold for Nazare registry components.

Nazare theme is section-oriented. Each section is treated as a component with:

- a `.liquid` section file in `sections/`
- static Liquid snippet dependencies via `{% render 'snippet-name' %}`
- Tailwind utility classes in Liquid markup
- optional JS mount nodes declared through `data-nazare-use`
- optional section CSS load policy declared through a Nazare Liquid comment directive

## Component conventions

Sections:
`sections/<section-name>.liquid`
`scripts/sections/<section-name>.js`

Snippets:
`snippets/<snippet-name>.liquid`
`scripts/snippets/<snippet-name>.js`

Runtime JS module keys use source-like names:
`sections/s-hero`
`snippets/c-video`

## Nazare metadata

Nazare uses two different metadata channels:

- `data-nazare-use` on arbitrary HTML elements for runtime JS mounts
- `{% comment %} nazare:css <mode> {% endcomment %}` in section files for build-time CSS load policy

### JS mount attribute

Supported attribute:

- `data-nazare-use="<module-key>"`

Allowed locations:

- any HTML element in `sections/*.liquid`
- any HTML element in `snippets/*.liquid`

Defaults:

- missing `data-nazare-use` means no JS chunk for that element

### CSS directive

Supported directive syntax:

```liquid
{% comment %} nazare:css normal {% endcomment %}
{% comment %} nazare:css preload {% endcomment %}
```

Rules:

- only valid in `sections/*.liquid`
- applies to whole section CSS chunk
- must appear before first rendered output in the section file
- duplicate directives in one section file are errors
- invalid values are errors
- missing directive means `normal`

## Minimal section example

```liquid
{% comment %} nazare:css preload {% endcomment %}
{% render 'section-css', section_name: 's-hero' %}

<section class="px-6 py-12">
  <div data-nazare-use="sections/s-hero">
    <h1 class="text-4xl font-bold">{{ section.settings.heading }}</h1>
    {% render 'c-button', label: section.settings.button_label %}
  </div>
</section>
```

This example defines `sections/s-hero.liquid`, uses Tailwind utilities in markup, statically depends on `snippets/c-button.liquid`, declares section CSS chunk load mode as `preload`, renders the generated section CSS bridge, and exposes a runtime mount node through `data-nazare-use="sections/s-hero"`.

## Build-time behavior

Tailwind utilities, Nazare CSS directives, Nazare JS mount attributes, and static `{% render %}` calls are build-time inputs.

The Nazare Vite plugin is the authority for validating local theme build graph metadata and local module mappings.

This example outputs:

- CSS output: `assets/s-hero.css`, which includes Tailwind utilities used by `sections/s-hero.liquid` and its static snippet dependency `snippets/c-button.liquid`
- JS output: lazy-loaded section chunk `assets/sections--s-hero.js`, referenced by global runtime `assets/theme.js`
- CSS preload mapping: `s-hero` maps to `assets/s-hero.css` in `snippets/section-css-preloads.liquid`
- CSS runtime mapping: non-preloaded section CSS chunks map through `snippets/section-css.liquid`

The Nazare Vite plugin scans local `.liquid` files, follows static `{% render %}` references, extracts `data-nazare-use` attributes and section CSS directives, checks section CSS bridge usage, and generates Liquid bridge snippets for compiled section CSS chunks.

## Build scanner algorithm

For each `sections/*.liquid` file, plugin:

1. reads section source
2. extracts section CSS mode from `{% comment %} nazare:css <mode> {% endcomment %}` if present
3. extracts all `data-nazare-use` module keys from the section file
4. extracts static `{% render 'snippet-name' %}` references
5. recursively scans each referenced `snippets/<snippet-name>.liquid`
6. extracts all `data-nazare-use` module keys from referenced snippet files
7. adds section file and all static snippet dependencies as Tailwind scan sources for that section CSS entry
8. creates CSS entry `styles/<section-name>.css`
9. maps CSS output to `assets/<section-name>.css`
10. maps every discovered JS module key to `scripts/<module-key>.js`

Generated CSS entry example for `styles/s-hero.css`:

```css
@import "tailwindcss/theme" source(none);
@import "tailwindcss/utilities" source(none);

@source "../sections/s-hero.liquid";
@source "../snippets/c-button.liquid";
```

## Scanner rules

### Static render graph

Supported static render forms:

```liquid
{% render 'c-button' %}
{% render "c-button" %}
{% render 'c-button', label: section.settings.label %}
{% render "c-button", foo: bar %}
```

Rules:

- static render with string-literal snippet name is supported
- dynamic render is not supported: `{% render snippet_name %}`
- nested static snippet renders are followed recursively
- duplicate snippet visits are deduplicated per section traversal
- render cycles are detected and reported as errors
- missing snippets are reported as errors

Dynamic render usage produces a warning and is not followed.

### JS mount scanning

Rules:

- `data-nazare-use` may appear on any HTML element in sections or snippets
- multiple mount nodes per file are allowed
- repeated use of same module key across many nodes is allowed
- discovered module keys are deduplicated for build input purposes
- missing JS modules declared by `data-nazare-use` are reported as errors

### JS module key validation

Allowed examples:

- `sections/s-hero`
- `snippets/c-video`

Rules:

- value must be non-empty
- value must not start with `/`
- value must not end with `.js`
- value must not contain `..`
- value must start with `sections/` or `snippets/`

### CSS directive parsing

Rules:

- only one `nazare:css` directive is allowed per section file
- directive is only valid before first rendered output in section file body
- directive is invalid in snippet files
- allowed values are `normal` and `preload`
- missing directive defaults to `normal`

For directive placement, allowed content before the directive:

- whitespace
- Liquid comments: `{% comment %} ... {% endcomment %}`
- HTML comments: `<!-- ... -->`
- non-output Liquid control tags such as `{% assign ... %}`, `{% capture ... %}`, `{% liquid ... %}`, `{% if ... %}`, and `{% unless ... %}`

Content that makes a directive too late:

- first HTML element start tag, such as `<section>` or `<div>`
- Liquid output tags, such as `{{ ... }}`
- Liquid render/output-producing tags, such as `{% render ... %}`
- raw text that would render to the page

Shopify `{% schema %}` blocks are ignored for directive placement and are expected at the end of section files.

### Section CSS bridge render

Every section file should render the generated normal CSS bridge near the top of the section file:

```liquid
{% render 'section-css', section_name: '<section-name>' %}
```

For `sections/s-hero.liquid`, expected usage is:

```liquid
{% render 'section-css', section_name: 's-hero' %}
```

This render lets sections with `nazare:css normal` load their compiled CSS only when the section appears on a page.

Sections with `nazare:css preload` may still include this render. The generated `section-css.liquid` snippet emits no output for preload sections, because preload CSS is handled by `section-css-preloads.liquid` in the layout.

Missing section CSS bridge render is a plugin warning in v1, not a build error. The theme may intentionally load CSS through another mechanism.

## Generated file lifecycle

The Nazare Vite plugin generates these derived files in the theme repo working tree:

- `styles/<section-name>.css`
- `scripts/theme.js`
- `snippets/section-css.liquid`
- `snippets/section-css-preloads.liquid`

These files are not user-owned. Manual edits are unsupported and may be overwritten at any time by the plugin.

V1 does not require a specific git policy for generated files. They may be committed or gitignored depending on project preference.

Plugin regeneration occurs when:

- dev server starts
- build starts
- relevant section or snippet Liquid files change
- relevant generated output inputs change
- section files are added or removed
- snippet dependency graph changes

Plugin must clean up stale generated files when they are no longer needed.

Examples:

- remove generated `styles/<section-name>.css` when its source section no longer exists
- rewrite `scripts/theme.js` when discovered module keys change
- rewrite `snippets/section-css.liquid` when section CSS mode mappings change
- rewrite `snippets/section-css-preloads.liquid` when preload mappings change

If plugin cannot write required generated files, dev and build must fail.

## Vite integration

The Nazare Vite plugin provides build inputs:

- `styles/base.css`
- generated `styles/<section-name>.css` entries
- `scripts/theme.js`
- lazy JS modules discovered from `data-nazare-use`

Vite emits:

- `assets/base.css`
- `assets/<section-name>.css`
- `assets/theme.js`
- lazy JS chunks such as `assets/sections--s-hero.js`
- lazy JS chunks for snippets such as `assets/snippets--c-video.js`

Stable output names are part of the Nazare Vite config contract.

V1 output naming rules:

- generated asset filenames do not use content hashes
- section CSS output uses `assets/<section-name>.css`
- runtime entry uses `assets/theme.js`
- lazy JS chunk output uses `assets/<module-key>.js` after replacing `/` with `--`

Examples:

- `sections/s-hero` -> `assets/sections--s-hero.js`
- `snippets/c-video` -> `assets/snippets--c-video.js`

This avoids collisions between section and snippet module names that share the same leaf filename.

## Generated Liquid bridge snippets

### `snippets/section-css.liquid`

Generated snippet for normal CSS loading:

```liquid
{% comment %}
  Generated by Nazare. Do not edit directly.
{% endcomment %}

{% case section_name %}
  {% when 's-social-video-gallery' %}
    {{ 's-social-video-gallery.css' | asset_url | stylesheet_tag }}
{% endcase %}
```

Sections with `nazare:css normal` or no directive are expected to render this snippet through the generated Nazare integration contract:

```liquid
{% render 'section-css', section_name: 's-social-video-gallery' %}
```

### `snippets/section-css-preloads.liquid`

Generated snippet for preload CSS loading:

```liquid
{% comment %}
  Generated by Nazare. Do not edit directly.
{% endcomment %}

{{ 's-hero.css' | asset_url | stylesheet_tag: preload: true }}
```

Theme layout renders this snippet in `<head>`:

```liquid
{% render 'section-css-preloads' %}
```

## Runtime behavior

`data-nazare-use` is the runtime JS mount marker.

At runtime, `assets/theme.js` scans for `[data-nazare-use]`, lazy-loads the matching JS module once, and calls its `init(node)` export once for every matching section or snippet instance.

```js
const modules = {
  ...import.meta.glob("./sections/*.js"),
  ...import.meta.glob("./snippets/*.js"),
};
const modulePromises = new Map();
const mounted = new WeakMap();

async function importModule(key) {
  const load = modules[`./${key}.js`];

  if (!load) {
    console.warn(`[nazare] Missing JS module for ${key}`);
    return null;
  }

  try {
    return await load();
  } catch (error) {
    console.warn(`[nazare] Failed to import JS module for ${key}`, error);
    return null;
  }
}

function nazareNodes(root) {
  const selector = "[data-nazare-use]";
  const nodes = [...root.querySelectorAll(selector)];

  if (root.matches?.(selector)) {
    nodes.unshift(root);
  }

  return nodes;
}

export async function initNazare(root = document) {
  for (const node of nazareNodes(root)) {
    const key = node.dataset.nazareUse;

    if (mounted.get(node)?.key === key) continue;

    if (!modulePromises.has(key)) {
      modulePromises.set(key, importModule(key));
    }

    const module = await modulePromises.get(key);
    if (!module?.init) continue;

    try {
      module.init(node);
      mounted.set(node, { key, module });
    } catch (error) {
      console.warn(`[nazare] Failed to initialize JS module for ${key}`, error);
    }
  }
}

export function destroyNazare(root = document) {
  for (const node of nazareNodes(root)) {
    const mount = mounted.get(node);
    if (!mount) continue;

    try {
      mount.module.destroy?.(node);
    } catch (error) {
      console.warn(`[nazare] Failed to destroy JS module for ${mount.key}`, error);
    } finally {
      mounted.delete(node);
    }
  }
}

initNazare();
```

Component modules are singleton-loaded, but component state is per DOM node. Modules use scoped queries such as `node.querySelector(...)` and avoid shared mutable state unless intentional.

Runtime guarantees:

- `init(node)` is called at most once per DOM node and module key until that node is destroyed or unloaded
- repeated scans do not double-initialize the same node and key
- a newly loaded replacement DOM node receives a fresh `init(node)` call
- mutation of `data-nazare-use` after initial mount is unsupported in v1

## Runtime boundary

Nazare runtime is not a UI framework. It only loads and mounts JS modules.

Nazare runtime owns:

- scanning `data-nazare-use`
- lazy importing matching modules
- calling `init(node)`
- calling optional `destroy(node)`
- handling Shopify theme editor lifecycle
- isolating module import, init, and destroy failures so one broken module does not block others

Nazare runtime does not own:

- component state
- UI reactivity
- event/action DSLs
- rendering abstractions
- transitions
- stores

Component modules use Reef.js or plain JavaScript for UI behavior.

## Component JS module contract

Component JS modules export `init(node)`.

```js
const state = new WeakMap();

export function init(node) {
  if (state.has(node)) return;

  const cleanup = mount(node);
  state.set(node, cleanup);
}

function mount(node) {
  const button = node.querySelector("button");

  function onClick() {
    // instance behavior
  }

  button?.addEventListener("click", onClick);

  return () => {
    button?.removeEventListener("click", onClick);
  };
}
```

Optional cleanup support:

```js
export function destroy(node) {
  // remove timers, listeners, observers, media state
}
```

Runtime should provide subtree cleanup behavior through `destroyNazare(root)`.

Mounted state must store both the module key and loaded module for each successfully initialized DOM node.

Runtime state rules:

- module import promise is cached once per module key
- mounted state is written only after `init(node)` succeeds
- nodes with missing modules, failed imports, missing `init`, or thrown `init(node)` are not marked mounted
- repeated `initNazare(root)` calls skip nodes already mounted with the same key
- mutation of `data-nazare-use` after initial mount is unsupported in v1

`destroyNazare(root)` must:

- find all matching `[data-nazare-use]` nodes under `root`
- include `root` itself if it matches
- call optional `destroy(node)` only for nodes that were successfully initialized
- catch thrown `destroy(node)` errors, warn, and continue
- clear mounted state for cleaned nodes even if `destroy(node)` throws

## Shopify lifecycle

Global runtime initializes on first load:

```js
initNazare(document);
```

Supported Shopify editor events in v1:

- `shopify:section:load`
- `shopify:section:unload`

Theme editor section load initializes only new section DOM:

```js
document.addEventListener("shopify:section:load", (event) => {
  initNazare(event.target);
});
```

Theme editor section unload calls optional cleanup:

```js
document.addEventListener("shopify:section:unload", (event) => {
  destroyNazare(event.target);
});
```

Not handled by Nazare runtime in v1:

- `shopify:section:reorder`
- `shopify:section:select`
- `shopify:section:deselect`
- `shopify:block:select`
- `shopify:block:deselect`

Component-specific editor behavior outside mount and unmount lifecycle is out of scope for Nazare runtime.

## Error and warning behavior

Plugin build errors:

- missing statically rendered snippet
- recursive snippet render cycle
- malformed `nazare:css` directive
- duplicate `nazare:css` directive in one section
- `nazare:css` directive inside snippet file
- `nazare:css` directive after first rendered output
- malformed `data-nazare-use`
- invalid module key format
- missing JS module declared by `data-nazare-use`
- generated file write failure

Plugin build warnings:

- dynamic render usage
- section has no explicit `nazare:css` directive and defaults to `normal`
- section missing generated section CSS bridge render
- CSS chunk requested but no utility classes are discovered

Runtime warnings:

- failed module import for `data-nazare-use`
- thrown error from `init(node)`
- thrown error from `destroy(node)`
- unknown `data-nazare-use` runtime key

Runtime must catch these failures, warn, and continue processing other nodes.

Runtime has no fatal error category in the v1 contract.

## Caveats

Dynamic render cannot be statically analyzed and is avoided in registry components:

```liquid
{% render snippet_name %}
```
