# @nazare/registry

Client-side registry implementations used by `nazare`.

The registry model is intentionally simple: install copies source files into a project, then the project owns those files. The compiler never talks to a registry.

## Pick a registry

Set `NAZARE_REGISTRY` explicitly. There is no default.

```sh
# Local folder registry: no server, no auth
export NAZARE_REGISTRY=file:.nazare-registry

# HTTP registry: self-hosted or any compatible server
export NAZARE_REGISTRY=https://registry.example.com
```

`registryFromEnv()` returns:

- `FileSystemRegistry` for `file:<dir>`
- `HttpRegistry` for any other value

## Wire payload

A published component is one JSON object:

```ts
type RegistryComponent = {
  id: string;                      // @scope/name
  version: string;                 // x.y.z
  dependencies: Record<string, string>; // @scope/name -> x.y.z
  files: Record<string, string>;   // folder-relative path -> text contents
};
```

Rules enforced by this package:

- ids are `@scope/name`
- versions are canonical `x.y.z`
- file paths are safe relative paths: no absolute path, no `..`, no empty segments
- publish is immutable: same `(id, version)` returns `VERSION_EXISTS`

## HTTP contract

`HttpRegistry` uses these routes:

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/components/:scope/:name` | metadata: `{ id, latest, versions }` |
| `GET` | `/components/:scope/:name/:version` | full `RegistryComponent`; `latest` is allowed |
| `PUT` | `/components/:scope/:name/:version` | publish full `RegistryComponent` |

Publish sends:

```http
Authorization: Bearer <NAZARE_TOKEN>
Content-Type: application/json
```

Clean missing components/versions return `undefined` from client methods. Transport failures throw.

## Local folder registry

`FileSystemRegistry` stores components as:

```text
<root>/<scope>/<name>/<version>.json
```

Example:

```sh
export NAZARE_REGISTRY=file:.nazare-registry
nazare publish ./nazare/button
nazare add @acme/button
```

This is useful for tests, personal components, CI fixtures, and small team registries backed by git/shared storage.

## API

```ts
type RegistryClient = {
  fetchMetadata(id: string): Promise<ComponentMetadata | undefined>;
  fetchComponent(id: string, version: string): Promise<RegistryComponent | undefined>;
  publish(component: RegistryComponent, token: string): Promise<PublishResult>;
};
```

Helpers exported:

- `registryFromEnv()`
- `HttpRegistry`
- `FileSystemRegistry`
- `parseComponentId()`
- `componentFolderName()`
- `compareVersions()`
- `isValidVersion()`
- `isSafeRelativePath()`
- `validateBasicRegistryComponent()`
