# Nazare language spec

Nazare is a thin component layer on top of Shopify Liquid. A `.nz.liquid` file is valid Liquid plus a small set of Nazare tags and attributes. The compiler lowers Nazare constructs to vanilla Shopify theme files.

## File kinds

A file is a snippet by default.

```liquid
{% component snippet %}
{% component section %}
{% component block %}
```

Rules:

- at most one `{% component %}` tag per file;
- `section` emits to `sections/` and gets a generated schema;
- `block` emits to `blocks/`, gets a generated schema and preset;
- `snippet` emits to `snippets/`.

## Imports

```liquid
{% import Name from "./component.nz.liquid" %}
{% import behavior from "./behavior.ts" %}
{% import styles from "./styles.css" %}
```

Rules:

- specifiers must be relative (`./` or `../`) and stay inside the project;
- component imports are capitalized and must end in `.liquid`;
- behavior/style imports are lowercase and must end in `.ts`, `.js`, or `.css`;
- local import names must be unique in a file.

## Props

```liquid
{% props {
  href: url.required(),
  label: string.setting({ label: "Label", default: "Shop now" }),
  count: number.min(0).max(10).step(1).default(1),
} %}
```

Props are read as `props.name` inside Liquid expressions.

```liquid
<a href="{{ props.href }}">{{ props.label }}</a>
{% if props.count > 0 %}...{% endif %}
```

Rules:

- prop names must be unique;
- undeclared `props.x` is an error in `strict` mode;
- section/block props must use `.setting()` in `strict` mode because they receive values from Shopify editor settings, not render arguments.

### Type expression DSL

Base types:

```txt
string, url, color, richtext, handle, boolean, number, Money, nil, function
array(Type), object(TypeName), ShopifyProduct, ShopifyCollection, ...
```

Calls:

```txt
.required()      render caller must provide value
.optional()      adds nil
.default(value)  value has a default
.setting(meta)   project prop to Shopify schema setting
.or(Type)        union
.enum("a", "b") string literal union
.min(n) .max(n) .step(n) .unit("px") number constraints
.returns(Type)   function return type
```

## Rendering components

Nazare render syntax is explicit object-argument syntax:

```liquid
{% render Link { href: props.href, text: "Read more" } %}
```

Rules:

- target must be an imported snippet component;
- sections/blocks cannot be rendered;
- argument names must be unique per render site;
- missing required props, unknown props, and type mismatches are diagnostics.

## Blocks slot

Sections can expose a theme-block slot:

```liquid
{% blocks %}          {# accept any theme block #}
{% blocks Notice %}   {# accept imported block component Notice #}
```

Rules:

- only valid in `section` components;
- at most one slot per section;
- named entries must be imported block components.

## Styles

Inline unbound stylesheet passes through:

```liquid
{% stylesheet %}
.card { display: grid; }
{% endstylesheet %}
```

Bound stylesheets are CSS modules:

```liquid
{% import styles from "./card.css" %}
<div class="{{ styles.card }}"></div>

{% stylesheet styles %}
.card { display: grid; }
{% endstylesheet %}
```

Rules:

- bound stylesheet classes are scoped on emit;
- `styles.x` must reference a class defined by the same binding;
- unused classes in a bound stylesheet warn;
- literal text `styles.x` is not rewritten, only Liquid expression references are.

## Refs, data, and scripts

Markup refs expose DOM elements to behavior scripts:

```liquid
<div ref="root" data-count="{{ props.count }}">
  <button ref="button">+</button>
</div>

{% script lang="ts" %}
export default island(({ root, refs, data }) => {
  refs.button?.addEventListener("click", () => {
    console.log(data.root.count);
  });
});
{% endscript %}
```

Rules:

- `ref="name"` values must be static identifiers;
- refs must be unique in `strict` mode;
- `refs.name` must refer to a declared ref in `strict` mode;
- `data.<ref>.<property>` must match a `data-*` binding on that ref in `strict` mode;
- scripts must have a default export for runtime registration;
- TypeScript script checking provides an `island(...)` helper type, but the fast compile pass does not prove that the default export is specifically an `island(...)` call;
- relative `.ts`/`.js` imports inside behavior scripts are bundled at emit time; bare package imports are not allowed.

## Islands

A behavior imported by name can be mounted on a subtree:

```liquid
{% import carousel from "./carousel.ts" %}
<section island="carousel">...</section>
```

Rules:

- `island="name"` must name an imported behavior in `strict` mode;
- multiple different behavior placements are allowed;
- the same behavior can be placed at most once per component in `strict` mode;
- without `island`, behavior mounts on the component root.

## Root selection

Runtime stamping uses:

```liquid
<div nz-root>...</div>
```

Rules:

- explicit `nz-root` selects the runtime root and is stripped on emit;
- if no `nz-root` exists, the only top-level element is used and an info diagnostic is emitted;
- multiple top-level elements without `nz-root` warn;
- multiple `nz-root` markers warn and the first is used.

## Diagnostics and modes

Diagnostics have severity (`error`, `warning`, `info`) and phase (`parse`, `resolve`, `check`, `validate`, `emit`).

Modes:

- `strict` (default): package-author checks, refs/islands/styles/props/linkage.
- `loose`: minimal migration/build checks.

## Emit model

Nazare emits vanilla Shopify assets:

```txt
sections/<name>.liquid | blocks/<name>.liquid | snippets/<name>.liquid
assets/<name>.css
assets/<name>.js
assets/nazare-runtime.js
```

Compiler invariant:

```txt
parse locates → resolve reads files → syntax flattens → bind resolves → check judges → emit projects
```

Emit uses source spans and generated facts. It does not regex-rewrite emitted Liquid output for Nazare semantics.
