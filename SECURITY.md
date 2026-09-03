# Security Policy

Nazare includes a publish-capable registry service and native parsing code, so security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report privately through [GitHub Security Advisories](https://github.com/fedorivanenko/nazare/security/advisories/new) or email **security@nazare.engineering**.

## Scope

Especially relevant areas:

- `apps/registry-api`: authentication, request validation, and immutable publication
- `packages/registry`: transport handling and consumer-side path safety
- `packages/theme-intelligence`: parser safety, resource bounds, and malformed-input handling

## Supported versions

Only latest released version receives security fixes.
