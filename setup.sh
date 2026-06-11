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
  claude mcp add --scope user engram --env ENGRAM_DATA_DIR="$DATA_DIR" -- engram mcp
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
