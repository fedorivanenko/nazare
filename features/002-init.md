# 002 — Initialize Nazare Theme Repo

Status: planned

## Goal

Add `nazare init` so a user theme repo can be linked to a Nazare registry origin.

## Scope

`nazare init` creates the initial local Nazare files:

- `nazare.config.yml`
- `nazare.lock.yml`

## Behavior

### Success

Running `nazare init` in a theme repo creates:

```yaml
# nazare.config.yml
schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: main
  manifest: nazare.registry.yml
```

```yaml
# nazare.lock.yml
schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: main
  manifest: nazare.registry.yml

components: {}
```

### Failure

`nazare init` fails if `nazare.lock.yml` already exists.

It must not overwrite existing lockfile state.

## Acceptance criteria

- Creates `nazare.config.yml`
- Creates `nazare.lock.yml`
- Uses default registry metadata
- Fails when `nazare.lock.yml` exists
- Does not mutate existing `nazare.lock.yml`
- Has tests using temporary directories

## Related specs

- [`docs/cli.spec.md`](../docs/cli.spec.md)
- [`docs/theme-config.spec.md`](../docs/theme-config.spec.md)
- [`docs/theme-lockfile.spec.md`](../docs/theme-lockfile.spec.md)
