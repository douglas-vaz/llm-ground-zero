# AI Usage Advisor — Incremental Implementation Checklist

**Status:** Implemented — verification complete; awaiting review

**Branch:** `codex/ai-usage-advisor`

**Spec:** `docs/superpowers/specs/2026-07-13-ai-usage-advisor-design.md`

## Delivery rules

- [x] Confirm the specification and five product decisions are approved.
- [x] Keep every increment independently testable and reviewable.
- [x] Write or update failing tests before production code for each increment.
- [x] Run `cd app && npm test` after implementation increments and twice during
      integrated verification.
- [x] Preserve unrelated user changes, including untracked `context/ai-central/`.
- [x] Commit coherent increments; do not combine parsing, analysis,
      persistence, and UI into a single commit.
- [x] Do not push or release until the complete feature is reviewed.

Implementation consolidated closely related test files and UI increments where
that reduced duplication. The acceptance boxes below remain the item-level audit
record: checked items were directly verified; unchecked items are release-polish
or follow-up coverage, not claims that the core feature is absent.

## Increment 0 — Baseline and fixtures

**Purpose:** Lock in existing behavior and create privacy-safe synthetic inputs.

- [ ] Run and record the current test baseline.
- [ ] Add synthetic Claude JSONL fixtures for prompts, reads, command success,
      command failure, memory calls, commits, and incomplete sessions.
- [ ] Add equivalent synthetic Codex rollout fixtures.
- [ ] Add `ccusage session --json` fixtures with priced, zero-priced, and missing
      sessions.
- [ ] Add Engram rows for capture, recall, old URLs, and deleted observations.
- [ ] Add regression tests proving fixtures contain no real usernames, paths,
      prompts, IDs, or costs.
- [ ] Commit: `test: add advisor analysis fixtures`

**Exit check:** Existing tests pass; fixtures cover both agents and partial-data
cases without any production behavior change.

## Increment 1 — Normalized session/event layer

**Files:** `app/advisor/parsers.js`, `app/lib.js`, `app/test/advisor-parsers.test.js`

- [ ] Test Claude session metadata, prompts, tool calls/results, timestamps,
      files, command categories, Engram calls, and structured failures.
- [ ] Test Codex equivalents and unknown event tolerance.
- [ ] Test noise removal and bounded evidence excerpts.
- [ ] Test stable session IDs without exposing source paths.
- [ ] Implement shared normalized session/event types as plain objects.
- [ ] Retain current `claudeConversations`, `codexConversations`, and tool-count
      exports as compatibility wrappers over the new parser where practical.
- [ ] Enforce range, session-count, and file-size limits with coverage warnings.
- [ ] Commit: `feat: normalize local agent sessions for analysis`

**Exit check:** Synthetic Claude and Codex sessions produce the same normalized
shape; current conversations/tools tests still pass.

## Increment 2 — Per-session usage join and coverage

**Files:** `app/advisor/usage.js`, `app/server.js`, `app/test/advisor-usage.test.js`

- [ ] Add a cached `ccusage session --json` adapter.
- [ ] Test exact Claude ID matching and Codex rollout-period matching.
- [ ] Test unmatched, ambiguous, zero-cost, and unsupported model pricing.
- [ ] Implement usage totals plus explicit session/token/cost coverage.
- [ ] Ensure zero-priced sessions are “unpriced,” not “free.”
- [ ] Confirm existing daily and block subprocess behavior remains unchanged.
- [ ] Commit: `feat: attribute tokens and cost to advisor sessions`

**Exit check:** Each normalized session has tokens and truthful pricing state;
coverage explains every missing monetary value.

## Increment 3 — Waste audit analysis

**Files:** `app/advisor/friction.js`, `app/test/advisor-friction.test.js`

- [ ] Test prompt normalization and Jaccard similarity boundaries.
- [ ] Test repeated-briefing clustering requires three distinct same-project
      sessions and does not cross projects.
- [ ] Test structured failures and expected-error false positives.
- [ ] Test reread churn, explicit revert, unresolved decision, and possibly
      unfinished signals.
- [ ] Test active-time gap caps, friction windows, cost allocation, and overlap
      de-duplication.
- [ ] Attach stable evidence IDs, confidence, project, recurrence, active time,
      attributable cost, and coverage to every signal.
- [ ] Commit: `feat: detect explainable AI workflow friction`

**Exit check:** Every waste signal can be traced to synthetic evidence and no
metric claims more precision than its inputs support.

## Increment 4 — Outcome ledger and annotations

**Files:** `app/advisor/outcomes.js`, `app/advisor/store.js`,
`app/test/advisor-outcomes.test.js`, `app/test/advisor-store.test.js`

- [ ] Test shipped evidence for commit, PR, release, and deployment success.
- [ ] Test completed classification requires build/test plus final response.
- [ ] Test assistant prose alone cannot produce shipped status.
- [ ] Test default unreviewed status and manual override precedence.
- [ ] Test outcome yield, cost-per-outcome coverage, and paused count.
- [ ] Implement validated state schema and environment override for tests.
- [ ] Test first-run defaults, atomic write, `0600` mode, corruption backup,
      unknown-field rejection, and note length limits.
- [ ] Commit: `feat: add outcome ledger analysis and local annotations`

**Exit check:** Automated status is cautious, user overrides persist safely,
and no agent-owned data is written.

## Increment 5 — Knowledge compounder analysis

**Files:** `app/advisor/knowledge.js`, `app/lib.js`,
`app/test/advisor-knowledge.test.js`

- [ ] Extend read-only Engram rows with stable IDs/session IDs needed for joins.
- [ ] Test successful capture and recall event recognition for both agents.
- [ ] Test memory-assisted-session correlation requires recall before completion.
- [ ] Test suggested captures exclude sessions with successful memory saves.
- [ ] Test recurring workflow detection across three completed sessions.
- [ ] Test “sources due for review” uses age only and never claims staleness.
- [ ] Generate structured, bounded decision/skill/source-checklist drafts.
- [ ] Commit: `feat: surface reusable AI knowledge patterns`

**Exit check:** Knowledge metrics distinguish observed capture/reuse from
suggestions and avoid counterfactual “time saved” claims.

## Increment 6 — Overview and recommendation ranking

**Files:** `app/advisor/summary.js`, `app/test/advisor-summary.test.js`

- [ ] Test outcome yield and memory-assisted counts with denominators.
- [ ] Test productive/exploration/friction allocation totals and unknown folding.
- [ ] Test recommendation scoring, confidence handling, tie-breaks, and maximum
      of three results.
- [ ] Test behavior with fewer than three sessions and partial sources.
- [ ] Add plan-fit calculation with proration, coverage thresholds, and no
      cancellation advice below 30 days/80% pricing coverage.
- [ ] Commit: `feat: rank personal AI usage recommendations`

**Exit check:** One pure function builds a complete advisor response from
normalized sessions, signals, memories, usage, and settings.

## Increment 7 — Advisor API and security boundary

**Files:** `app/server.js`, `app/test/server.test.js`

- [ ] Add `GET /api/advisor` with strict 7d/30d/90d validation.
- [ ] Add bounded on-demand evidence route.
- [ ] Add settings and outcome annotation read/mutation routes.
- [ ] Test JSON-only, 32 KiB maximum body, required action header, same-origin
      checks, valid enums, unknown fields, and malformed JSON.
- [ ] Test arbitrary paths cannot enter request or state handling.
- [ ] Test advisor-only cache invalidation after mutations.
- [ ] Test independent degradation when Claude, Codex, Engram, state, or
      `ccusage` is unavailable.
- [ ] Confirm all old endpoints, GET-only behavior outside explicit mutation
      routes, cache coalescing, CSP, and health endpoint still pass.
- [ ] Commit: `feat: expose local advisor API safely`

**Exit check:** API contracts are covered at the HTTP boundary and mutations
cannot write outside the app-owned state file.

## Increment 8 — Navigation shell and Overview UI

**Files:** `app/static/index.html`, `app/static/styles.css`,
`app/static/app.js`, `app/test/frontend.test.js`

- [ ] Add accessible Overview, Waste audit, Outcome ledger, Knowledge, and Usage
      navigation with hash/history behavior.
- [ ] Move the existing dashboard into Usage without changing chart semantics.
- [ ] Add shared date-range control, refresh state, and coverage messaging.
- [ ] Render Overview metrics, one stacked allocation chart, plan-fit note, and
      up to three recommendations.
- [ ] Add Overview loading, insufficient-data, partial-cost, and error states.
- [ ] Test safe text rendering, keyboard semantics, and no remote assets.
- [ ] Commit: `feat: add advisor overview and dashboard navigation`

**Exit check:** First render is useful, existing Usage view is intact, and all
Overview values come from API data rather than display constants.

## Increment 9 — Waste audit UI and draft CTAs

**Files:** `app/static/index.html`, `app/static/styles.css`,
`app/static/app.js`, `app/test/frontend.test.js`

- [ ] Render ranked signal rows with confidence, recurrence, impact, and
      evidence controls.
- [ ] Add an accessible evidence detail surface loaded on demand.
- [ ] Implement rule, context-pack, and decision preview flows.
- [ ] Add copy and Markdown download actions with success/error live messages.
- [ ] Confirm previews do not call mutation endpoints or write agent data.
- [ ] Verify narrow layouts stack actions and never require horizontal scroll.
- [ ] Commit: `feat: add actionable waste audit experience`

**Exit check:** A user can move from a recommendation to its evidence and copy
a useful draft without hidden side effects.

## Increment 10 — Outcome ledger UI

**Files:** `app/static/index.html`, `app/static/styles.css`,
`app/static/app.js`, `app/test/frontend.test.js`

- [ ] Render responsive ledger rows with status, type, source/confidence,
      tokens, cost, and coverage.
- [ ] Add outcome edit form with status/type/note validation.
- [ ] Persist add/edit/remove annotations and refresh dependent metrics.
- [ ] Add resume-pack preview/copy.
- [ ] Add subscription settings and plan-fit review.
- [ ] Confirm a failed save preserves form state and reports a useful error.
- [ ] Commit: `feat: add editable outcome and plan ledger`

**Exit check:** Manual classifications survive restart and immediately override
inference throughout Overview and Outcome ledger.

## Increment 11 — Knowledge UI

**Files:** `app/static/index.html`, `app/static/styles.css`,
`app/static/app.js`, `app/test/frontend.test.js`

- [ ] Render capture, memory-assisted, and suggested-capture metrics.
- [ ] Render decision, reusable workflow, review-due, and reuse signals.
- [ ] Add decision-memory, skill-outline, and verification-checklist previews.
- [ ] Add copy/download feedback; do not auto-save to Engram or browse sources.
- [ ] Add no-Engram and low-sample states.
- [ ] Commit: `feat: add knowledge compounder experience`

**Exit check:** The page clearly separates observations, correlations, and
suggestions and every CTA is safe and reversible.

## Increment 12 — Integrated verification and polish

- [x] Run `cd app && npm test` from a clean process twice.
- [ ] Run the app against synthetic data with each source present/missing.
- [ ] Measure initial and cached analysis with 100 synthetic sessions; meet or
      document the 1.5-second analysis target.
- [ ] Verify keyboard-only operation and focus behavior.
- [ ] Verify Electron at 1280×860 and browser widths 736, 560, and 320 px.
- [x] Verify browser widths 560 and 320 px have no horizontal overflow; retain
      existing Chart instance destruction before recreation.
- [ ] Exercise all CTAs and compare agent-owned files before/after.
- [ ] Inspect sanitized error logs for prompt/path/note/price leakage.
- [x] Update README architecture, privacy, data sources, and advisor usage.
- [x] Update the project handoff with implementation status and remaining work.
- [ ] Commit: `docs: document AI usage advisor and privacy model`

**Exit check:** Tests, privacy checks, accessibility checks, responsive review,
and documentation are complete.

## Increment 13 — Review, release, and distribution (separate approval)

- [ ] Present implementation diff, test results, screenshots, and known limits.
- [ ] Obtain explicit approval to release.
- [ ] Bump version and release notes.
- [ ] Build the universal macOS DMG.
- [ ] Install and smoke-test the built app locally.
- [ ] Push the feature branch and open/review the PR, or merge as directed.
- [ ] Publish GitHub release and update the Homebrew cask only after approval.
- [ ] Reinstall through Homebrew and verify the displayed version.

**Exit check:** The released Homebrew installation matches the approved commit;
release actions are not part of implementation approval by default.
