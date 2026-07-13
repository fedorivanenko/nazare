# Nazare registry

Nazare registry = copy source components between projects.

Install follows the shadcn model: `nazare add` fetches component JSON, writes files into your project, then the registry is out of the build path. The compiler only reads local files.

## Where docs live

- [`packages/registry/README.md`](./packages/registry/README.md) — client implementations, `NAZARE_REGISTRY`, `file:` registries, HTTP wire contract.
- [`apps/registry-api/README.md`](./apps/registry-api/README.md) — self-hosted server, Postgres storage, auth, deploy instructions.

## Core contract

A component is JSON:

```ts
type RegistryComponent = {
  id: string;                      // @scope/name
  version: string;                 // x.y.z
  dependencies: Record<string, string>; // @scope/name -> x.y.z
  files: Record<string, string>;   // folder-relative path -> text contents
};
```

Routes:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/components/:scope/:name` | metadata: `{ id, latest, versions }` |
| `GET` | `/components/:scope/:name/:version` | full component; `latest` allowed |
| `PUT` | `/components/:scope/:name/:version` | publish component JSON |

Rules:

- no default registry; set `NAZARE_REGISTRY`
- `file:<dir>` is a full local registry
- HTTP publish uses `Authorization: Bearer <NAZARE_TOKEN>`
- `(id, version)` is immutable
- `latest` means highest published `x.y.z`
- install writes one sibling folder per component name
- registry bookkeeping lives in `nazare.theme.json`; compiler ignores it
