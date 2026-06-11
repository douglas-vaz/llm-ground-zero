# llm-ground-zero — Shared LLM Workspace Design

**Date:** 2026-06-10
**Status:** Approved direction (Option B: file core + memory server)

## Goal

A reproducible, shippable local setup that gives multiple CLI coding agents
(Claude Code, Codex CLI, Gemini CLI, etc.) on subscription plans:

1. Shared memory/context when switching between models and tools
2. A searchable index of personal context (preferences, documents, artifacts)
3. Usage/cost/token tracking across all agents

## Constraints

- **Subscription-only billing.** No pay-per-token API keys. Rules out any
  component that needs an OpenAI/Anthropic API key (e.g., OpenMemory's default
  extraction pipeline) and rules out gateway-based metering (LiteLLM) — usage
  never passes through a proxy, so tracking must read local session logs.
- **Reproducible.** The entire setup is one git repo. `git clone` +
  `./setup.sh` reproduces it on another machine. No hand-edited dotfiles
  outside the repo.
- **Agent-agnostic.** Everything plugs in via two universal mechanisms:
  the `AGENTS.md` convention (read natively by major CLI agents) and MCP.

## Architecture

```
llm-ground-zero/
├── README.md              # setup + usage instructions for recipients
├── setup.sh               # idempotent: installs tools, registers MCP servers
├── agents/
│   └── AGENTS.md          # shared preferences/conventions for all agents
├── context/               # Tier-1 memory: plain markdown, git-versioned
│   └── <project>/         # per-project state, decisions, handoff notes
├── data/                  # Engram SQLite DB (gitignored; backup = cp)
└── docs/superpowers/specs/  # design docs
```

### Component 1 — Tier-1 memory: shared files (always loaded)

- `agents/AGENTS.md` holds personal preferences, coding conventions, and the
  handoff protocol. `setup.sh` links/registers it so Claude Code, Codex CLI,
  and Gemini CLI all load it natively (each agent reads `AGENTS.md` or an
  equivalent it can be pointed at).
- `context/<project>/` holds active project state. The handoff protocol in
  `AGENTS.md` instructs every agent: at the end of a significant session,
  write/update a handoff note (what was done, decisions, next steps). This is
  the mechanism that makes mid-task model switching work — the next agent
  reads the note instead of rediscovering state.
- Plain files are Tier 1 deliberately: agents always load them; there is no
  retrieval step that can miss.

### Component 2 — Tier-2 memory: Engram MCP server (searchable)

- [Engram (Gentleman-Programming/engram)](https://github.com/Gentleman-Programming/engram):
  single Go binary, SQLite + FTS5, MCP server + HTTP API + CLI + TUI.
  No API key, no Node/Python/Docker dependency.
- Registered as an MCP server in every agent's config by `setup.sh`.
- Stores cross-session, cross-tool facts: decisions, learnings, gotchas,
  user preferences discovered during work.
- Doubles as the personal document index: documents/artifacts are ingested
  via Engram's CLI/HTTP API and recalled via FTS5 keyword search.
- DB lives at `data/engram.db` (gitignored). Backup/migration = copy the file.

### Component 3 — Usage/cost tracking

- [ccusage](https://github.com/ryoppippi/ccusage): CLI reports (daily,
  per-model, 5-hour blocks) parsed from local session logs across Claude
  Code, Codex, and other supported agents.
- [tokscale](https://github.com/junhoyeo/tokscale) (optional): visual
  dashboard with heatmaps across 20+ agents.
- Optional Claude Code statusline integration powered by ccusage for live
  in-session visibility.
- Both are read-only over logs — no services to run.

### Component 4 — setup.sh

Idempotent script that:
1. Installs engram, ccusage, tokscale (brew/go install/npx as appropriate)
2. Registers Engram as an MCP server in each detected agent's config
3. Points each detected agent at `agents/AGENTS.md`
4. Creates `data/` and initializes the Engram DB
5. Prints a verification report (which agents were detected and configured)

## Decisions & trade-offs

- **Engram over OpenMemory/mem0:** OpenMemory's default pipeline requires an
  OpenAI API key for extraction/embeddings; going keyless means running
  Ollama. Engram needs nothing. FTS5 keyword search is accepted as the
  starting point.
- **Keyword search first, semantic later:** If FTS5 proves insufficient for
  document recall, the upgrade path is adding Ollama + an embedding-based
  memory server (OscillateLabsLLC engram variant or OpenMemory+Ollama) as a
  docker-compose service, without disturbing Tier 1 or usage tracking.
- **No LiteLLM/gateway:** useless under subscription billing; usage never
  transits a proxy.
- **Two memory tiers:** files for must-always-load context (reliability),
  search for long-tail recall (scale). Either alone fails: files don't scale,
  search alone misses.

## Error handling

- Agent not detected by `setup.sh`: script lists what it configured and what
  it skipped; manual registration instructions in README.
- Engram down/unregistered: agents degrade gracefully — Tier-1 files still
  work; nothing blocks.
- Log format drift breaking ccusage/tokscale: tools are independent of the
  memory system; worst case is a tracking gap, fixed by updating the tool.

## Testing / verification

- `setup.sh` ends with a self-check: Engram responds over MCP/HTTP, agent
  configs contain the registrations, ccusage produces a report.
- Manual acceptance: start a task in Claude Code, write a handoff note,
  resume in Codex CLI and confirm it picks up state; store a memory in one
  agent, recall it in another; run `ccusage` and see both agents' usage.

## Out of scope (for now)

- Semantic/vector search over documents (explicit upgrade path documented)
- Chat web apps and IDE assistants
- Syncing memory across machines (the repo + DB file copy covers it manually)
