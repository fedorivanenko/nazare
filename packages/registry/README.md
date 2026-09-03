# @nazare/registry

Registry wire contracts plus HTTP and filesystem clients.

Registry installation copies component source into its consumer; registry code never compiles components.

## Usage

```ts
import { FileSystemRegistry, HttpRegistry, registryFromEnv } from "@nazare/registry";

const remote = new HttpRegistry("https://registry.example.com");
const local = new FileSystemRegistry(".registry");
```

`registryFromEnv()` reads `NAZARE_REGISTRY`: `file:<dir>` selects `FileSystemRegistry`; HTTP URLs select `HttpRegistry`.

## Contract

```ts
type RegistryComponent = {
  id: string;
  version: string;
  dependencies: Record<string, string>;
  files: Record<string, string>;
};
```

Rules:

- IDs use `@scope/name`.
- Versions use canonical `x.y.z`.
- File paths are safe relative paths.
- Publishing an existing `(id, version)` returns `VERSION_EXISTS`.

## HTTP routes

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/components/:scope/:name` | Component metadata |
| `GET` | `/components/:scope/:name/:version` | Full component; `latest` allowed |
| `PUT` | `/components/:scope/:name/:version` | Immutable publication |

PUT requests use bearer-token authorization. Missing components and versions return `undefined` from clients; transport failures throw.
