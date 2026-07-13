# Handoff — llm-ground-zero

## Current state

- Working branch: `main`; `codex/ai-usage-advisor` was fast-forward merged.
- The approved AI Usage Advisor spec, implementation checklist, analysis
  engine, secured local API, and responsive five-view dashboard are implemented.
- Version is bumped to v0.2.0 and the Electron package allowlist includes the
  advisor runtime modules.
- Existing untracked `context/ai-central/` remains untouched.
- Local `main` contains the unreleased v0.2.0 commits ahead of `origin/main`;
  no push, tag, GitHub
  release, Homebrew update, or installed-app replacement has been performed.
- The currently published and Homebrew-installed app is still v0.1.3. Its
  local assets, strict CSP, universal DMG workflow, and Electron sandboxing
  predate this branch and remain intact.

## Implemented behavior

- Normalizes bounded Claude and Codex JSONL history and joins session usage.
- Detects evidence-backed friction, outcomes, and knowledge-compounding signals.
- Treats unsupported zero-price usage as unpriced and reports coverage.
- Stores only explicit subscription settings and outcome overrides in an
  app-owned, validated, atomically-written `0600` JSON file.
- Exposes range/evidence/settings/outcome routes with same-origin, explicit
  action-header, JSON-only, and 32 KiB mutation protections.
- Adds Overview, Waste audit, Outcome ledger, Knowledge, and preserved Usage
  views with preview/copy-only CTAs.

## Verification

- Full Node suite: 23 passing, including package inclusion, mutation security,
  and oversized-body handling.
- Browser smoke test: live advisor, navigation, settings dialog, all four legacy
  charts, 560 px and 320 px layouts, no horizontal overflow or console errors.
- JavaScript syntax checks and `git diff --check` pass.
- Universal v0.2.0 DMG built successfully; app and ccusage contain both x86_64
  and arm64 binaries, all advisor modules are present in ASAR, checksum passes,
  and the packaged health/advisor endpoints respond successfully.

## Recent decisions

- Agent logs, handoffs, and Engram remain read-only; only app-owned preferences
  and manual annotations are mutable.
- Recommendations are deterministic and evidence-backed; inference, pricing,
  and coverage limitations stay visible.
- Draft CTAs remain preview-and-copy in v1, with no silent writes or browsing.
- Release and Homebrew distribution remain a separate approval gate.

## Distribution gotchas

- The app is unsigned, so a fresh Homebrew install requires quarantine removal.
- Universal builds must include both ccusage native architectures and unpack
  them from ASAR; the packaged CLI runs through Electron's Node mode.
- The GitHub handle and tap are `douglas-vaz` / `douglas-vaz/tap`.
- On Node 22, run the test suite as bare `node --test` (the npm script already
  does this), not `node --test test/`.

## Next steps

1. Push `main` and tag v0.2.0 after explicit publishing approval.
2. Publish the GitHub release and update the Homebrew cask checksum/version.
3. Reinstall via Homebrew and verify the installed app reports v0.2.0.

_Last updated: 2026-07-13_
