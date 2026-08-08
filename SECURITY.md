# Security Policy

Nazare compiles source into Shopify themes and includes a publish-capable registry server (`apps/registry-api`), so security reports are taken seriously.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Please report privately via GitHub's **[Report a vulnerability](https://github.com/fedorivanenko/nazare/security/advisories/new)** (Security tab → Advisories → Report a vulnerability), or by email to **security@nazare.engineering**.

We aim to acknowledge reports within a few business days and to coordinate a fix and disclosure timeline with you.

## Scope

Especially relevant areas:

- **registry-api** — auth/token handling, request validation, publish path.
- **CLI install** — writing registry files into a consumer's project (path-traversal guards).
- **Build/emit** — output written into a user's theme directory.

## Supported versions

Nazare is pre-1.0 and under active development. Only the latest released version receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |
