# omp-unlazy-guard

**omp / Oh My Pi extension** that brings [Unlazy](https://github.com/Leonxlnx/unlazy) completion discipline into live omp panes.

## Credit

Built **on top of** [Leonxlnx/unlazy](https://github.com/Leonxlnx/unlazy) (MIT).

Unlazy owns the skill, `GATES.md` ledger, and `gate-check.mjs` CHECK/EXPECT/re-verify flow.
This repo only adds an **omp/pi lifecycle extension** so those gates enforce in herdr/omp panes, where Claude Code’s Stop hook does **not** run.

Please star and follow upstream: https://github.com/Leonxlnx/unlazy

## Why this exists

| Surface | Unlazy skill | Stop / end-of-turn enforcement |
|---|---|---|
| Claude Code | yes (`~/.claude/skills`) | Claude Stop hook |
| omp (Oh My Pi) live panes | yes (via Claude/agents skill dirs) | **No** Claude Stop — needs this extension |

## Install

1. Install Unlazy first so `scripts/gate-check.mjs` exists under one of:
   - `~/.config/skillshare/skills/unlazy`
   - `~/.claude/skills/unlazy`
   - `~/.agents/skills/unlazy`
   - or set `UNLAZY_SKILL_ROOT`
2. Install the extension:

```bash
mkdir -p ~/.omp/agent/extensions
curl -fsSL -o ~/.omp/agent/extensions/unlazy-guard.ts \
  https://raw.githubusercontent.com/joshuaswarren/omp-unlazy-guard/main/unlazy-guard.ts
```

3. **Restart** long-lived omp panes (or start a fresh session) so omp reloads extensions.

## Slash commands

- `/unlazy-status` — gate status for the current repo
- `/unlazy-reverify` — re-run verification
- `/unlazy-approve` — approval helpers (approvals stay under `~/.unlazy/approved`)
- `/unlazy-scopes` — Depth Tree scopes when `.unlazy/` is present

Also registers tool `unlazy_status` for agent-callable checks.

## Behavior

- `before_agent_start`: inject reminder when unmet GATES exist
- `agent_end`: `sendMessage` re-prompt while unmet (max 6, then release)
- Shells out to upstream `gate-check.mjs` (does not reimplement CHECK logic)

## Hosts

Intended for omp coding hosts (Linux/macOS) running herdr/omp panes. Not a substitute for the Unlazy skill itself.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Joshua Warren (companion extension only). Upstream Unlazy © Leonxlnx.
