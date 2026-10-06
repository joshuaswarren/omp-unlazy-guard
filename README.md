# omp-unlazy-guard

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink)](https://github.com/sponsors/joshuaswarren)

**Unofficial third-party** [omp / Oh My Pi](https://github.com/can1357/oh-my-pi) extension that brings [Unlazy](https://github.com/Leonxlnx/unlazy) completion discipline into live omp panes.

This repository is **not** part of Unlazy, **not** affiliated with or endorsed by Leonxlnx, and **not** an official Unlazy companion. It only adds omp lifecycle hooks and slash commands. CHECK/EXPECT execution stays in upstream `gate-check.mjs`.

## Credit

Built **on top of** [Leonxlnx/unlazy](https://github.com/Leonxlnx/unlazy) (MIT).

Unlazy owns the skill, `GATES.md` ledger, and `gate-check.mjs` CHECK/EXPECT/re-verify flow.
This repo only adds an **omp/pi lifecycle extension** so those gates can enforce in herdr/omp panes, where Claude Code’s Stop hook does **not** run.

Please star and follow upstream: https://github.com/Leonxlnx/unlazy

## Why this exists

| Surface | Unlazy skill | Stop / end-of-turn enforcement |
|---|---|---|
| Claude Code | yes (`~/.claude/skills`) | Claude Stop hook |
| omp (Oh My Pi) live panes | yes (via Claude/agents skill dirs) | **No** Claude Stop — this unofficial extension |

## Supported platforms

| Platform | This companion | Notes |
|---|---|---|
| Linux | **Supported** | POSIX `sh` installer; omp coding hosts / herdr panes |
| macOS | **Supported** | Same as Linux |
| Windows | **Not supported** | Installer refuses. Extension paths and `node` discovery are Unix-oriented. Do not treat Git Bash / MSYS / WSL-from-Windows-docs as a supported install target unless you are actually on Linux. |

Requires: Node 16+ on the host for `gate-check.mjs` (Unlazy’s rule), Node 22+ to run this repo’s tests, and **omp 18.0.4 or newer** for the `session_stop` settle hook. Older omp builds fall back to `agent_end` + `sendMessage` and do not get the native stop-hook result.

This is not a substitute for the Unlazy skill itself. Install Unlazy first.

## Install (pinned, inspect-then-confirm)

Do **not** `curl | bash` from `main`. The installer **refuses** floating refs (`main`, `master`, `HEAD`, `latest`, short SHAs, branch names). Pin a **full 40-character commit SHA** or a `vMAJOR.MINOR.PATCH` tag.

1. Install Unlazy first so `scripts/gate-check.mjs` exists under one of:
   - `~/.config/skillshare/skills/unlazy`
   - `~/.claude/skills/unlazy`
   - `~/.agents/skills/unlazy`
   - or set `UNLAZY_SKILL_ROOT`
2. Choose the immutable pin published with this tree (update this SHA when you cut a new commit you intend people to install):

```text
PIN=86c13c412573c3824d3d31848239ad21afcc863d
```

3. Fetch the installer **from that same pin** (not from `main`), then inspect it:

```bash
curl -fsSL \
  "https://raw.githubusercontent.com/joshuaswarren/omp-unlazy-guard/${PIN}/scripts/install.sh" \
  -o /tmp/omp-unlazy-guard-install.sh
less /tmp/omp-unlazy-guard-install.sh
```

4. Inspect what it would write (source URL, dest, sha256, unified diff or full payload, commands). This does **not** write:

```bash
sh /tmp/omp-unlazy-guard-install.sh --pin "$PIN"
```

5. Confirm only after you have read that payload:

```bash
sh /tmp/omp-unlazy-guard-install.sh --pin "$PIN" --yes
```

On a TTY, omitting `--yes` prints the payload and waits for you to type `yes`. Non-TTY without `--yes` is inspect-only.

Default dest: `~/.omp/agent/extensions/unlazy-guard.ts`.
With `OMP_PROFILE` / `PI_PROFILE`: `~/.omp/profiles/<name>/agent/extensions/unlazy-guard.ts`.
With `PI_CODING_AGENT_DIR` (and no profile): `$PI_CODING_AGENT_DIR/extensions/unlazy-guard.ts`.

`install.sh --help` repeats the pin rule, inspect-then-confirm, transcript locations, OS scope, and the third-party notice.

6. **Restart** long-lived omp panes (or start a fresh session) so omp reloads extensions.

Local / already-cloned tree (still requires `--pin` and inspect-then-confirm):

```bash
sh scripts/install.sh --pin "$PIN" --from-file ./unlazy-guard.ts
sh scripts/install.sh --pin "$PIN" --from-file ./unlazy-guard.ts --yes
```

## Approval is inspect-then-confirm

`/unlazy-approve` and `/unlazy-reverify` do **not** take a single-shot yes that hides the payload.

| Step | Command | What happens |
|---|---|---|
| 1. Inspect | `/unlazy-approve` or `/unlazy-approve inspect` | Shows `--status` (Unlazy’s always-non-executing mode) plus `CHECK:` / `EXPECT:` / `CWD:` / `SHELL:` lines from `GATES.md` and `.unlazy/*/GATES.md`. Does **not** run `--approve`. |
| 2. Confirm | `/unlazy-approve confirm` | Runs upstream `gate-check.mjs --approve --root <cwd>` only if this session already inspected that cwd. |

`/unlazy-reverify` / `/unlazy-reverify confirm` is the same pattern for `--reverify`.

`confirm` without a prior inspect is refused and the inspect payload is shown instead. A bare `yes` argument is rejected.

Upstream approvals still live under `~/.unlazy/approved` (outside the repo). This companion does not store approval records.

## Transcript persistence

This extension does **not** keep a second private transcript store. It rides omp’s session JSONL.

| What | Where |
|---|---|
| Session / transcript files | `~/.omp/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl` |
| Named profile | `~/.omp/profiles/<name>/agent/sessions/...` (`OMP_PROFILE` / `PI_PROFILE`) |
| `PI_CODING_AGENT_DIR` | `$PI_CODING_AGENT_DIR/sessions/...` |
| Linux XDG (after `omp config migrate`) | `$XDG_DATA_HOME/omp/sessions/...` (omp flattens the `agent/` prefix) |
| Blobs referenced from JSONL | `~/.omp/agent/blobs/<sha256>` (or the XDG data equivalent) |
| Terminal breadcrumbs | `~/.omp/agent/terminal-sessions/<terminal-id>` |

**How to find them:** list the sessions directory above; filenames are `<timestamp>_<sessionId>.jsonl`. omp’s `session_stop` payload includes `session_file` when the host has materialized the JSONL. `/unlazy-status`, inspect, and confirm also `appendEntry` a `unlazy-gate-check` custom entry into the current session when the host supports it.

**Retention:** omp does not auto-delete these JSONL files. They persist until you remove them. There is no TTL in this companion. Do not commit session files; they can contain workspace paths and command text.

## Slash commands

- `/unlazy-status` — gate status for the current repo (non-executing)
- `/unlazy-reverify` — inspect-then-confirm re-verification
- `/unlazy-approve` — inspect-then-confirm approval helpers (records stay under `~/.unlazy/approved`)
- `/unlazy-scopes` — Depth Tree scopes when `.unlazy/` is present

Also registers tool `unlazy_status` for agent-callable checks.

## Behavior

- `before_agent_start`: inject reminder when unmet GATES exist
- `session_stop` (omp **18.0.4** settle hook): `{ continue: true, additionalContext }` / `{ decision: "block" }` while unmet (max 6, then release). Skips when `stop_hook_active`.
- `agent_end`: notification-only on 18.x when `session_stop` already ran; `sendMessage(..., { deliverAs: "nextTurn", triggerTurn: true })` fallback on older hosts
- `turn_end`: status only — not treated as turn-complete settle
- Shells out to upstream `gate-check.mjs` (does not reimplement CHECK logic)

## Tests

Named-version omp tests pin **`@oh-my-pi/pi-coding-agent@18.0.4`** (exact, not `latest` / not `^`). They assert `session_stop` / `agent_end` / `turn_end` behavior this guard cares about.

```bash
npm ci --ignore-scripts
npm test
```

CI: `.github/workflows/ci.yml` runs that command on every push and pull request.

## Support

Every bit of support helps keep omp-unlazy-guard alive and free. If you are able, [sponsor on GitHub](https://github.com/sponsors/joshuaswarren) or send a Lightning donation to `joshuaswarren@strike.me` to directly fund continued development and new integrations.

[![Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-pink?style=for-the-badge)](https://github.com/sponsors/joshuaswarren)

If financial support is not an option, you can still make a big difference: [star the repo](https://github.com/joshuaswarren/omp-unlazy-guard), share it, or recommend it to a colleague. Word of mouth is how most people find omp-unlazy-guard.

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2026 Joshua Warren (unofficial third-party companion extension only). Upstream Unlazy © Leonxlnx.

## Changelog

- **COS-176:** Pinned installer, inspect-then-confirm approval, transcript + Linux/macOS/Windows-unsupported docs, named omp 18.0.4 end-of-turn tests.
- **COS-151:** Spawn real `node` for gate-check (inside omp, `process.execPath` is the omp binary, which rejected `--status`/`--root`).