# @nazare/tree-sitter-liquid

Vendored MIT-licensed grammar from
[`hankthetank27/tree-sitter-liquid`](https://github.com/hankthetank27/tree-sitter-liquid)
at commit `e45dbac8c5fa95b1f0e00e7e0c04bc8855823391`.

Nazare's only local generated-binding change adds `src/scanner.c` to
`binding.gyp`; upstream's external scanner was not linked by its Node target.
See `LICENSE` and `notes/adr-tree-sitter-source-runtime.md`.
