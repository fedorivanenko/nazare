# @nazare/registry-api

Self-hostable HTTP registry server for Nazare components.

This app is a dumb content store. It does not compile components and does not prove that `nazare.json` matches the uploaded files. `nazare publish` owns that semantic check. The server only enforces the HTTP contract, auth, safe paths, body size, and immutable `(id, version)` storage.

## Routes

Base URL: your deployment root.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/components/:scope/:name` | no | component metadata: `{ id, latest, versions }` |
| `GET` | `/components/:scope/:name/:version` | no | exact component; `latest` is allowed |
| `PUT` | `/components/:scope/:name/:version` | yes | publish component JSON |

Publish auth:

```http
Authorization: Bearer <token>
```

Tokens come from:

```sh
NAZARE_TOKENS="token-one,token-two"
# or single-token fallback:
NAZARE_TOKEN="token-one"
```

If no token is configured, reads still work and publishing is disabled.

## Storage

Postgres only. Required env:

```sh
DATABASE_URL=postgres://...
```

Schema:

```sh
psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql
```

The primary key is `(id, version)`, so duplicate publishes are rejected atomically.

## Local run

From repo root:

```sh
pnpm install
pnpm -s tsc -b
psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql
NAZARE_TOKENS="dev-token" pnpm --filter @nazare/registry-api start
```

Server listens on `PORT` or `3000`.

Use it:

```sh
export NAZARE_REGISTRY=http://localhost:3000
export NAZARE_TOKEN=dev-token
nazare publish ./nazare/button
nazare add @acme/button
```

## Deploy: Vercel

1. Create a Postgres database. Neon/Vercel Postgres both work.
2. Run migration against it:

   ```sh
   psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql
   ```

3. Create a Vercel project with root directory `apps/registry-api`.
4. Set environment variables:

   ```sh
   DATABASE_URL=postgres://...
   NAZARE_TOKENS=long-random-token
   ```

5. Deploy:

   ```sh
   vercel --prod
   ```

`vercel.json` rewrites all paths to `/api`, and `api/index.ts` uses the same tested handler as the standalone server.

After deploy:

```sh
export NAZARE_REGISTRY=https://your-registry.vercel.app
export NAZARE_TOKEN=long-random-token
nazare publish ./nazare/button
```

## Deploy: any Node host

Build the workspace, run the migration, then run the built entrypoint:

```sh
pnpm install --frozen-lockfile
pnpm -s tsc -b
psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql
PORT=3000 DATABASE_URL="$DATABASE_URL" NAZARE_TOKENS="long-random-token" \
  node apps/registry-api/dist/index.js
```

Expose `PORT` behind HTTPS. Point clients at that URL with `NAZARE_REGISTRY`.

## Operational notes

- Max publish body: `5 MiB` by default.
- Reads are public.
- Publishing is immutable; bump `nazare.json.version` for new bytes.
- Version format is canonical `x.y.z`.
- Component ids are `@scope/name`; URL scope omits `@`.
