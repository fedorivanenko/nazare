{
  "targets": [
    {
      "target_name": "tree_sitter_liquid_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except"
      ],
      "include_dirs": [
        "src/parsers/liquid/vendor/tree-sitter-liquid/src"
      ],
      "sources": [
        "src/parsers/liquid/vendor/tree-sitter-liquid/bindings/node/binding.cc",
        "src/parsers/liquid/vendor/tree-sitter-liquid/src/parser.c",
        "src/parsers/liquid/vendor/tree-sitter-liquid/src/scanner.c"
      ],
      "conditions": [
        ["OS!='win'", {
          "cflags_c": ["-std=c11"]
        }, {
          "cflags_c": ["/std:c11", "/utf-8"]
        }]
      ]
    }
  ]
}
