# macOS Packaging — Design

Date: 2026-06-11
Status: approved by user (pending spec review)

## Goal

Turn the llm-ground-zero dashboard into a launchable macOS app, publish the
repo on GitHub under MIT, and distribute the app through a personal Homebrew
tap. Preserve the existing dashboard UI exactly; the agent/Engram setup
(`setup.sh`) stays CLI-only.

## Decisions (made with user)

- **App shell**: Electron, with the Python server ported to Node so the .app
  is fully self-contained (no Python dependency).
- **License**: MIT, copyright holder "Douglas Vas" (user's legal name).
  MIT's notice-preservation clause covers the attribution requirement.
- **App scope**: dashboard only. `setup.sh` remains the path for wiring
  agents, Engram, and AGENTS.md.
- **Repo**: public GitHub repo named `llm-ground-zero`.
- **Signing**: unsigned to start. Document `--no-quarantine` install. No
  auto-update (requires signing). Revisit if the project gains traction.

## Architecture

### App (`app/` directory)

- `app/main.js` — Electron main process. Starts an HTTP server bound to
  `127.0.0.1:7788` (port overridable via env), then opens a BrowserWindow
  at that URL. The dashboard therefore also remains usable from a normal
  browser while the app runs.
- `app/server.js` — the HTTP server, runnable standalone (`npm run serve`)
  without Electron for headless/browser-only use. Replaces
  `dashboard/serve.sh` and `dashboard/server.py`. Same endpoints
  (`/api/usage`, `/api/tools`, `/api/conversations`, `/api/memories`,
  static `/`), same 60-second in-memory cache, same
  per-endpoint degradation (one failing data source returns
  `{"error": ...}` for that panel only).
- `app/lib.js` — port of `dashboard/lib.py` parsers: Claude project logs
  (`~/.claude/projects`), Codex sessions (`~/.codex/sessions`), Claude Code
  tool usage, Engram memory feed. Known gotcha to carry over: Codex logs
  wrap env context as user messages — skip texts starting with `<` when
  extracting first prompts.
- `app/static/index.html` — moved from `dashboard/static/index.html`,
  byte-for-byte except path references if any. The UI is not redesigned.

### Dependency strategy (keep the build trivial)

- **ccusage**: npm dependency of the app (it is a JS package). No more
  shelling out to a globally installed `ccusage`; invoke its CLI entry point
  bundled in `node_modules` (`ccusage --json` equivalent) via `execFile` of
  the package bin, or its programmatic API if stable.
- **Engram SQLite**: shell out to macOS's bundled `/usr/bin/sqlite3` with
  `-json` (read-only query). Avoids native Node modules (better-sqlite3),
  which keeps electron-builder configuration minimal.

### Tests

- `dashboard/test_lib.py` ports to `app/test/lib.test.js` using the
  built-in `node:test` runner (zero extra deps). Same fixtures/assertions.
- The Python implementation (`dashboard/`) is deleted only after the ported
  tests pass against the Node parsers.

## Build & release

- **electron-builder** config in `app/package.json` (the app is its own npm
  package; the repo root stays script/markdown only): universal
  macOS build (arm64 + x64), `.dmg` artifact, app name "LLM Ground Zero",
  appId e.g. `com.douglasvas.llm-ground-zero`. Unsigned
  (`identity: null`).
- **GitHub Actions**:
  - `ci.yml` — run `node --test` on every push/PR.
  - `release.yml` — on tag `v*`: build dmg on `macos-latest`, compute
    sha256, create a GitHub Release with both attached.

## Homebrew distribution

- Separate repo `douglasvaz/homebrew-tap` with
  `Casks/llm-ground-zero.rb`:
  - `version`/`sha256` pinned to the GitHub release dmg URL.
  - `app "LLM Ground Zero.app"`.
  - `caveats` explaining the unsigned-app `--no-quarantine` install and
    pointing at the repo's `setup.sh` for agent/memory wiring.
- Install command documented as:
  `brew install --cask --no-quarantine douglasvaz/tap/llm-ground-zero`
- Main `homebrew/cask` requires notability; the personal tap is the start,
  and the cask can graduate later unchanged.

## Repo prep

- `LICENSE` — MIT, `Copyright (c) 2026 Douglas Vas`.
- `README.md` rewrite — personal, marketing-first:
  1. One-paragraph personal hook ("I built this because…" — switching
     agents mid-task, each had amnesia; subscription-only, no API keys).
  2. Dashboard screenshot (`docs/assets/dashboard.png`, supplied by user or
     captured from the built app).
  3. What you get (memory tiers, handoff protocol, usage tracking, app).
  4. Install: brew cask for the app + `git clone && ./setup.sh` for the
     agent wiring.
  5. How it works, then existing per-agent reference detail (kept, moved
     lower or into `docs/`).
- Housekeeping: add `.idea/` to `.gitignore`; confirm `data/*.db*` is
  untracked; create the GitHub repo with `gh repo create` including
  description and topics (claude-code, codex, mcp, memory, dashboard,
  electron, homebrew).

## Out of scope (deliberate)

Code signing/notarization, auto-update, menu-bar/tray mode,
CONTRIBUTING.md, submission to homebrew/cask, semantic memory search.

## Error handling

Unchanged philosophy from the Python server: each API endpoint catches its
own data-source errors and returns `{"error": ...}` so one broken source
never blanks the page. The Electron app shows the window even if all
sources fail.
