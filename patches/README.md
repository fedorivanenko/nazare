# Dependency patches

## tree-sitter 0.21.1

Node.js 24 V8 headers require C++20 when `tree-sitter` must compile from source.
The package's upstream `binding.gyp` forces C++17, which fails on platforms
without a matching prebuilt binary, including Linux ARM64. The patch changes
only the native binding language standard; parser behavior is unchanged.

Remove this patch when upgrading to a Tree-sitter runtime that supports the
current Node.js headers without modification.
