# Handoff — llm-ground-zero

## Current state

- Working branch: `main`; the in-app Headroom installer/status increment is released.
- The approved AI Usage Advisor spec, implementation checklist, analysis
  engine, secured local API, and responsive five-view dashboard are implemented.
- Version is v0.3.2 and the Electron package allowlist includes the
  advisor and Headroom integration runtime modules.
- Existing untracked `context/ai-central/` remains untouched.
- v0.3.1 is published from tag `v0.3.1` at main commit `164034a`; GitHub Actions
  run `29418238356` rebuilt, tested, checksummed, and published the universal
  DMG successfully.
- Homebrew tap commit `5b4dd19` points to the CI-built DMG checksum
  `9c63bcc57e1b9f59d6b089b4667c77c8e61f994c4b06604ad8ddb060d898de1d`.
- Homebrew-installed `/Applications/LLM Ground Zero.app` is v0.3.1, quarantine
  is cleared, and the app is open after a successful smoke test on port 7788.
- v0.3.2 is published from tag `v0.3.2` at main commit `5225e07`; GitHub Actions
  run `29420929494` published the universal DMG with checksum
  `62ed5671a88efde47b339e50fb8ec2e34834fc1550ec92139a9c6947235206df`.
- The Homebrew tap and local app remain on v0.3.1; they were not part of the
  v0.3.2 fix/package request.
- The optional Headroom integration, design record, checklist, sanitized
  screenshot, setup path, local API, Settings controls, and Token savings view
  are implemented. Headroom remains disabled by default.
- In-app Headroom install/upgrade and 15-second status monitoring are released.

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
- Settings can install or upgrade the pinned CLI through an allowlisted `uv`
  command without changing agent routing; the user explicitly selects targets
  in a separate Apply step.
- Delegates reversible provider mutations to Headroom's official installer;
  memory, learn, output shaping, and telemetry remain off.

## Verification

- Full Node suite: 27 passing, including package inclusion, Headroom aggregation,
  ranged API behavior, mutation security, and oversized-body handling.
- Shell setup suite passes 16 checks, including opt-in-only behavior, pinned
  Python 3.13 installation, target allowlisting, and Gemini rejection.
- Browser smoke test: live advisor, navigation, settings dialog, all four legacy
  charts, 560 px and 320 px layouts, no horizontal overflow or console errors.
- JavaScript syntax checks and `git diff --check` pass.
- Universal v0.3.1 DMG builds successfully; the app contains x86_64 and arm64,
  `integrations/headroom.js` is present in ASAR, and the current local checksum
  is recorded during packaging verification.
- The installed bundle reports v0.3.1, contains x86_64 and arm64, includes the
  Headroom adapter in ASAR, and returns healthy `/api/health` output.
- Updated Node suite: 27 passing, including the pinned in-app installer command,
  rejection of client-supplied arguments, and status-monitor frontend contract.
- Browser verification shows a compatible Ready state in Settings and the live
  Token savings status badge; no agent target was enabled during verification.
- Installed-app verification reports Headroom v0.31.0 as compatible, with no
  selected targets; installer mutation guards return 403/400 as expected.
- v0.3.2 removes the synthetic blank subscription row, so optional plan fields
  no longer block saving Headroom settings; the frontend contract test covers it.

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

1. Monitor user feedback and sanitized runtime logs for advisor/Headroom edge cases.
2. Improve the offline state so a stopped server is distinguished from seven
   independent data-source failures.
3. Address the GitHub Actions Node 20 deprecation annotation by upgrading
   checkout/setup-node actions when stable versions are available.

_Last updated: 2026-07-15_
