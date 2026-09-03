# @nazare/registry-api

Self-hostable Postgres-backed service implementing the `@nazare/registry` HTTP contract.

## Routes

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/components/:scope/:name` | No | Component metadata |
| `GET` | `/components/:scope/:name/:version` | No | Exact component; `latest` allowed |
| `PUT` | `/components/:scope/:name/:version` | Bearer token | Immutable publication |

Publishing tokens come from comma-separated `NAZARE_TOKENS`, with `NAZARE_TOKEN` as single-token fallback. No configured token means read-only operation.

## Storage

```sh
psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql
```

Postgres primary key `(id, version)` enforces immutable publication atomically.

## Local run

```sh
pnpm install
pnpm build
DATABASE_URL="postgres://..." NAZARE_TOKENS="dev-token" \
  pnpm --filter @nazare/registry-api start
```

Server uses `PORT`, defaulting to `3000`.

## Vercel

Set project root to `apps/registry-api`, run migration, then configure:

```text
DATABASE_URL=postgres://...
NAZARE_TOKENS=long-random-token
```

`vercel.json` routes requests through the same tested handler as the standalone Node server.

## Guards

- Maximum PUT body: 5 MiB by default
- Constant-time token comparison
- Safe relative component file paths
- Canonical IDs and versions
- Public reads; authenticated writes
