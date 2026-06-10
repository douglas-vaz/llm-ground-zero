# llm-ground-zero

A reproducible local setup that makes multiple CLI coding agents (Claude
Code, Codex CLI, Gemini CLI, ...) behave like one continuous assistant:
shared memory when you switch models mid-task, a searchable index of
personal context, and usage tracking across all of them.

Works with subscription plans — no pay-per-token API keys required anywhere.

## What you get

| Capability | How | Tool |
|---|---|---|
| Shared preferences & conventions | `agents/AGENTS.md`, loaded by every agent | plain markdown |
| Project handoff between models | `context/<project>/handoff.md`, written at session end, read at session start | plain markdown + protocol in AGENTS.md |
| Searchable cross-agent memory | MCP server all agents connect to; full-text search over decisions, gotchas, preferences | [Engram](https://github.com/Gentleman-Programming/engram) (Go binary, SQLite+FTS5, zero deps) |
| Personal document index | ingest via `engram save` / HTTP API, recall via `mem_search` from any agent | Engram |
| Usage / token / cost tracking | parses each agent's local session logs | [ccusage](https://github.com/ryoppippi/ccusage), [tokscale](https://github.com/junhoyeo/tokscale) |

### How the two memory tiers work

- **Tier 1 — files, always loaded.** Preferences and active project state
  live in markdown that agents read natively. No retrieval step, no misses.
- **Tier 2 — Engram, searchable.** Long-tail memory (decisions, learnings,
  documents) lives in one SQLite file at `data/engram.db`, exposed to every
  agent over MCP. Backup = copy the file.

The handoff flow when switching models mid-task: agent A writes
`context/<project>/handoff.md` at session end → you open agent B → it reads
the handoff and `mem_search`es for related memories → continues where A left off.

## Quick start

```bash
git clone <this-repo> ~/llm-ground-zero
cd ~/llm-ground-zero
./setup.sh
```

`setup.sh` is idempotent and ends with a report of what it configured and
what it skipped. It:

1. Installs Engram (brew or `go install`), ccusage, tokscale (npm)
2. Registers Engram as an MCP server with every detected agent
3. Wires `agents/AGENTS.md` into each agent's global instructions
4. Creates `data/` for the Engram database

Restart your agents afterwards so they pick up the MCP server.

## Per-agent setup details

`setup.sh` does all of this automatically; the manual equivalents are
documented here for troubleshooting or unsupported agents.

### Claude Code

```bash
claude mcp add --scope user engram --env ENGRAM_DATA_DIR="$HOME/llm-ground-zero/data" -- engram mcp
```

Shared instructions: `~/.claude/CLAUDE.md` gets the import line
`@/Users/<you>/llm-ground-zero/agents/AGENTS.md`.

Verify: run `claude mcp list` — engram should be listed and connected.

### Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.engram]
command = "engram"
args = ["mcp"]

[mcp_servers.engram.env]
ENGRAM_DATA_DIR = "/Users/<you>/llm-ground-zero/data"
```

Shared instructions: `~/.codex/AGENTS.md` gets a pointer line referencing
`agents/AGENTS.md` in this repo.

### Gemini CLI

`~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram",
      "args": ["mcp"],
      "env": { "ENGRAM_DATA_DIR": "/Users/<you>/llm-ground-zero/data" }
    }
  }
}
```

Shared instructions: `~/.gemini/GEMINI.md` gets a pointer line referencing
`agents/AGENTS.md` in this repo.

### Any other MCP-capable agent

Register an MCP server with command `engram`, args `["mcp"]`, and env
`ENGRAM_DATA_DIR=<repo>/data`. Point its instructions file at
`agents/AGENTS.md`.

## Day-to-day usage

**Check usage/costs** (reads local logs from all supported agents):

```bash
ccusage          # daily report
ccusage blocks   # 5-hour billing-window view
tokscale         # visual dashboard
```

**Add a document to the personal index:**

```bash
engram save "Title of doc" "$(cat somefile.md)" --type reference
engram search "query"          # or from any agent via the mem_search tool
```

**Inspect memory:** `engram` (TUI) or `engram serve` (HTTP API on :7437).

## Shipping this to someone else

The repo is the whole setup. They clone it, run `./setup.sh`, done. The only
machine state outside the repo is each agent's config (written idempotently
by the script) and the globally installed binaries. `data/` (the memory DB)
is gitignored — private by default; copy it manually if you want to transfer
memories.

## Upgrade path: semantic search

Tier-2 search is keyword (FTS5). If recall over documents needs to be
semantic, swap in an embeddings-based server (OpenMemory + Ollama, fully
local) without touching Tier 1 or usage tracking. See the design doc:
`docs/superpowers/specs/2026-06-10-llm-ground-zero-design.md`.
