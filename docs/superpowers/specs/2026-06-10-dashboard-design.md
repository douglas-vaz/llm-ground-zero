# llm-ground-zero Dashboard — Design

**Date:** 2026-06-10
**Status:** Implemented (design delegated by user: "You decide how it looks, what it shows")

## Goal

A local web UI showing (1) tool usage and how much of each, (2) spending,
(3) recent conversations — plus anything else interesting that local data
supports.

## Constraints (inherited from the repo)

- Zero new runtime dependencies: Python 3 stdlib server, Chart.js via CDN.
- Read-only over existing local data; no background services. Run on demand:
  `./dashboard/serve.sh` → http://localhost:7788.
- Reproducible: ships in the repo, works on any machine that ran `setup.sh`.

## Data sources

| Panel | Source |
|---|---|
| Spend, tokens, models, agents | `ccusage daily --json` (subprocess, 60s cache) |
| Claude Code internal tool usage (Bash/Edit/Read…) | `~/.claude/projects/*/*.jsonl` — count `tool_use` blocks in assistant messages |
| Recent conversations | Claude: same jsonl (first real user text, cwd, timestamp). Codex: `~/.codex/sessions/**/rollout-*.jsonl` (session_meta + first user message, skipping `<environment_context>` wrappers) |
| Memory feed | `data/engram.db` SQLite `observations` table (read-only) |

## Architecture

```
dashboard/
├── serve.sh          # launcher (python3 server.py)
├── server.py         # stdlib http.server: /api/usage /api/tools /api/conversations /api/memories + static
├── lib.py            # pure parsing/aggregation functions (unit-tested)
├── static/index.html # single-page dark dashboard, Chart.js CDN
└── test_lib.py       # unittest with jsonl fixtures
```

`lib.py` is pure (paths in, dicts out) so it is testable without HTTP.

## Panels

1. **Stat cards:** spend this month, spend today, API-equivalent total vs
   subscription framing ("what this would have cost at API prices"),
   cache-read ratio (cache hit efficiency), total tokens, sessions count.
2. **Daily spend chart** (last 30 days, stacked bars by agent).
3. **Model donut** — cost share per model.
4. **Agent/CLI split** — Claude vs Codex vs others, tokens + cost.
5. **Claude Code tool usage** — horizontal bars: Bash, Edit, Read, Write,
   TodoWrite, MCP tools etc., counted over last 30 days of session logs.
6. **Recent conversations** — unified list across Claude + Codex: agent
   badge, project (basename of cwd), first prompt (truncated), relative time.
7. **Memory feed** — latest Engram observations (type, title, project, age).

## Error handling

Each /api endpoint degrades independently: missing ccusage → usage panel
shows error chip; missing engram.db → empty memory feed with hint; absent
Codex dir → Claude-only conversations. Server never 500s the whole page.

## Out of scope

Auth (localhost only), write operations, historical snapshots, non-local
access.
