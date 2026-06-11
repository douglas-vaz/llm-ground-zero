# Handoff — llm-ground-zero

## Current state
- Core setup shipped and verified: `setup.sh` (idempotent, sandbox-tested),
  shared `agents/AGENTS.md`, Engram MCP registered with Claude Code + Codex,
  ccusage/tokscale installed.
- Web dashboard shipped: `./dashboard/serve.sh` → http://localhost:7788.
  Stdlib Python server (`dashboard/server.py`) + tested parsers
  (`dashboard/lib.py`, run `python3 dashboard/test_lib.py`). Panels: spend,
  model/agent breakdowns, Claude Code tool usage, recent conversations
  (Claude + Codex), Engram memory feed.

## Recent decisions
- Engram over OpenMemory — user is subscription-only; OpenMemory needs an
  OpenAI key (or Ollama). Engram is keyless, single binary.
- Dashboard is read-only over local data; zero new deps (Chart.js via CDN).
- Keyword search (FTS5) accepted for now; semantic upgrade path = OpenMemory
  + Ollama (see specs in docs/superpowers/specs/).

## Gotchas
- `claude mcp add`: server name must come BEFORE `--env`, command after `--`.
- Engram v1.16.1 CLI is `engram save <title> <msg>` (GitHub docs say
  `engram add` — stale).
- Codex session logs wrap env context as user messages — skip texts starting
  with `<` when extracting first prompts.

## Next steps
1. User to fill "User preferences" section in agents/AGENTS.md.
2. Optional: launchd/alias to keep dashboard handy; tokscale for heatmaps.
3. Revisit semantic search if FTS5 recall proves insufficient.

_Last updated: 2026-06-10 by Claude Code (Opus 4.8)_
