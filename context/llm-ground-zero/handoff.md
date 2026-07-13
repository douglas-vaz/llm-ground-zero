# Handoff — llm-ground-zero

## Current state

- Working branch: `codex/ai-usage-advisor`.
- The approved AI Usage Advisor spec, implementation checklist, analysis
  engine, secured local API, and responsive five-view dashboard are implemented.
- Core commits: `a2f0919`, `e87bf6b`, and `985db52`; UI/docs hardening is the
  current uncommitted increment.
- Existing untracked `context/ai-central/` remains untouched.
- No push, PR, release, Homebrew update, or installed-app replacement has been
  performed for this feature.
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

- Advisor/library/frontend/log tests: 19 passing.
- Local HTTP integration tests: 3 passing, including mutation security and
  oversized-body handling.
- Browser smoke test: live advisor, navigation, settings dialog, all four legacy
  charts, 560 px and 320 px layouts, no horizontal overflow or console errors.
- JavaScript syntax checks and `git diff --check` pass.

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

1. Review the feature diff and UI on `codex/ai-usage-advisor`.
2. Address review feedback, then obtain explicit approval for push/release.
3. On approval, push/open PR or merge as directed, build and smoke-test the app,
   publish the release, update the Homebrew cask, and reinstall it.

_Last updated: 2026-07-13_
