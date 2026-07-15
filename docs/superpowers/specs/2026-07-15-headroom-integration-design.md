# Optional Headroom Integration — Product and Technical Specification

**Date:** 2026-07-15

**Status:** Implemented for llm-ground-zero v0.3.0

**Upstream baseline:** Headroom v0.31.0 (released 2026-07-09)

## 1. Summary

Add Headroom as an optional local context-compression layer for supported agent
apps. Users can independently enable it for Claude Code and Codex, inspect
measured token reduction in LLM Ground Zero, and remove it reversibly. Gemini
remains visible but unavailable until Headroom publishes a supported Gemini CLI
wrapper or persistent-install target.

Headroom is disabled by default. Engram remains the single shared-memory system;
the integration does not enable Headroom memory, learning, or output shaping in
the first release.

## 2. Research findings

### Supported upstream surface

- Headroom runs a local proxy between an agent and its existing provider. It
  supports Anthropic messages, OpenAI chat/responses, and Codex WebSockets.
- v0.31.0 has reversible persistent deployment commands and explicit provider
  targets: `headroom install apply ... --target claude --target codex` and
  `headroom install remove --profile ...`.
- Claude Code and Codex are supported targets. Gemini traffic is handled by the
  proxy internally, but Gemini CLI is not a supported `wrap` or persistent
  install target in v0.31.0. We must not imply otherwise.
- The supported machine-readable metrics are the loopback `/stats` and
  `/stats-history` endpoints plus `headroom perf --raw --format json`. PERF
  records include client, model, tokens before/after/saved, cache tokens,
  optimization latency, output tokens, and transform names.
- Durable Headroom state can be isolated with `HEADROOM_WORKSPACE_DIR`; this is
  preferable to mixing LLM Ground Zero traffic with a user's unrelated
  `~/.headroom` deployment.
- Headroom documents approximately 15–20% reduction for coding-agent workloads,
  while much higher figures apply to favorable structured-data workloads. The
  product must show locally measured results, not repeat a generic benchmark as
  the user's saving.

### Integration hazards

- The Python CLI is not provided by the npm package. It must be installed from
  `headroom-ai` through `uv` or `pip`.
- Headroom's proxy install is much larger than a Node dependency and may fetch
  model/runtime assets. It should not be bundled into the Electron DMG.
- Python 3.14 can count tokens but lacks Headroom's LiteLLM pricing dependency;
  use Python 3.13 when installing the pinned integration.
- Headroom can also provide memory, learning, RTK guidance, and output shaping.
  Those overlap with Engram, shared AGENTS instructions, advisor waste signals,
  and response preferences. They stay off unless separately designed.
- Provider configuration is external mutable state. Changes must be explicit,
  allowlisted, reversible, and owned by a dedicated Headroom profile.
- Existing custom `model_provider`, `openai_base_url`, or Anthropic base URL
  settings can conflict with proxy injection. Preflight must stop and explain
  the conflict instead of overwriting it.
- A reduction denominator can be misleading. Whole-request context includes
  protected/frozen prefixes, while active compression covers only eligible new
  content. The UI must name each denominator.

## 3. Product decisions

### 3.1 Opt-in per agent

Add a **Headroom** section to Settings with one row per currently supported LLM
Ground Zero agent:

| Agent | Control | First-release behavior |
|---|---|---|
| Claude Code | Toggle | Supported; routes Anthropic traffic through Headroom |
| Codex | Toggle | Supported; routes Responses/WebSocket traffic through Headroom |
| Gemini CLI | Disabled toggle | “Not supported by Headroom's CLI installer yet” |

Changing a supported toggle does nothing until the user selects **Apply**. The
confirmation names the configuration files and local service that will change.
Applying zero targets removes the LLM Ground Zero-owned Headroom deployment and
restores its managed provider configuration.

The same behavior is available non-interactively:

```bash
./setup.sh --headroom claude,codex --headroom-mode cache
```

Running `setup.sh` without Headroom flags preserves today's behavior and does
not install, enable, disable, or upgrade Headroom.

### 3.2 Dedicated, reversible deployment

LLM Ground Zero delegates provider mutation and service lifecycle to Headroom's
public installer instead of reimplementing its configuration writers:

```bash
HEADROOM_WORKSPACE_DIR="$HOME/Library/Application Support/LLM Ground Zero/headroom" \
  headroom install apply \
  --profile llm-ground-zero \
  --preset persistent-service \
  --scope provider \
  --providers manual \
  --target claude \
  --target codex \
  --port 8791 \
  --mode cache \
  --no-telemetry
```

Properties of this choice:

- profile and state are isolated from unrelated Headroom installations;
- only selected providers are changed;
- no shell-wide provider environment is injected;
- Headroom's manifest records reversible mutations;
- port 8791 avoids LLM Ground Zero's 7788 and Headroom's common 8787 default;
- anonymous telemetry is explicitly disabled;
- `--memory` is omitted, so Engram remains authoritative.

Default to `cache` mode because coding-agent sessions are long and provider
prefix-cache stability matters. Offer `token` mode as an advanced setting for
users who prefer maximum prompt reduction over cache stability. Changing mode
reconciles the same deployment profile.

### 3.3 Installation boundary

The Electron app never downloads Python packages. `setup.sh` handles the
explicit installation path, pinned to the tested upstream version:

```bash
uv tool install --python 3.13 "headroom-ai[proxy]==0.31.0"
```

The binary locator checks, in order:

1. `LLM_GROUND_ZERO_HEADROOM_BIN`;
2. the path recorded by `setup.sh` in app-owned integration state;
3. `PATH` and common `uv` tool locations.

If Headroom is absent or older than 0.31.0, Settings shows the exact setup
command and keeps Apply disabled. Upgrades are explicit; the app does not run a
background package update.

### 3.4 Token-savings experience

Add a sixth dashboard view, **Token savings**, and a compact Headroom card on
Overview. The detailed view contains:

1. **Measured input reduction** — proxy-compression tokens before, after,
   saved, and `saved / before`, for the selected 7/30/90-day range.
2. **By agent** — Claude, Codex, and Unknown rows with requests, before, after,
   saved, reduction percentage, and actual log coverage window.
3. **Daily combined trend** — saved tokens and reduction rate from durable
   daily rollups. This is combined because stable history is not yet broken
   down by client.
4. **How the saving happened** — transform counts/savings where available,
   cache reads kept separate from removed tokens, and CLI filtering kept as a
   separate layer.
5. **Reliability and overhead** — proxy health, failed requests, average/max
   optimization latency, Headroom version, selected mode, and last activity.

Never add proxy compression, CLI filtering, cache-read discounts, and output
shaping into one unlabeled number. They use different counterfactuals:

- proxy before/after is measured;
- CLI filtering is separately measured/estimated by its tool;
- cache reads reduce billed work but do not remove prompt content;
- output shaping is counterfactual unless a holdout is enabled.

Output shaping remains off in v1. If Headroom reports historical output-saving
data from another configuration, render it only in an Advanced disclosure with
Headroom's `measured`/`estimated` label and confidence interval.

### 3.5 Truthful empty and partial states

- Not installed: explain the optional setup; do not show zeros.
- Installed but no selected targets: show “Ready, not enabled.”
- Enabled but proxy stopped: preserve last durable totals, label them stale,
  and show a health action.
- Healthy but no traffic: show “No proxied requests yet.”
- PERF logs shorter than the selected range: show the actual coverage window.
- Unknown client: retain it as an Unknown row; never guess from model alone.
- Malformed or incompatible output: degrade the Headroom view only and log a
  sanitized integration error.

## 4. Architecture

Create `app/integrations/headroom.js` as the only module that knows Headroom's
binary, workspace, profile, port, CLI, and HTTP schemas. It exposes:

- `locate()` — binary path and semantic version;
- `status()` — installed/compatible, desired targets, manifest targets, proxy
  health, mode, and drift/conflict warnings;
- `readSavings(days)` — bounded `/stats`, `/stats-history`, and PERF aggregation;
- `reconcile({targets, mode})` — allowlisted apply/remove using `execFile`;
- `preflight()` — provider-config conflicts, port ownership, writable workspace,
  and current deployment health.

`app/server.js` adds:

- `GET /api/headroom/status`;
- `GET /api/headroom?range=7d|30d|90d`;
- `PUT /api/headroom/settings` with `{targets, mode}`.

The mutation uses the existing same-origin action header, JSON-only body, and
size limit. It additionally enforces:

- target set is a subset of `claude`, `codex`;
- mode is `cache` or `token`;
- fixed profile, workspace, host, and port;
- no shell execution or user-supplied arguments;
- one reconciliation at a time;
- post-apply status and health verification;
- rollback/removal through the official profile when apply fails.

The Headroom response cache is independent of advisor and usage caches. Live
status uses a short TTL; range aggregates use the existing 60-second policy and
honor `fresh=1`.

## 5. Data contract

Normalize upstream output before it reaches the browser:

```json
{
  "status": {
    "installed": true,
    "compatible": true,
    "version": "0.31.0",
    "healthy": true,
    "mode": "cache",
    "targets": ["claude", "codex"],
    "warnings": []
  },
  "coverage": {
    "requestedDays": 30,
    "oldest": "2026-06-16T00:00:00Z",
    "newest": "2026-07-15T00:00:00Z",
    "records": 120
  },
  "inputCompression": {
    "tokensBefore": 1000000,
    "tokensAfter": 820000,
    "tokensSaved": 180000,
    "reductionPercent": 18.0,
    "measurement": "measured"
  },
  "agents": [],
  "daily": [],
  "transforms": [],
  "cache": {},
  "reliability": {}
}
```

The server recomputes totals from bounded numeric records and rejects
non-finite, negative, or internally inconsistent values. Prompt bodies,
compressed messages, request IDs, auth values, config contents, and raw proxy
logs never enter the browser response.

## 6. Tests and acceptance criteria

### Unit and contract tests

- Binary discovery/version parsing, including missing and incompatible states.
- Manifest/status parsing and drift handling.
- Claude/Codex/unknown PERF normalization and 7/30/90-day aggregation.
- Correct weighted reduction (`sum(saved) / sum(before)`), never an average of
  percentages.
- No double counting across compression, cache, filtering, and output shaping.
- Malformed JSON, timeouts, partial fields, non-finite values, and oversized
  output fail closed for the panel and fail open for agent traffic.
- Exact `execFile` argv/env for every target/mode combination and removal.
- Preflight refuses conflicting config and occupied ports without mutation.
- Mutation authorization, serialization, rollback, and cache invalidation.

All tests use a fake Headroom executable and local fixture server. CI must not
install Headroom, alter real agent configs, bind the real port, or use real
session data.

### Integrated acceptance

- Enable Claude only, Codex only, both, then neither; verify each config diff
  and restoration.
- Run synthetic traffic for both clients and compare UI totals with
  `headroom perf --raw --format json` and `/stats-history`.
- Stop/restart the proxy and verify stale/durable states.
- Verify no Headroom memory database, learn block, output shaper, anonymous
  telemetry, or shell-global proxy variables are enabled.
- Confirm Engram MCP and shared AGENTS pointers survive every transition.
- Verify Electron and browser-only modes at desktop and narrow widths with no
  console errors or horizontal overflow.

## 7. README and screenshot

After the feature and real integration smoke test pass:

- replace `docs/assets/dashboard.png` with a privacy-safe screenshot of the
  implemented Token savings view; do not use a mockup;
- preserve approximately the current 3024×1718 Retina asset size and verify the
  image renders crisply in README;
- update “What you get,” installation, architecture, privacy, day-to-day use,
  troubleshooting, and the agent compatibility table;
- clarify that enabled agent requests still go to their existing provider,
  while compression and metrics processing happen locally;
- add Headroom to **Built on**, crediting its Apache-2.0 local proxy and linking
  to `headroomlabs-ai/headroom`;
- state the tested version and supported targets without copying upstream's
  generic benchmark claim into product results;
- keep the existing Engram, ccusage, tokscale, Electron, and Chart.js credits.

## 8. Explicit non-goals

- Bundling Python or Headroom in the DMG.
- Automatically upgrading Headroom.
- Gemini CLI proxy configuration before upstream support exists.
- Replacing Engram with Headroom memory.
- Running `headroom learn` or editing shared instructions through Headroom.
- Enabling output shaping by default.
- Claiming token reduction before measured traffic exists.
- Publishing, releasing, updating Homebrew, or installing the built app without
  a separate approval.
