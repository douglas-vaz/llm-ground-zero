# Handoff — llm-ground-zero

## Current state
- **Published**: public repo at https://github.com/douglas-vaz/llm-ground-zero
  (MIT, copyright "Douglas Vas" — legal name, the missing z is intentional).
- **macOS app shipped**: Electron app in `app/` (Node port of the old Python
  dashboard; UI html unchanged). v0.1.0 released — tag push builds an
  unsigned universal dmg via `.github/workflows/release.yml` and attaches
  it + SHA256SUMS to the GitHub release.
- **Homebrew tap live**: https://github.com/douglas-vaz/homebrew-tap
  (`Casks/llm-ground-zero.rb`). Verified end-to-end:
  `brew install --cask douglas-vaz/tap/llm-ground-zero`, then
  `xattr -dr com.apple.quarantine` (unsigned → Gatekeeper blocks).
- Python `dashboard/` deleted; headless mode is `cd app && npm run serve`.
  Tests: `cd app && npm test` (12 node:test tests).
- v0.1.1 added the app icon; v0.1.2 added the current-5h-block card
  (`/api/blocks` via `ccusage blocks --json`), a manual refresh button
  (`?fresh=1` busts the 60s cache), and fixed a Chart.js canvas-reuse bug
  on re-render (mkChart destroys before recreating). App stays read-only —
  memory deletion was considered and explicitly rejected.
- Core agent wiring unchanged: `setup.sh`, `agents/AGENTS.md`, Engram MCP.

## Recent decisions
- Electron over menu-bar/Tauri; server ported to Node so the .app is
  self-contained (ccusage is an npm dep, no Python).
- Engram db read via macOS-bundled `/usr/bin/sqlite3 -json` — zero native
  Node modules, keeps electron-builder trivial.
- Unsigned builds (no Apple Developer account yet); revisit signing +
  notarization + auto-update if the project gains traction.
- Anonymous error log at `~/Library/Logs/llm-ground-zero/error.log`
  (sanitize() collapses $HOME → `~`; only error name/message/stack logged).

## Gotchas
- ccusage's cli.js delegates at runtime to per-arch native binaries
  (`@ccusage/ccusage-darwin-{arm64,x64}`); npm only installs the host arch.
  `predist` force-installs both + `asarUnpack` for `@ccusage/**` +
  `x64ArchFiles: "**/ccusage"` make the universal dmg honest.
- Spawning a bundled JS CLI from a packaged app: use `process.execPath` with
  `ELECTRON_RUN_AS_NODE=1` and swap `app.asar` → `app.asar.unpacked`.
- Homebrew 6: tap trust is required for third-party taps. Prefer the
  fully-qualified cask install (`douglas-vaz/tap/llm-ground-zero`) so Homebrew
  trusts only that cask instead of the whole tap.
- GitHub handle is `douglas-vaz` (hyphen), not douglasvaz.
- `node --test test/` fails on Node 22 — use bare `node --test`.
- Older gotchas (claude mcp add arg order, engram save syntax, Codex env
  noise rows) still apply; see git history of this file.

## Next steps
1. Optional: code signing + notarization ($99/yr) → removes xattr step.
2. Graduate cask to homebrew/cask when notability criteria are met.
3. User preferences section in agents/AGENTS.md still empty.
4. Semantic search upgrade path unchanged (OpenMemory + Ollama specs).

_Last updated: 2026-06-16_
