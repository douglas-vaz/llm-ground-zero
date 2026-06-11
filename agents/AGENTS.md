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
