# Nazare registry

The registry is how components move between projects. It follows the shadcn
model: **install copies source into your project and forgets.** There is no
runtime dependency on the registry, no lockfile resolution at build time, no
package graph the compiler ever sees. `nazare build` only ever reads files on
disk (see [LANGUAGE.md](./LANGUAGE.md) and the compiler boundary).

This document is the frozen contract between three parts:

- **`nazare` (cli-client)** — `add`, `update`, `build`. Fetches components and
  copies their folders into the project. Never publishes.
- **`nazare-dev` (cli-dev)** — `publish`. Verifies a component, then uploads it.
- **`registry-api` (apps/registry-api)** — stores and serves published
  components. A dumb content store: it does not compile or validate. Shipped as
  a **self-hostable reference server**, not a service we gate.

## Ownership: the registry is yours (decentralized-first)

There is no registry baked into the tooling. A registry is defined entirely by
this wire contract plus where `NAZARE_REGISTRY` points — the client talks to
whatever that is. Consequences, by design:

- **No default, ever.** `NAZARE_REGISTRY` unset is an error, not a silent
  fallback to some blessed host. You always choose your registry.
- **A registry can be a folder.** `NAZARE_REGISTRY=file:<dir>` is a complete
  registry: `publish` writes into it, `add` reads from it, no server, no auth.
  Make that folder a git repo or a shared drive and it is a team registry with
  still zero infrastructure.
- **A registry can be your own server.** Deploy `registry-api` on your own
  infra and point `NAZARE_REGISTRY` at it. This is the "spawn your own infra"
  path — it is just the reference server, run by you, with auth you control.
- **Any hosted instance is just an instance.** If a public one exists, it holds
  no special status in the client; it is a URL like any other.

So self-hosting is not a feature bolted on — it is the only posture. The
compiler and CLI are registry-agnostic by construction; the reference server is
built to be deployed by anyone.

## The unit: a published component

A published component is one folder — a `.nz.liquid` (or `.ts` for a function)
entry plus its sibling assets and its `nazare.json` manifest. Identity is the
scoped id in `nazare.json` (`@scope/name`); the last segment (`name`) is the
folder name on disk after install. See
[nazare-identity-model](./packages/compiler/README.md).

### Wire payload — `RegistryComponent`

The registry serves a component as **JSON: metadata plus every file's contents
inline.** No tarball, no binary; components are text (liquid / ts / css / json).

```jsonc
{
  "id": "@nazare/counter",       // from nazare.json
  "version": "0.1.0",            // exact, immutable once published
  "dependencies": {              // scoped id -> exact version
    "@nazare/cn": "0.1.0"
  },
  "files": {                     // project-relative-within-folder path -> contents
    "nazare.json": "{ ... }",
    "counter.nz.liquid": "...",
    "counter.ts": "...",
    "format.ts": "..."
  }
}
```

`files` is the whole folder verbatim, including `nazare.json` itself — so the
component's `kind` (which lives in source, `{% component section %}`) and its
declared deps travel inside the files, not as privileged metadata. The
top-level `id` / `version` / `dependencies` are a convenience projection of
`nazare.json` so a client can plan the fetch without parsing file contents
first.

## Versioning

- Versions are **exact pins**. There are no ranges, no `^`/`~`, no consume-time
  resolution. A version names a source snapshot to copy. This is deliberate:
  install is a copy, so "which version" only ever means "which bytes."
- A published `(id, version)` is **immutable**. Re-publishing the same pair is a
  conflict (`409`), never an overwrite.
- Each id has a **`latest`** pointer: the highest published version by semver
  order. `add` with no version uses `latest`; the resolved exact version is what
  gets recorded on disk.

## HTTP surface

Base: `https://<registry-host>/`. All responses JSON.

| Method | Path | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/components/:scope/:name` | client | Metadata + version list + `latest` (no file contents). |
| `GET` | `/components/:scope/:name/:version` | client | Full `RegistryComponent` for one exact version. |
| `PUT` | `/components/:scope/:name/:version` | nazare-dev | Publish. Body = `RegistryComponent`. Auth required. |

`:scope` is the id's scope without `@` (`nazare` for `@nazare/counter`);
`:name` is the last segment. `latest` is a reserved `:version` value on the
`GET .../:version` route.

### Metadata response (`GET /components/:scope/:name`)

```jsonc
{
  "id": "@nazare/counter",
  "latest": "0.1.0",
  "versions": ["0.1.0"]        // ascending semver
}
```

### Errors

Every error is `{ "error": { "code": "...", "message": "..." } }` with a status:

| Status | code | When |
| --- | --- | --- |
| `404` | `COMPONENT_NOT_FOUND` | Unknown id. |
| `404` | `VERSION_NOT_FOUND` | Known id, unknown version. |
| `409` | `VERSION_EXISTS` | Publishing a `(id, version)` that already exists. |
| `401` | `UNAUTHORIZED` | Publish without a valid token. |
| `400` | `MALFORMED_COMPONENT` | Publish body isn't a well-formed `RegistryComponent`. |

## Authentication

Publish only. `nazare-dev` sends `Authorization: Bearer <token>`; the token
comes from `NAZARE_TOKEN` in the environment. Reads are public. **Each registry
owner decides issuance and per-scope authorization** — the contract fixes only
the header and the `401` shape, never who may publish what. A `file:` registry
needs no token at all (there is no server to authenticate to; the fake ignores
it). A self-hosted server picks whatever scheme its owner wants behind the same
`Bearer` header.

## Client behavior

### `nazare add <id> [--version x.y.z]`

1. Resolve the source root (default `nazare/`; the theme-wide `build` target).
2. Fetch the component (given version, else `latest`). Record the **resolved
   exact** version.
3. Transitively fetch dependencies from each component's `dependencies` map,
   deduped by id. **Client-side resolution** — the registry never walks the
   graph.
4. Write each component's `files` to `nazare/<name>/…`. Relative imports
   (`../<dep>/…`) resolve because deps are installed as **siblings** under the
   same root — no path rewriting, ever.
5. Record installs in `nazare.theme.json`: `installed: { "@scope/name":
   "x.y.z" }`. Registry-layer bookkeeping; the compiler and the theme never
   read it.

**One copy per project (v1).** If a dependency is already installed at a
*different* version, `add` **warns and keeps the existing copy** — the user owns
the files and reconciles. No diamond resolution, no second copy.

### `nazare update [id]`

Re-fetch newer source for one component (or all installed) and overwrite the
local folder(s). You own the files; update is an explicit, overwriting copy.
Same transitive + sibling rules as `add`.

## Publish behavior (`nazare-dev publish [dir]`)

1. Read the component folder and its `nazare.json`.
2. **Verify declared deps == actual imports.** Every `../<name>/…` import in the
   source must appear in `nazare.json.dependencies`, and vice versa. Mismatch
   → refuse. This is the one guard that keeps the declared graph honest, and it
   lives here (not the compiler, not the API) so the compiler stays pure and the
   API stays dumb.
3. Build the `RegistryComponent` (folder → `files` map) and `PUT` it.
4. `409` → the version is taken; bump `nazare.json.version` and retry.

## The `RegistryClient` seam (testability)

The client's only contact with the network is one injected interface — the same
dependency-injection pattern as the compiler's `readFile`:

```ts
type RegistryClient = {
  fetchMetadata(id: string): Promise<ComponentMetadata | undefined>;
  fetchComponent(id: string, version: string): Promise<RegistryComponent | undefined>;
  publish(component: RegistryComponent, token: string): Promise<PublishResult>;
};
```

- **Production** — an HTTP implementation against the surface above.
- **Tests / offline / personal registry** — the filesystem-backed
  `FileSystemRegistry`: a directory of `<scope>/<name>/<version>.json` files.
  This is not only a test double — `NAZARE_REGISTRY=file:<dir>` makes it a real,
  zero-infra personal or team registry. `add`/`update`/`publish` are fully
  usable (and unit-testable) with no network, and any server that honors the
  same surface is a drop-in replacement.

This is why **the CLI does not block on infra**: it is coded to
`RegistryClient`, tested against the fake, and pointed at any registry — a
folder, your server, or someone else's — through `NAZARE_REGISTRY`.

## Build order

1. **This contract** (frozen here).
2. **CLI** `add` / `update` (cli-client) and `publish` (cli-dev), against the
   fake `RegistryClient`.
3. **Reference server** `registry-api`: a **self-hostable** app that stores
   `RegistryComponent` by `(id, version)` immutably, maintains the `latest`
   pointer + version list, and serves the three routes. Deployable by anyone on
   their own infra (Vercel or otherwise); the storage backend (blob + metadata
   KV/Postgres) is the deployer's choice and does not affect this contract.
