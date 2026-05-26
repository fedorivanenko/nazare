# Feature Building Workflow

Feature design docs live on `main`. Feature implementation lives on `feat/<feature-id>` branches.

## 1. Design on main

```sh
git checkout main
git pull --ff-only
```

- Choose one feature file under `features/`.
- If missing, create it from `features/feature.schema.yaml`.
- Keep scope small: one user-visible command, behavior, or registry package.
- Check relevant policies in `docs/policies/`.
- Commit accepted scope directly to `main`:

```sh
git add features/<feature-id>.md docs/policies docs/backlog.md
git commit -m "docs: design <feature-id>"
git push origin main
```

For uncertain or broad scoping, use short-lived `scope/<feature-id>`, then merge only accepted docs to `main` before implementation.

## 2. Design contract

Before coding, make the feature doc clear enough to test:

- command or file surface
- success behavior
- failure behavior
- ownership boundaries
- verification checklist
- open questions resolved or explicitly listed

## 3. Start implementation branch

```sh
git checkout main
git pull --ff-only
git checkout -b feat/<feature-id>
```

Use the feature doc ID for `<feature-id>`, for example `feat/component-list`.

## 4. Implement thin slice

- Add the smallest code path that satisfies the contract.
- Reuse existing CLI helpers before adding new primitives.
- Keep destructive behavior opt-in.
- Do not broaden scope while coding; add follow-up notes to `docs/backlog.md`.

## 5. Test the contract

- Add or update Vitest coverage matching the feature verification checklist.
- Prefer temp directories and fixture registry snapshots.
- Verify failure cases mutate nothing.

## 6. Verify locally

```sh
npx vitest run
biome check bin/nazare.js test README.md install.sh
```

For docs-only feature design, run at least:

```sh
git diff --check
git diff --stat
```

## 7. Reconcile docs

- Mark verified checklist items in the feature doc.
- Update README only for user-visible commands or behavior.
- Update policies only when the rule should apply beyond this feature.
- If CLI/install behavior changed, check `docs/policies/release-policy.md`.

## 8. Commit

```sh
git status --short
git add <paths>
git commit -m "<type>: <short feature summary>"
```

Commit types:

- `feat:` user-visible behavior
- `fix:` bug fix
- `docs:` docs-only
- `test:` tests-only
- `chore:` maintenance

## 9. Push branch

```sh
git push -u origin feat/<feature-id>
```

Open a PR. Do not merge feature branches directly to `main` from local checkout.

After PR merge:

```sh
git branch -d feat/<feature-id>
git push origin --delete feat/<feature-id>
```

## Rule of thumb

Feature is done when main has accepted design, branch has implementation, and code, tests, README, and feature doc all describe the same behavior.
