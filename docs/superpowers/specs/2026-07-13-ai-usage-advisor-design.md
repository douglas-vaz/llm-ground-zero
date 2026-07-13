# AI Usage Advisor — Product and Technical Specification

**Date:** 2026-07-13

**Status:** Approved for implementation

**Branch:** `codex/ai-usage-advisor`

## 1. Summary

Evolve LLM Ground Zero from a raw usage dashboard into a personal AI usage
advisor for software engineering, product research, and prototyping. The new
experience should answer four questions:

1. What useful work did my AI tools help me complete?
2. Where did I lose time, tokens, or money to avoidable friction?
3. Which decisions and workflows are compounding through reuse?
4. What is the single highest-leverage action I can take next?

The existing spend, token, tool, conversation, and memory views remain
available. Advisor metrics are derived locally from session logs, `ccusage`,
and Engram. No session content leaves the machine.

## 2. Product principles

### 2.1 Evidence before advice

Every recommendation must expose its evidence: affected sessions, observed
events, calculation window, and confidence. The UI must not present inferred
outcomes or approximate cost as facts.

### 2.2 Useful without configuration

The advisor works immediately with local logs. Configuring subscription prices
improves plan-fit analysis but is not required. Missing or unsupported cost data
produces an explicit coverage message, never a fabricated zero or estimate.

### 2.3 Local and reversible

Agent logs and Engram remain read-only inputs. The app may write only its own
preferences and user annotations. Draft-generating CTAs preview and copy text;
they do not silently edit repositories, agent instructions, or Engram.

### 2.4 Progressive disclosure

The Overview ranks no more than three next moves. Detailed evidence lives in
the Waste audit, Outcome ledger, Knowledge, and Usage views.

## 3. Goals and success criteria

### Goals

- Provide a trustworthy weekly summary of outcomes, friction, knowledge reuse,
  and API-equivalent usage.
- Detect recurring, actionable patterns across Claude Code and Codex sessions.
- Turn insights into safe next actions: draft a rule, prepare a context pack,
  resume work, annotate an outcome, or create a reusable workflow.
- Preserve all current dashboard functionality and browser-only operation.
- Keep the implementation dependency-light and testable with synthetic logs.

### Success criteria

- A new user with at least three recent sessions sees a useful Overview without
  entering settings.
- Every aggregate links to or names the sessions and signals behind it.
- User annotations survive restart and override automated classification.
- Unsupported cost coverage is visible alongside any monetary metric.
- Empty, partial, and malformed data sources degrade independently.
- The full test suite passes with no network, real agent installation, or real
  user data.

## 4. Non-goals for the first release

- Semantic analysis that requires an API key or local model.
- Automatic editing of `AGENTS.md`, skills, handoffs, repositories, or Engram.
- Claims that an AI session caused a business outcome.
- Team reporting, cloud sync, accounts, or remote access.
- Exact wall-clock productivity measurement.
- Automatic web verification of saved sources.
- Support for agents whose log formats are not already available locally.

## 5. Information architecture

The header retains sync status, date range, and manual refresh. The dashboard
uses five keyboard-accessible views:

1. **Overview** — three core metrics, allocation summary, and up to three ranked
   recommendations.
2. **Waste audit** — detected friction patterns with evidence and a safe CTA.
3. **Outcome ledger** — session-to-outcome classification, cost/tokens, and
   manual correction.
4. **Knowledge** — capture, reuse, review, and repeated-workflow signals.
5. **Usage** — the current spend, block, model, tool, conversation, and memory
   dashboard, preserved as a detailed view.

The selected view is stored in the URL hash so reload and browser back/forward
preserve navigation without server state.

## 6. Shared controls and states

### Date range

- Presets: 7 days (default), 30 days, 90 days.
- The same range applies to every advisor view.
- Usage charts keep their existing natural periods where necessary, but label
  any mismatch clearly.

### Loading and refresh

- One page-level refresh starts all data requests.
- Each view renders independently after its request settles.
- Refresh disables only the refresh control; already rendered data remains
  visible until replaced.

### Empty and low-confidence states

- Fewer than three sessions: show available usage and explain that pattern
  detection needs more sessions.
- No cost data: show tokens and a cost-coverage note.
- No Engram database: show capture suggestions, not an error for the whole view.
- Low-confidence signals are labelled and are never included in the top-three
  recommendations unless no higher-confidence signal exists.

## 7. Feature specification

### 7.1 Overview

#### Core metrics

1. **Outcome yield** — confirmed or high-confidence completed outcomes divided
   by eligible sessions. Display numerator and denominator.
2. **Estimated avoidable usage** — friction-window API-equivalent cost and
   active time, with percentage coverage. If cost coverage is below 50%, lead
   with time/interactions rather than dollars.
3. **Knowledge-assisted sessions** — sessions containing a successful Engram
   recall before a completion signal. This is correlation and must be labelled
   “memory-assisted,” not “time saved.”

#### Allocation summary

Display a single stacked bar for the selected range:

- Productive: confirmed/high-confidence outcome windows.
- Exploration: eligible activity not classified as productive or friction.
- Friction: detected failure/recovery/repetition windows.

The legend includes estimated active time. Unknown/unclassified time is folded
into Exploration and disclosed in the accessible description.

#### Ranked recommendations

Show at most three. Rank by:

`estimated recoverable minutes × confidence × recurrence weight`

Tie-break by most recent occurrence. Each recommendation includes:

- concise action;
- evidence count and affected project(s);
- estimated benefit only when calculable;
- confidence;
- primary CTA and “See evidence.”

### 7.2 Waste audit

#### Signal types

1. **Repeated briefing** — substantially similar user context appears in at
   least three sessions for the same project.
2. **Failure recovery churn** — a failed tool call is followed by repeated file
   reads or repeated commands before the next successful forward action.
3. **Repeated file reads** — the same canonical file is read three or more
   times in one session, excluding deliberate test reruns and generated files.
4. **Explicit reverts** — successful `git revert`, `git restore`, or equivalent
   rollback commands following AI-produced changes.
5. **Repeated unresolved decision** — a prompt cluster containing decision or
   trade-off language recurs without a corresponding successful memory save.
6. **Possibly unfinished session** — a session has meaningful work activity but
   no completion signal or user annotation. This wording is intentionally
   cautious.

#### Repeated-briefing algorithm

- Normalize Unicode, case, whitespace, file paths, UUIDs, timestamps, and long
  numeric literals.
- Remove instruction wrappers already treated as noise.
- Require at least 40 normalized characters.
- Build word 3-shingles and compare within the same project only.
- Cluster prompts with Jaccard similarity `>= 0.65`.
- Require occurrences in at least three distinct sessions.
- Store excerpts only in the API response; never persist prompt text in app
  state.

#### Failure detection

Prefer structured fields (`is_error`, non-zero exit code, failed tool status).
Use text matching only inside tool-result payloads, not assistant prose. Text
fallbacks include bounded patterns such as `exit code N`, `command failed`, and
`error:`. Ignore expected negative test assertions where identifiable.

#### Active-time and cost estimate

- Active time is the sum of gaps between chronological session events, capped
  at five minutes per gap.
- A friction window begins at the initiating failed/repeated event and ends at
  the next successful forward action, capped at ten minutes.
- Friction cost is session API-equivalent cost multiplied by the ratio of
  friction active time to total active time.
- Only sessions with non-zero, attributable `ccusage session` cost contribute
  dollars. The UI displays cost coverage by sessions and tokens.
- These values are always labelled “estimated.”

#### CTAs

- **Draft AGENTS.md rule** — generate a concise proposed rule from the repeated
  briefing and copy it after user confirmation.
- **Generate context pack** — preview a Markdown summary of project, relevant
  files, decisions, failures, and next action; allow copy/download.
- **Capture decision draft** — format a title, decision, reason, alternatives,
  and evidence for manual saving.
- **Review session** — navigate to the matching ledger entry and evidence.

No CTA writes to agent-owned files in this release.

### 7.3 Outcome ledger

#### Ledger row

Each eligible session shows:

- start/last activity time;
- agent and project;
- first real user prompt, truncated in the table;
- outcome type and status;
- classification source and confidence;
- total tokens and API-equivalent cost when available;
- actions to inspect evidence, mark outcome, or prepare a resume pack.

#### Statuses

- `shipped` — explicit externalized result such as a successful commit, PR,
  release, deployment, or published artifact.
- `completed` — a strong local completion signal without a shipped artifact.
- `paused` — manually marked as worth resuming.
- `abandoned` — manually marked as intentionally stopped.
- `unreviewed` — no reliable automated or manual classification.

Automated analysis may assign only `shipped`, `completed`, or `unreviewed`.
Only the user assigns `paused` or `abandoned`.

#### Outcome types

`code`, `research`, `document`, `prototype`, `operations`, or `other`.
Automatic type detection requires explicit tool/file evidence and may remain
`other`. User annotation always overrides it.

#### Classification rules

- Manual annotation: confidence 1.0.
- Successful commit, PR creation, release, or deployment command: `shipped`,
  confidence 0.9.
- Successful test/build plus a final response after file changes: `completed`,
  confidence 0.7.
- Assistant prose alone never produces `shipped`.
- No signal: `unreviewed`; do not infer abandonment from inactivity.

#### Metrics

- Outcome yield uses manual annotations and classifications with confidence
  `>= 0.7`.
- Cost per outcome includes only sessions with attributable non-zero cost and
  displays coverage.
- Unfinished value counts user-marked `paused` sessions only; the UI may list
  “possibly unfinished” suggestions separately.

#### CTAs

- **Mark outcome** — persists status, type, optional note, and timestamp in the
  app-owned state file.
- **Prepare resume pack** — creates a copyable prompt containing the original
  goal, recent evidence, captured decisions, and suggested next action.
- **Set plan costs / Review plan fit** — opens subscription settings or the
  plan comparison, never assumes a subscription price.

### 7.4 Knowledge compounder

#### Metrics

1. **Captured knowledge** — successful `mem_save` calls and Engram observations
   created in range.
2. **Memory-assisted sessions** — successful `mem_search`/`mem_context` before a
   completion signal in the same session.
3. **Suggested captures** — repeated briefings or decisions without an observed
   successful memory save.

“Time saved” is not shown in the first release because the logs cannot prove a
counterfactual.

#### Signals

- **Decisions ready to capture** — repeated decision-oriented briefing without
  a memory save.
- **Reusable workflow** — the same ordered tool-category sequence appears in at
  least three completed sessions for the same project or task family.
- **Sources due for review** — URLs in Engram observations older than a
  configurable 90-day threshold. “Due for review” does not claim staleness.
- **Knowledge reused** — a successful Engram recall followed by a completion
  signal; display as correlation.

#### CTAs

- **Draft decision memory** — preview/copy structured memory text.
- **Create skill outline** — preview/copy a `SKILL.md` outline with trigger,
  inputs, ordered steps, verification, and failure handling.
- **Create verification checklist** — extract source labels/URLs into a local
  checklist; do not browse automatically.

### 7.5 Plan-fit analysis

The user may configure monthly subscription entries with provider, plan label,
monthly price, and currency. No default price is assumed.

For a range, compare prorated subscription cost with attributable
API-equivalent usage:

`prorated plan cost = monthly price × days in range / 30.4375`

Display:

- subscription cost for the range;
- API-equivalent usage with pricing coverage;
- difference, labelled “API-equivalent value above/below plan cost”;
- recommendation: keep, review, or insufficient data.

Do not recommend cancellation from fewer than 30 days of data or below 80%
pricing coverage.

## 8. Data architecture

### 8.1 Inputs

| Input | Use | Access |
|---|---|---|
| `ccusage session --json` | Per-session tokens, cost, agent, model, activity | subprocess, read-only |
| `ccusage daily/blocks --json` | Existing Usage view | subprocess, read-only |
| `~/.claude/projects/**/*.jsonl` | Prompts, tools, results, timestamps, cwd | read-only |
| `~/.codex/sessions/**/rollout-*.jsonl` | Prompts, calls, outputs, timestamps, cwd | read-only |
| Engram SQLite | Observations and capture/reuse metadata | SQLite read-only |
| App advisor state | Subscriptions and manual outcome annotations | app-owned read/write |

### 8.2 Normalized session model

```js
{
  id, agent, project, cwd, sourceFile,
  startedAt, lastActivityAt, title,
  usage: { inputTokens, outputTokens, cacheTokens, totalTokens, costUSD, priced },
  events: [{ at, kind, tool, status, file, commandCategory, textFingerprint }],
  outcome: { status, type, confidence, source, evidenceIds },
  signals: [{ id, type, confidence, activeMs, evidenceIds }]
}
```

Raw prompt and tool-result text exists only during parsing and in bounded
evidence excerpts returned to the same local client. Stored annotations refer
to stable session IDs and never duplicate raw conversation content.

### 8.3 Module boundaries

Keep pure analysis separate from I/O:

- `app/lib.js` — existing low-level helpers and compatibility exports.
- `app/advisor/parsers.js` — Claude/Codex event normalization.
- `app/advisor/usage.js` — join `ccusage session` records to log sessions.
- `app/advisor/friction.js` — signal detection and estimates.
- `app/advisor/outcomes.js` — classification and annotation merge.
- `app/advisor/knowledge.js` — Engram/workflow analysis.
- `app/advisor/summary.js` — Overview metrics and recommendation ranking.
- `app/advisor/store.js` — validated, atomic app-owned state persistence.

All analysis functions accept plain objects and return plain objects. Filesystem,
SQLite, and subprocess access remain at adapters/routes so fixtures can test the
analysis without real installations.

### 8.4 API

#### Read routes

- `GET /api/advisor?range=7d|30d|90d`
- `GET /api/advisor/evidence?id=<signal-id>`
- `GET /api/advisor/settings`
- Existing endpoints remain compatible.

The main advisor response contains `generatedAt`, `range`, `coverage`,
`overview`, `friction`, `outcomes`, and `knowledge`. Evidence excerpts are
loaded on demand to keep the initial payload bounded.

#### Mutation routes

- `PUT /api/advisor/settings`
- `PUT /api/advisor/outcomes/:sessionId`
- `DELETE /api/advisor/outcomes/:sessionId`

Mutation requirements:

- JSON only, maximum 32 KiB request body.
- Require same-origin `Origin` and `X-LLM-Ground-Zero-Action: 1`.
- Reject unknown fields and invalid enums.
- Atomic write via temporary file plus rename; permissions `0600`.
- Never accept or resolve arbitrary filesystem paths.
- Mutations invalidate advisor cache only.

### 8.5 App-owned state

Default location:

`~/Library/Application Support/LLM Ground Zero/advisor.json`

```json
{
  "schemaVersion": 1,
  "subscriptions": [],
  "outcomes": {
    "stable-session-id": {
      "status": "paused",
      "type": "prototype",
      "note": "Resume after pricing review",
      "updatedAt": "2026-07-13T12:00:00.000Z"
    }
  }
}
```

The server accepts an environment override for tests. Corrupt state is backed
up and replaced with defaults; the UI receives a non-sensitive warning.

## 9. Performance and resilience

- Default scan: 7 days; hard maximum: 90 days and 300 sessions.
- Filter candidates by filename/mtime before parsing.
- Skip individual files larger than 20 MiB and report coverage impact.
- Cache normalized sessions separately from range-specific analysis.
- Keep the existing 60-second response cache and pending-promise coalescing.
- Advisor analysis target: under 1.5 seconds for 100 sessions on a modern Mac
  after `ccusage` returns.
- Malformed rows, unknown event types, and missing directories are skipped and
  counted in coverage warnings.
- One agent/data-source failure must not suppress results from others.

## 10. Accessibility and responsive UX

- Tabs use native buttons with `aria-pressed` or an ARIA tab pattern and work by
  keyboard.
- Every chart has an accessible name and text equivalent.
- Color is never the only status indicator.
- Tables reflow to labelled rows below 560 px; no horizontal page scrolling.
- CTAs have visible verbs and confirmation/undo where state changes.
- Focus moves to opened evidence or edit form and returns to its trigger when
  closed.
- Loading, save success, and errors use polite live regions.

## 11. Privacy and security

- Bind only to `127.0.0.1`, retain the existing CSP, and add no remote assets.
- Do not log prompts, evidence excerpts, commands, paths, subscription prices,
  or annotation notes.
- Error logs remain sanitized.
- Never render log content with `innerHTML`.
- Do not expose source file paths in the default API response.
- App-owned writes are limited to the advisor state path and atomic temp file.
- Update README wording from “read-only app” to clarify: agent data is always
  read-only; only explicit preferences and annotations are stored by the app.

## 12. Testing strategy

### Unit tests

- Claude and Codex normalization from synthetic JSONL.
- Stable session joining with `ccusage session` records.
- Prompt normalization, shingling, clustering, and project isolation.
- Structured failure detection and text false-positive cases.
- Active-time/friction-window/cost calculations and coverage.
- Outcome precedence: manual > shipped evidence > completed > unreviewed.
- Workflow recurrence and Engram capture/recall signals.
- Recommendation ranking and three-item limit.
- State schema validation, atomic writes, corruption recovery, and permissions.

### Server tests

- Read routes, range validation, caching, and independent degradation.
- Mutation method/content-type/header/origin/body-size validation.
- Unknown field/path traversal rejection.
- Advisor cache invalidation after settings or annotation changes.
- Existing endpoints and CSP remain unchanged.

### Frontend tests

- No unsafe HTML insertion or remote assets.
- Tab/hash navigation, loading, empty/error/coverage states.
- Rendering uses honest labels for estimated and unsupported values.
- Outcome edits persist through the API and update derived metrics.
- CTAs create previews/copies without silent writes.
- Existing Usage charts still render and refresh without leaked Chart instances.

### Manual acceptance

- Verify 1280×860 Electron window and browser widths at 736, 560, and 320 px.
- Keyboard-only navigation and visible focus.
- Run with Claude only, Codex only, both, no Engram, no cost, and corrupt state.
- Inspect a recommendation from summary through evidence to CTA.
- Confirm no agent-owned file changes before and after all CTAs.

## 13. Product decisions requested in review

Approval of this spec approves these deliberate choices:

1. Preserve the existing dashboard as a fifth **Usage** view.
2. Add app-owned persistence only for subscription settings and manual outcome
   annotations; agent data remains read-only.
3. Keep rule/context/decision/skill CTAs as preview-and-copy actions in v1.
4. Use transparent heuristics and confidence instead of an LLM classifier.
5. Replace unverifiable “time saved” claims with estimated friction time,
   attributable cost, and memory-assisted-session counts.
