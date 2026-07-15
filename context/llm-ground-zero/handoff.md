# Handoff — llm-ground-zero

## Current state

- Working branch: `codex/headroom-integration`, based on `main` at `cdf8d55`.
- The approved AI Usage Advisor spec, implementation checklist, analysis
  engine, secured local API, and responsive five-view dashboard are implemented.
- Version is bumped to v0.3.0 and the Electron package allowlist includes the
  advisor and Headroom integration runtime modules.
- Existing untracked `context/ai-central/` remains untouched.
- v0.2.0 is published from tag `v0.2.0` at main commit `bd9037d`; GitHub Actions
  run `29262846719` rebuilt, tested, checksummed, and published the universal
  DMG successfully.
- Homebrew tap commit `310b428` points to the CI-built DMG checksum
  `749e2ac716f920ad9cdfdab61189fb7c7edaad796333d1aad58acd37dc6a9438`.
- Homebrew-installed `/Applications/LLM Ground Zero.app` is still v0.2.0 and
  owns port 7788; v0.3.0 publication, tap update, and local upgrade are next.
- The optional Headroom integration, design record, checklist, sanitized
  screenshot, setup path, local API, Settings controls, and Token savings view
  are implemented. Headroom remains disabled by default.

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
- Adds an isolated Headroom v0.31.0 adapter and profile for independently
  enabling Claude Code and Codex, with Gemini visibly unsupported upstream.
- Reports measured before/after/saved tokens, weighted reduction, by-agent and
  daily breakdowns, transform counts, proxy health, and optimization overhead.
- Delegates reversible provider mutations to Headroom's official installer;
  memory, learn, output shaping, and telemetry remain off.

## Verification

- Full Node suite: 26 passing, including package inclusion, Headroom aggregation,
  ranged API behavior, mutation security, and oversized-body handling.
- Shell setup suite passes 16 checks, including opt-in-only behavior, pinned
  Python 3.13 installation, target allowlisting, and Gemini rejection.
- Browser smoke test: live advisor, navigation, settings dialog, all four legacy
  charts, 560 px and 320 px layouts, no horizontal overflow or console errors.
- JavaScript syntax checks and `git diff --check` pass.
- Universal v0.3.0 DMG builds successfully; the app contains x86_64 and arm64,
  `integrations/headroom.js` is present in ASAR, and the current local checksum
  is recorded during packaging verification.
- Browser verification used the live server plus sanitized fixtures; the
  30-day savings view renders at desktop size with no console-reported failure.

## Recent decisions

- Agent logs, handoffs, and Engram remain read-only; only app-owned preferences
  and manual annotations are mutable.
- Recommendations are deterministic and evidence-backed; inference, pricing,
  and coverage limitations stay visible.
- Draft CTAs remain preview-and-copy in v1, with no silent writes or browsing.
- The user explicitly approved implementation, packaging, GitHub/Homebrew
  publication, and local install verification for v0.3.0.
- Headroom should be optional and disabled by default, with independent Claude
  Code and Codex targets; Gemini stays visibly unsupported until upstream adds
  a supported CLI installer target.
- Delegate configuration to Headroom v0.31.0's reversible persistent installer
  using provider scope, profile `llm-ground-zero`, port 8791, and an isolated
  app-owned `HEADROOM_WORKSPACE_DIR`; do not recreate upstream config writers.
- Keep Engram authoritative and leave Headroom memory, learn, output shaping,
  and anonymous telemetry off in the first release.
- Report measured proxy before/after tokens separately from CLI filtering,
  cache savings, and counterfactual output shaping.

## Distribution gotchas

- The app is unsigned, so a fresh Homebrew install requires quarantine removal.
- Universal builds must include both ccusage native architectures and unpack
  them from ASAR; the packaged CLI runs through Electron's Node mode.
- The GitHub handle and tap are `douglas-vaz` / `douglas-vaz/tap`.
- On Node 22, run the test suite as bare `node --test` (the npm script already
  does this), not `node --test test/`.

## Next steps

1. Commit and fast-forward the Headroom branch to main, push, and tag v0.3.0.
2. Wait for the tag workflow and use the CI-built DMG checksum in homebrew-tap.
3. Upgrade the local cask, clear quarantine, and verify the installed app/API.
4. Monitor user feedback and sanitized runtime logs for advisor/Headroom edge cases.
5. Improve the offline state so a stopped server is distinguished from seven
   independent data-source failures.
6. Address the GitHub Actions Node 20 deprecation annotation by upgrading
   checkout/setup-node actions when stable versions are available.

_Last updated: 2026-07-15_
