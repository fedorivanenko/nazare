# Testing Strategy

Tests are grouped by feature first, then by cost/behavior.

## Layout

```txt
test/
  features/
    <feature>/
      unit.test.js        # pure logic
      runtime.test.js     # JavaScript runtime behavior with fakes/mocks
      *.test.js           # CLI/filesystem or integration behavior for that feature
  e2e/
    *.test.js             # full-flow CLI/theme tests
```

## Commands

Package scripts are intentionally not used for tests. Run Vitest directly with `pnpm exec`.

Run fast unit/runtime tests:

```bash
pnpm exec vitest run test/features/**/unit.test.js test/features/**/runtime.test.js --testTimeout=15000
```

Run all feature tests:

```bash
pnpm exec vitest run test/features/**/*.test.js --testTimeout=300000
```

Run one feature:

```bash
pnpm exec vitest run test/features/c-video --testTimeout=300000
```

Run one test file:

```bash
pnpm exec vitest run test/features/c-video/runtime.test.js
```

Run c-video production build integration only:

```bash
pnpm exec vitest run test/features/c-video/build.test.js --testTimeout=300000
```

Run end-to-end tests:

```bash
pnpm exec vitest run test/e2e/*.test.js --testTimeout=300000
```

E2E scaffold dependency install/build uses `pnpm` by default. Override if needed:

```bash
NAZARE_TEST_PACKAGE_MANAGER=npm pnpm exec vitest run test/e2e/*.test.js --testTimeout=300000
```

## Release verification

Before a CLI release, run:

```bash
pnpm exec vitest run test/features/**/*.test.js --testTimeout=300000
pnpm exec vitest run test/e2e/*.test.js --testTimeout=300000
biome check bin/nazare.js test README.md install.sh docs theme components
```

Registry/theme/docs/test-only changes usually do not require a CLI release. See `docs/policies/release-policy.md`.

## Slow test rule

Slow tests must be decomposed into named steps with their own timeouts. Avoid one large test that hides whether failure happened in scaffold, install, build, or output assertions.
