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
HEADROOM_TARGETS=""
HEADROOM_MODE="cache"
HEADROOM_VERSION="0.31.0"
HEADROOM_PORT="8791"
HEADROOM_WORKSPACE="$HOME/Library/Application Support/LLM Ground Zero/headroom"

usage() {
  echo "Usage: ./setup.sh [--headroom claude,codex] [--headroom-mode cache|token]"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --headroom) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; HEADROOM_TARGETS="$2"; shift 2 ;;
      --headroom-mode) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; HEADROOM_MODE="$2"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
  done
  case "$HEADROOM_MODE" in cache|token) ;; *) echo "ERROR: headroom mode must be cache or token" >&2; exit 2 ;; esac
  local target
  IFS=',' read -r -a requested <<< "$HEADROOM_TARGETS"
  for target in "${requested[@]:-}"; do
    case "$target" in ""|claude|codex) ;; gemini) echo "ERROR: Gemini CLI is not yet supported by Headroom's installer." >&2; exit 2 ;; *) echo "ERROR: unsupported Headroom target: $target" >&2; exit 2 ;; esac
  done
}

have() { command -v "$1" >/dev/null 2>&1; }

append_once() { # append_once <file> <line>
  grep -qxF "$2" "$1" 2>/dev/null || printf '\n%s\n' "$2" >> "$1"
}

remove_ground_zero_pointers() { # remove_ground_zero_pointers <file>
  local file="$1" tmp
  tmp="$(mktemp "${file}.tmp.XXXXXX")"
  awk '!(/llm-ground-zero\/agents\/AGENTS\.md$/)' "$file" > "$tmp"
  mv "$tmp" "$file"
}

upsert_codex_engram() { # replace our complete TOML block, preserving all others
  local cfg="$1" tmp
  tmp="$(mktemp "${cfg}.tmp.XXXXXX")"
  awk '
    /^\[mcp_servers\.engram(\.env)?\]$/ { skipping=1; next }
    skipping && /^\[/ { skipping=0 }
    !skipping { print }
  ' "$cfg" > "$tmp"
  cat >> "$tmp" <<EOF

[mcp_servers.engram]
command = "engram"
args = ["mcp"]

[mcp_servers.engram.env]
ENGRAM_DATA_DIR = "$DATA_DIR"
EOF
  mv "$tmp" "$cfg"
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

configure_headroom() {
  [ -n "$HEADROOM_TARGETS" ] || return 0
  local installed_version=""
  if have headroom; then installed_version="$(headroom --version 2>/dev/null || true)"; fi
  if [[ "$installed_version" != *"$HEADROOM_VERSION"* ]]; then
    if ! have uv; then
      if have brew; then brew install uv
      else echo "ERROR: Headroom setup requires uv (https://docs.astral.sh/uv/)." >&2; exit 1
      fi
    fi
    uv tool install --force --python 3.13 "headroom-ai[proxy]==$HEADROOM_VERSION"
  fi
  local args=(install apply --profile llm-ground-zero --preset persistent-service --scope provider --providers manual)
  local target
  IFS=',' read -r -a requested <<< "$HEADROOM_TARGETS"
  for target in "${requested[@]}"; do args+=(--target "$target"); done
  args+=(--port "$HEADROOM_PORT" --mode "$HEADROOM_MODE" --no-telemetry)
  HEADROOM_WORKSPACE_DIR="$HEADROOM_WORKSPACE" HEADROOM_TELEMETRY=off headroom "${args[@]}"
  CONFIGURED+=("Headroom ($HEADROOM_TARGETS, $HEADROOM_MODE mode)")
}

configure_claude() {
  if ! have claude; then SKIPPED+=("Claude Code — claude CLI not found"); return; fi
  claude mcp remove --scope user engram >/dev/null 2>&1 || true
  claude mcp add --scope user engram --env ENGRAM_DATA_DIR="$DATA_DIR" -- engram mcp
  mkdir -p "$HOME/.claude"
  touch "$HOME/.claude/CLAUDE.md"
  remove_ground_zero_pointers "$HOME/.claude/CLAUDE.md"
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
  upsert_codex_engram "$cfg"
  touch "$HOME/.codex/AGENTS.md"
  remove_ground_zero_pointers "$HOME/.codex/AGENTS.md"
  append_once "$HOME/.codex/AGENTS.md" "$POINTER_LINE"
  CONFIGURED+=("Codex CLI")
}

configure_gemini() {
  if ! have gemini && [ ! -d "$HOME/.gemini" ]; then
    SKIPPED+=("Gemini CLI — not found"); return
  fi
  mkdir -p "$HOME/.gemini"
  if have python3; then
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
  elif have node; then
    node - "$HOME/.gemini/settings.json" "$DATA_DIR" <<'JS'
const fs = require("node:fs");
const [path, dataDir] = process.argv.slice(2);
const cfg = fs.existsSync(path) && fs.statSync(path).size
  ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
cfg.mcpServers ||= {};
cfg.mcpServers.engram = {
  command: "engram",
  args: ["mcp"],
  env: { ENGRAM_DATA_DIR: dataDir },
};
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
JS
  else
    SKIPPED+=("Gemini CLI — python3 or node is required to update settings.json")
    return
  fi
  touch "$HOME/.gemini/GEMINI.md"
  remove_ground_zero_pointers "$HOME/.gemini/GEMINI.md"
  append_once "$HOME/.gemini/GEMINI.md" "$POINTER_LINE"
  CONFIGURED+=("Gemini CLI")
}

main() {
  parse_args "$@"
  mkdir -p "$DATA_DIR"
  install_engram
  install_usage_tools
  configure_claude
  configure_codex
  configure_gemini
  configure_headroom

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
