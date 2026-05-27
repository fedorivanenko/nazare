# Testing strategy

Tests are grouped by feature first, then by cost/behavior.

## Layout

```txt
test/
  features/
    <feature>/
      unit.test.js        # pure logic
      runtime.test.js     # JavaScript runtime behavior with fakes/mocks
      *.test.js           # CLI/filesystem behavior for that feature
  e2e/
    *.test.js             # slow full-flow tests
```

## Commands

Run fast default tests:

```bash
pnpm test
```

Run all feature tests:

```bash
pnpm run test:features
```

Run one feature:

```bash
pnpm exec vitest run test/features/c-video
```

Run one test file:

```bash
pnpm exec vitest run test/features/c-video/runtime.test.js
```

Run c-video production build integration only:

```bash
pnpm exec vitest run test/features/c-video/build.test.js --testTimeout=300000
```

Run slow end-to-end tests:

```bash
pnpm run test:e2e
```

E2E scaffold dependency install/build uses `pnpm` by default. Override if needed:

```bash
NAZARE_TEST_PACKAGE_MANAGER=npm pnpm run test:e2e
```

Run everything:

```bash
pnpm run test:all
```

## Slow test rule

E2E tests must be decomposed into named steps with their own timeouts. Avoid one large test that hides whether failure happened in scaffold, install, build, or output assertions.
