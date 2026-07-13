#!/usr/bin/env bash
# Sandbox test for setup.sh: fake HOME, stubbed CLIs, assert configs written.
set -uo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT

export HOME="$SANDBOX/home"
mkdir -p "$HOME"
export PATH="$REPO_DIR/test/stubs:$PATH"

# Pre-existing config represents a clone that moved. Setup must converge to
# the current data path without disturbing unrelated Codex configuration.
mkdir -p "$HOME/.codex"
cat > "$HOME/.codex/config.toml" <<'EOF'
model = "gpt-test"

[mcp_servers.engram]
command = "old-engram"
args = ["mcp"]

[mcp_servers.engram.env]
ENGRAM_DATA_DIR = "/old/clone/data"

[features]
example = true
EOF

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
  grep -q "mcp add" "$HOME/claude-invocations.log"
assert "global CLAUDE.md imports shared AGENTS.md" \
  grep -qF "@$REPO_DIR/agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"

# Codex: config.toml gets engram MCP server + AGENTS.md pointer
assert "codex config.toml registers engram" \
  grep -q '^\[mcp_servers\.engram\]' "$HOME/.codex/config.toml"
assert "codex config.toml sets ENGRAM_DATA_DIR" \
  grep -qF "$REPO_DIR/data" "$HOME/.codex/config.toml"
assert "codex config.toml removes stale ENGRAM_DATA_DIR" \
  sh -c "! grep -qF '/old/clone/data' '$HOME/.codex/config.toml'"
assert "codex config.toml preserves unrelated settings" \
  grep -q '^example = true' "$HOME/.codex/config.toml"
assert "codex AGENTS.md points at shared AGENTS.md" \
  grep -qF "$REPO_DIR/agents/AGENTS.md" "$HOME/.codex/AGENTS.md"

# Gemini: settings.json valid JSON containing engram; GEMINI.md pointer
assert "gemini settings.json registers engram" \
  python3 -c "
import json
cfg = json.load(open('$HOME/.gemini/settings.json'))
assert cfg['mcpServers']['engram']['command'] == 'engram'
assert cfg['mcpServers']['engram']['env']['ENGRAM_DATA_DIR'] == '$REPO_DIR/data'
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
