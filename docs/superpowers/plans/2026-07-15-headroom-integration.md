# Optional Headroom Integration — Incremental Implementation Checklist

**Status:** Implemented for llm-ground-zero v0.3.0; extended lifecycle matrix retained as future hardening

**Spec:** `docs/superpowers/specs/2026-07-15-headroom-integration-design.md`

## Delivery rules

- [ ] Keep Headroom off by default and preserve current `setup.sh` behavior
      when no Headroom flags are present.
- [ ] Pin and test Headroom v0.31.0; do not consume unreleased main APIs.
- [ ] Use the official persistent installer and an isolated
      `HEADROOM_WORKSPACE_DIR`; do not write provider config ourselves.
- [ ] Keep Engram authoritative; omit Headroom memory, learn, output shaping,
      and anonymous telemetry.
- [ ] Write failing tests before each implementation increment.
- [ ] Preserve unrelated `context/ai-central/` work.
- [ ] Keep implementation, release, Homebrew, and installation as separate
      approval gates.

## Increment 0 — Fixtures and compatibility lock

**Files:** `app/test/fixtures/headroom/**`, `app/test/headroom.test.js`

- [ ] Capture sanitized v0.31.0 fixtures for `/stats`, `/stats-history`,
      `perf --raw --format json`, manifest, version, status, and errors.
- [ ] Add a fake Headroom executable that records argv/env and never touches
      real agent configuration.
- [ ] Record the current 23-test passing baseline.
- [ ] Commit: `test: add headroom integration fixtures`

**Exit check:** Fixtures cover Claude, Codex, unknown client, partial history,
missing binary, stopped proxy, malformed output, and config conflict.

## Increment 1 — Setup and installation option

**Files:** `setup.sh`, `test/setup_test.sh`, `test/stubs/uv`,
`test/stubs/headroom`

- [ ] Parse `--headroom <comma-list>` and `--headroom-mode cache|token`.
- [ ] Validate only Claude/Codex; print a clear unsupported Gemini message.
- [ ] Install pinned `headroom-ai[proxy]==0.31.0` on Python 3.13 through `uv`
      only when explicitly requested.
- [ ] Record the resolved binary path in private app-owned integration state.
- [ ] Apply the dedicated profile with fixed workspace/port, provider scope,
      manual targets, no telemetry, and no memory.
- [ ] Make reruns converge without duplicate config or services.
- [ ] Test zero flags, each target combination, missing prerequisites, invalid
      input, partial failure, and setup report output.
- [ ] Commit: `feat: add optional headroom setup`

**Exit check:** Default setup is byte-for-byte behavior-compatible; explicit
setup creates a healthy reversible profile for the selected agents.

## Increment 2 — Headroom adapter and aggregation

**Files:** `app/integrations/headroom.js`, `app/test/headroom.test.js`,
`app/package.json`

- [ ] Implement binary discovery and semantic version gate.
- [ ] Implement fixed workspace/profile/port constants and bounded `execFile`.
- [ ] Add health/stats/history clients with loopback-only URLs and timeouts.
- [ ] Aggregate raw PERF records by selected range and normalized client.
- [ ] Compute weighted before/after/saved totals and honest coverage.
- [ ] Separate compression, CLI filtering, cache, output shaping, reliability,
      and overhead fields.
- [ ] Add defensive numeric/schema validation and sanitized errors.
- [ ] Ensure `integrations/**` is included in Electron's package allowlist.
- [ ] Commit: `feat: normalize headroom savings metrics`

**Exit check:** One pure normalized contract drives the UI without exposing raw
logs, prompts, request IDs, paths, or credentials.

## Increment 3 — Reversible configuration lifecycle

**Files:** `app/integrations/headroom.js`, `app/test/headroom.test.js`

- [ ] Read the isolated deployment manifest defensively and detect drift.
- [ ] Preflight selected provider configs and port ownership.
- [ ] Reconcile target/mode changes with the official `install apply` command.
- [ ] Remove the owned deployment when no targets remain.
- [ ] Serialize mutations and verify health/config after each action.
- [ ] Roll back/remove a failed apply and return an actionable error.
- [ ] Test every argv/env combination and prove arbitrary arguments cannot enter
      a process call.
- [ ] Commit: `feat: manage reversible headroom targets`

**Exit check:** Claude/Codex can be independently enabled and restored without
changing Engram or unrelated provider configuration.

## Increment 4 — Local API and security boundary

**Files:** `app/server.js`, `app/test/server.test.js`

- [ ] Add status, ranged savings, and settings endpoints.
- [ ] Reuse strict range parsing, same-origin action header, JSON-only body, and
      32 KiB mutation limit.
- [ ] Validate exact target/mode schemas and reject unknown fields.
- [ ] Add independent caching and `fresh=1` invalidation.
- [ ] Test unavailable/stopped/malformed Headroom without degrading other APIs.
- [ ] Test concurrent settings requests and failed reconciliation.
- [ ] Commit: `feat: expose secured headroom integration api`

**Exit check:** Browser input cannot select a binary, path, profile, port,
environment variable, or arbitrary CLI argument.

## Increment 5 — Settings and Token savings UI

**Files:** `app/static/index.html`, `app/static/app.js`,
`app/static/styles.css`, `app/test/frontend.test.js`

- [ ] Add Settings rows for Claude, Codex, and disabled Gemini.
- [ ] Add cache/token mode choice, explicit Apply confirmation, progress,
      success, conflict, restart, and removal states.
- [ ] Add Overview Headroom card with a link to detail.
- [ ] Add Token savings navigation and view.
- [ ] Render measured input reduction, by-agent table, daily trend, transform
      details, cache/filtering separation, reliability, and overhead.
- [ ] Render truthful not-installed, not-enabled, no-traffic, stale, partial,
      incompatible, and unknown-client states.
- [ ] Add accessible descriptions for every percentage denominator.
- [ ] Verify safe DOM construction, keyboard flow, focus, narrow layouts, and
      chart destruction before recreation.
- [ ] Commit: `feat: add headroom controls and token savings view`

**Exit check:** Users can safely control supported agents and understand exactly
which tokens were reduced, over what period, by which measurement.

## Increment 6 — Integration and regression verification

- [ ] Run the complete Node and shell test suites twice.
- [ ] Test a fresh isolated Headroom install on Python 3.13.
- [ ] Enable Claude only, Codex only, both, and neither; diff and restore config.
- [ ] Generate privacy-safe synthetic traffic and reconcile UI totals with
      Headroom's CLI/API.
- [ ] Exercise proxy stop/restart, app restart, version mismatch, port conflict,
      and corrupted state.
- [ ] Confirm bare agent operation after removal.
- [ ] Confirm Engram MCP/pointers remain intact and no memory/learn/output-shape
      features or anonymous telemetry are enabled.
- [ ] Smoke-test the packaged Electron app so the adapter is present in ASAR and
      the Headroom binary is found outside Electron's reduced PATH.
- [ ] Commit: `test: verify headroom lifecycle and savings reporting`

**Exit check:** All supported transitions are reversible, measured totals match
upstream, and existing advisor/usage behavior remains green.

## Increment 7 — README and real screenshot

**Files:** `README.md`, `docs/assets/dashboard.png`

- [ ] Capture the implemented Token savings view with sanitized fixture data at
      Retina resolution near the existing 3024×1718 asset.
- [ ] Inspect the PNG for private data, clipping, blur, stale version text, and
      misleading metrics before replacing the existing screenshot.
- [ ] Update What you get, optional setup, architecture diagram, compatibility,
      privacy, day-to-day usage, and troubleshooting.
- [ ] Explain measured versus benchmark savings and the cache/token modes.
- [ ] Add Headroom to Built on with its repository and Apache-2.0 role.
- [ ] Preserve all existing upstream credits.
- [ ] Commit: `docs: document optional headroom integration`

**Exit check:** README matches shipped behavior and its screenshot is produced
from the verified implementation, not a mockup.

## Increment 8 — Review and distribution (separate approval)

- [ ] Present diff, tests, real config restoration evidence, screenshot, and
      known compatibility limits for review.
- [ ] Obtain explicit implementation approval.
- [ ] Bump application version and release notes.
- [ ] Build and smoke-test the universal DMG.
- [ ] Push, publish a GitHub release, update Homebrew, and reinstall only after
      separate approval.

**Exit check:** Any released artifact matches the reviewed commit; no release or
machine installation is implied by approval of this plan.
