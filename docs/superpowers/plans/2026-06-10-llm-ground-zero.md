# llm-ground-zero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible repo that gives all CLI coding agents shared file-based + Engram MCP memory and local-log usage tracking, installable via one `setup.sh`.

**Architecture:** Plain markdown (`agents/AGENTS.md` + `context/`) is Tier-1 always-loaded memory; Engram (Go binary, SQLite+FTS5, no API key) is Tier-2 searchable memory exposed over MCP to every agent; ccusage/tokscale read local session logs for usage. `setup.sh` installs tools and idempotently writes each agent's config. A sandboxed bash test harness verifies `setup.sh` against a fake `$HOME` with stubbed CLIs.

**Tech Stack:** bash, python3 (stdlib, for JSON config edits), Engram, ccusage, tokscale. No services, no Docker.

**Spec:** `docs/superpowers/specs/2026-06-10-llm-ground-zero-design.md`

---

### Task 1: Repo scaffolding and test harness

**Files:**
- Create: `.gitignore`
- Create: `context/README.md`
- Create: `test/setup_test.sh`
- Create: `test/stubs/claude`, `test/stubs/codex`, `test/stubs/gemini`, `test/stubs/engram`, `test/stubs/npm`

- [ ] **Step 1: Create `.gitignore`**

```gitignore
data/
.DS_Store
```

- [ ] **Step 2: Create `context/README.md`**

```markdown
# context/

Tier-1 memory: per-project handoff notes, always read by agents at session start.

One directory per project, each containing at least `handoff.md`:

\```markdown
# Handoff — <project>

## Current state
What works, what's in flight.

## Recent decisions
Decision — reason. One line each.

## Next steps
Ordered list.

_Last updated: YYYY-MM-DD_
\```

Agents update the relevant `handoff.md` at the end of significant sessions
(see `agents/AGENTS.md` for the protocol).
```

(Remove the backslashes before the inner triple-backticks — they only escape this plan's formatting.)

- [ ] **Step 3: Write the failing test harness `test/setup_test.sh`**

The harness runs `setup.sh` against a throwaway `$HOME` with stub CLIs on `$PATH`, then asserts each agent config was written. Stubs satisfy `command -v` checks without touching the network or the real machine.

```bash
#!/usr/bin/env bash
# Sandbox test for setup.sh: fake HOME, stubbed CLIs, assert configs written.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

export HOME="$SANDBOX/home"
mkdir -p "$HOME"
export PATH="$REPO_DIR/test/stubs:$PATH"

FAILURES=0
assert() { # assert <description> <command...>
  local desc="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS: $desc"
  else
    echo "FAIL: $desc"
    FAILURES=$((FAILURES + 1))
  fi
}

bash "$REPO_DIR/setup.sh" || { echo "FAIL: setup.sh exited non-zero"; exit 1; }

# Claude Code: stub records invocations; global CLAUDE.md imports shared AGENTS.md
assert "claude stub saw 'mcp add' for engram" \
  grep -q "mcp add" "$SANDBOX/home/claude-invocations.log"
assert "global CLAUDE.md imports shared AGENTS.md" \
  grep -qF "@$REPO_DIR/agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"

# Codex: config.toml gets engram MCP server + AGENTS.md pointer
assert "codex config.toml registers engram" \
  grep -q '^\[mcp_servers\.engram\]' "$HOME/.codex/config.toml"
assert "codex config.toml sets ENGRAM_DATA_DIR" \
  grep -qF "$REPO_DIR/data" "$HOME/.codex/config.toml"
assert "codex AGENTS.md points at shared AGENTS.md" \
  grep -qF "$REPO_DIR/agents/AGENTS.md" "$HOME/.codex/AGENTS.md"

# Gemini: settings.json valid JSON containing engram; GEMINI.md pointer
assert "gemini settings.json registers engram" \
  python3 -c "
import json,sys
cfg=json.load(open('$HOME/.gemini/settings.json'))
assert cfg['mcpServers']['engram']['command']=='engram'
assert cfg['mcpServers']['engram']['env']['ENGRAM_DATA_DIR']=='$REPO_DIR/data'
"
assert "GEMINI.md points at shared AGENTS.md" \
  grep -qF "$REPO_DIR/agents/AGENTS.md" "$HOME/.gemini/GEMINI.md"

# Idempotency: second run must not duplicate entries
bash "$REPO_DIR/setup.sh" >/dev/null 2>&1
assert "CLAUDE.md import not duplicated" \
  test "$(grep -cF "@$REPO_DIR/agents/AGENTS.md" "$HOME/.claude/CLAUDE.md")" = "1"
assert "codex engram block not duplicated" \
  test "$(grep -c '^\[mcp_servers\.engram\]' "$HOME/.codex/config.toml")" = "1"

# Data dir created
assert "data/ directory exists" test -d "$REPO_DIR/data"

echo
if [ "$FAILURES" -gt 0 ]; then echo "$FAILURES failure(s)"; exit 1; fi
echo "All tests passed."
```

- [ ] **Step 4: Create the stubs**

`test/stubs/claude` (records args so the test can assert the `mcp add` call):

```bash
#!/usr/bin/env bash
echo "$@" >> "$HOME/../claude-invocations.log"
exit 0
```

`test/stubs/codex`, `test/stubs/gemini`, `test/stubs/engram`, `test/stubs/npm` (identical — exist only to satisfy `command -v` and absorb install calls):

```bash
#!/usr/bin/env bash
exit 0
```

Then: `chmod +x test/setup_test.sh test/stubs/*`

- [ ] **Step 5: Run the test to verify it fails**

Run: `bash test/setup_test.sh`
Expected: FAIL — `setup.sh` does not exist yet (`bash: .../setup.sh: No such file or directory`).

- [ ] **Step 6: Commit**

```bash
git add .gitignore context/README.md test/
git commit -m "test: add sandboxed setup.sh test harness and repo scaffolding"
```

---

### Task 2: Shared agent instructions (`agents/AGENTS.md`)

**Files:**
- Create: `agents/AGENTS.md`

- [ ] **Step 1: Write `agents/AGENTS.md`**

```markdown
# Shared Agent Instructions

These instructions are shared across all CLI coding agents on this machine
(Claude Code, Codex CLI, Gemini CLI, ...). They exist so any agent can pick
up where another left off.

## Memory system — two tiers

**Tier 1 — files (always read):** `~/llm-ground-zero/context/<project>/handoff.md`
holds per-project state. If the project you are working on has a directory
there, read its `handoff.md` before starting work.

**Tier 2 — Engram (searchable):** an MCP server named `engram` is registered
with you. Key tools: `mem_search` (full-text search), `mem_save` (store an
observation), `mem_context` (recent session context).

## Protocol

**At session start:**
1. If `~/llm-ground-zero/context/<project>/handoff.md` exists for the current
   project, read it.
2. Call `mem_search` on the task topic to recall relevant past decisions.

**During work — save to Engram (`mem_save`) when you encounter:**
- A decision with a non-obvious reason
- A gotcha or pitfall that cost time
- A durable user preference expressed in conversation

Do not save routine actions or anything derivable from the code itself.

**At the end of a significant session** (made meaningful changes or decisions):
1. Create/update `~/llm-ground-zero/context/<project>/handoff.md` using the
   template in `~/llm-ground-zero/context/README.md` — current state, recent
   decisions, next steps, and a `_Last updated_` line naming you (agent + model).
2. Keep it under ~100 lines; it is a handoff, not a log. Prune stale entries.

## User preferences

<!-- Durable personal preferences live here. Agents: if the user expresses a
     lasting preference, offer to record it in this section. -->

- (none recorded yet)
```

- [ ] **Step 2: Commit**

```bash
git add agents/AGENTS.md
git commit -m "feat: add shared cross-agent instructions and handoff protocol"
```

---

### Task 3: `setup.sh`

**Files:**
- Create: `setup.sh`
- Test: `test/setup_test.sh` (from Task 1)

- [ ] **Step 1: Write `setup.sh`**

```bash
#!/usr/bin/env bash
# Idempotent setup for llm-ground-zero: installs tools, registers the Engram
# MCP server with every detected CLI agent, and wires in shared AGENTS.md.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$REPO_DIR/data"
AGENTS_MD="$REPO_DIR/agents/AGENTS.md"
POINTER_LINE="Read and follow the shared instructions in $AGENTS_MD"

CONFIGURED=()
SKIPPED=()

have() { command -v "$1" >/dev/null 2>&1; }

append_once() { # append_once <file> <line>
  grep -qxF "$2" "$1" 2>/dev/null || printf '\n%s\n' "$2" >> "$1"
}

install_engram() {
  if have engram; then return; fi
  if have brew; then
    brew install gentleman-programming/tap/engram
  elif have go; then
    go install github.com/Gentleman-Programming/engram/cmd/engram@latest
  else
    echo "ERROR: engram not installed and neither brew nor go is available." >&2
    echo "Install manually: https://github.com/Gentleman-Programming/engram/releases" >&2
    exit 1
  fi
}

install_usage_tools() {
  if have npm; then
    have ccusage || npm install -g ccusage
    have tokscale || npm install -g tokscale
    CONFIGURED+=("usage tracking (ccusage, tokscale)")
  else
    SKIPPED+=("ccusage/tokscale — npm not found")
  fi
}

configure_claude() {
  if ! have claude; then SKIPPED+=("Claude Code — claude CLI not found"); return; fi
  claude mcp remove --scope user engram >/dev/null 2>&1 || true
  claude mcp add --scope user --env ENGRAM_DATA_DIR="$DATA_DIR" engram -- engram mcp
  mkdir -p "$HOME/.claude"
  touch "$HOME/.claude/CLAUDE.md"
  append_once "$HOME/.claude/CLAUDE.md" "@$AGENTS_MD"
  CONFIGURED+=("Claude Code")
}

configure_codex() {
  if ! have codex && [ ! -d "$HOME/.codex" ]; then
    SKIPPED+=("Codex CLI — not found"); return
  fi
  mkdir -p "$HOME/.codex"
  local cfg="$HOME/.codex/config.toml"
  touch "$cfg"
  if ! grep -q '^\[mcp_servers\.engram\]' "$cfg"; then
    cat >> "$cfg" <<EOF

[mcp_servers.engram]
command = "engram"
args = ["mcp"]

[mcp_servers.engram.env]
ENGRAM_DATA_DIR = "$DATA_DIR"
EOF
  fi
  touch "$HOME/.codex/AGENTS.md"
  append_once "$HOME/.codex/AGENTS.md" "$POINTER_LINE"
  CONFIGURED+=("Codex CLI")
}

configure_gemini() {
  if ! have gemini && [ ! -d "$HOME/.gemini" ]; then
    SKIPPED+=("Gemini CLI — not found"); return
  fi
  mkdir -p "$HOME/.gemini"
  python3 - "$HOME/.gemini/settings.json" "$DATA_DIR" <<'PY'
import json, os, sys
path, data_dir = sys.argv[1], sys.argv[2]
cfg = {}
if os.path.exists(path) and os.path.getsize(path) > 0:
    with open(path) as f:
        cfg = json.load(f)
cfg.setdefault("mcpServers", {})["engram"] = {
    "command": "engram",
    "args": ["mcp"],
    "env": {"ENGRAM_DATA_DIR": data_dir},
}
with open(path, "w") as f:
    json.dump(cfg, f, indent=2)
    f.write("\n")
PY
  touch "$HOME/.gemini/GEMINI.md"
  append_once "$HOME/.gemini/GEMINI.md" "$POINTER_LINE"
  CONFIGURED+=("Gemini CLI")
}

main() {
  mkdir -p "$DATA_DIR"
  install_engram
  install_usage_tools
  configure_claude
  configure_codex
  configure_gemini

  echo
  echo "=== llm-ground-zero setup report ==="
  for item in "${CONFIGURED[@]:-}"; do [ -n "$item" ] && echo "  configured: $item"; done
  for item in "${SKIPPED[@]:-}";    do [ -n "$item" ] && echo "  skipped:    $item"; done
  echo
  echo "Engram data dir: $DATA_DIR"
  echo "Shared instructions: $AGENTS_MD"
  echo "Restart your agents to pick up the new MCP server."
}

main "$@"
```

Then: `chmod +x setup.sh`

- [ ] **Step 2: Run the test to verify it passes**

Run: `bash test/setup_test.sh`
Expected: all PASS lines, exit 0. Debug `setup.sh` until green — do not weaken assertions.

- [ ] **Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat: add idempotent setup.sh for tools, MCP registration, AGENTS.md wiring"
```

---

### Task 4: README

**Files:**
- Create: `README.md`

User requirement: README must (1) explain the tools and capabilities and (2) contain per-agent setup instructions (Claude Code, Codex, Gemini, plus manual fallback for others).

- [ ] **Step 1: Write `README.md`**

```markdown
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
| Personal document index | ingest via `engram add` / HTTP API, recall via `mem_search` from any agent | Engram |
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

\```bash
git clone <this-repo> ~/llm-ground-zero
cd ~/llm-ground-zero
./setup.sh
\```

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

\```bash
claude mcp add --scope user --env ENGRAM_DATA_DIR="$HOME/llm-ground-zero/data" engram -- engram mcp
\```

Shared instructions: `~/.claude/CLAUDE.md` gets the import line
`@/Users/<you>/llm-ground-zero/agents/AGENTS.md`.

Verify: run `claude mcp list` — engram should be listed and connected.

### Codex CLI

`~/.codex/config.toml`:

\```toml
[mcp_servers.engram]
command = "engram"
args = ["mcp"]

[mcp_servers.engram.env]
ENGRAM_DATA_DIR = "/Users/<you>/llm-ground-zero/data"
\```

Shared instructions: `~/.codex/AGENTS.md` gets a pointer line referencing
`agents/AGENTS.md` in this repo.

### Gemini CLI

`~/.gemini/settings.json`:

\```json
{
  "mcpServers": {
    "engram": {
      "command": "engram",
      "args": ["mcp"],
      "env": { "ENGRAM_DATA_DIR": "/Users/<you>/llm-ground-zero/data" }
    }
  }
}
\```

Shared instructions: `~/.gemini/GEMINI.md` gets a pointer line referencing
`agents/AGENTS.md` in this repo.

### Any other MCP-capable agent

Register an MCP server with command `engram`, args `["mcp"]`, and env
`ENGRAM_DATA_DIR=<repo>/data`. Point its instructions file at
`agents/AGENTS.md`.

## Day-to-day usage

**Check usage/costs** (reads local logs from all supported agents):

\```bash
ccusage          # daily report
ccusage blocks   # 5-hour billing-window view
tokscale         # visual dashboard
\```

**Add a document to the personal index:**

\```bash
engram add --type reference --title "..." --content "$(cat somefile.md)"
engram search "query"          # or from any agent via the mem_search tool
\```

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
\```

(Remove the backslashes before inner triple-backticks — plan-formatting escapes only.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with capabilities and per-agent setup instructions"
```

---

### Task 5: Real-machine verification

**Files:** none (verification only)

- [ ] **Step 1: Run setup for real**

Run: `./setup.sh`
Expected: report lists Claude Code as configured; Codex/Gemini configured or skipped depending on what's installed; no errors.

- [ ] **Step 2: Smoke-test Engram**

```bash
ENGRAM_DATA_DIR="$PWD/data" engram add --type note --title "setup test" --content "llm-ground-zero installed $(date +%F)"
ENGRAM_DATA_DIR="$PWD/data" engram search "setup test"
```

Expected: the search returns the note just added. (If `engram add` flags differ in the installed version, check `engram --help` and use the actual syntax — then fix README to match.)

- [ ] **Step 3: Verify MCP registration**

Run: `claude mcp list`
Expected: `engram` listed. (Connection check requires an agent restart; note this in the final report rather than blocking on it.)

- [ ] **Step 4: Verify usage tracking**

Run: `ccusage --since $(date -v-7d +%Y%m%d) 2>/dev/null || ccusage`
Expected: a table of recent Claude Code token usage. If Codex logs exist, they appear too.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: verified setup on local machine"
```

(Only if verification changed any files — e.g., README syntax fixes from Step 2.)
```
