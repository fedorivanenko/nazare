# Backlog

Design and UX findings from the feature-design pass.

## P0

- Reconcile feature document status and verification checklists.
  - Several implemented/tested areas were still marked `planned`.
  - Current interim state uses `in-progress` where implementation exists but feature-doc checklists still need final pass.
- Resolve `nazare theme pull` conflict contract.
  - Feature doc describes interactive choices: `skip`, `overwrite`, `all`, `none`.
  - Current CLI fails on conflicts unless `--yes` is passed.
  - Decide one v1 contract: implement prompts, or document non-interactive behavior only.
- Clarify destructive behavior of `nazare theme pull --yes`.
  - Current behavior overwrites all conflicts.
  - Consider safer flags: `--skip-existing`, `--overwrite-existing`, or `--force`.

## P1

- Add first-run guidance and/or helper for Shopify store configuration.
  - `shopify.theme.toml` ships `your-store.myshopify.com`.
  - Consider `nazare theme configure --store <store.myshopify.com>`.
- Add `nazare theme status`.
  - Report init state, installed scaffold version, registry ref, modified tracked files, missing files, and update availability.
- Add `nazare doctor`.
  - Check Node.js, `curl`, Shopify CLI, init files, registry reachability, checksums, dependency install, and generated files.
- Improve `nazare update theme --check` output.
  - Print grouped summary: writes, deletes, untracks, metadata-only changes, blockers.
  - On unsafe update failures, suggest `nazare update theme --check`.
- Split broad `nazare update theme --force` into narrower safety flags.
  - Candidate flags: `--overwrite-modified`, `--restore-missing`, `--delete-obsolete`.
  - Keep `--force` as explicit all-in shortcut with warning.
- Add vendored plugin version marker.
  - Example: `// Nazare Vite plugin version: 1.0.0`.
  - Helps users understand plugin updates are scaffold updates.

## P2

- Improve minimal scaffold storefront polish without adding demo bulk.
  - Add basic Tailwind spacing/typography classes to `sections/s-main.liquid`.
  - Rename schema label from `Main` to `Main content` or `Nazare main`.
- Improve scaffold accessibility and SEO baseline.
  - Consider `{{ canonical_url }}`, page description metadata, skip link, and `main` landmark.
- Make generated-file workflow more visible.
  - README now notes generated markers.
  - Consider CLI warning when generated bridge/runtime files are missing.
- Consider concurrent runtime module initialization.
  - Current generated runtime initializes nodes sequentially.
  - Parallel import/init may improve large-page widget startup while preserving per-node error isolation.
- Replace fake checksum examples in feature docs.
  - Use `<sha256>` placeholders or generate real current values.
  - Avoid examples that look authoritative but do not match `nazare.registry.yml`.

## Later

- Add JSON output mode for CI once CLI surfaces stabilize.
- Add registry/component install UX after theme commands settle.
