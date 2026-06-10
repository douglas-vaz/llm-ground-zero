# context/

Tier-1 memory: per-project handoff notes, always read by agents at session start.

One directory per project, each containing at least `handoff.md`:

```markdown
# Handoff — <project>

## Current state
What works, what's in flight.

## Recent decisions
Decision — reason. One line each.

## Next steps
Ordered list.

_Last updated: YYYY-MM-DD by <agent/model>_
```

Agents update the relevant `handoff.md` at the end of significant sessions
(see `agents/AGENTS.md` for the protocol).
