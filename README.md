# seamless-claude

Zero-downtime compaction for Claude Code.

Every time Claude Code compacts your context window,
you sit idle for minutes while it summarises your
session. With long conversations, that's 3+ minutes
of dead time — and it happens repeatedly.

seamless-claude eliminates the wait. It monitors
context usage via the statusline, fires background
compaction early, and injects a wrap-up instruction
when context is critical. Fresh sessions auto-resume
from the prepared summary. Zero downtime.

## Two modes

### Full Mode (recommended)

Configure the statusline and seamless-claude owns
the entire compaction lifecycle:

```
Context at 70%  →  background compaction starts
                   (summary ready in ~2 min)

Context at 90%  →  wrap-up instruction injected
                   ("finish up, start fresh")

User starts     →  summary auto-injected into
fresh session      new context window
```

Native compaction at 95% remains as a safety net
(`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=95`).

### Basic Mode (fallback)

Without statusline configuration, seamless-claude
falls back to hook-only operation:

- Native compaction fires at default threshold
- `PreCompact` hook spawns the compactor (user waits)
- `SessionStart` hook injects the summary
- Still better than nothing (structured resume)

## How it works

The summary is structured into five sections:

1. **Session Summary** — what was requested,
   accomplished, and what remains
2. **Technical Context** — file paths, commands,
   config values, error messages (verbatim)
3. **Knowledge Extractions** — reusable decisions,
   learnings, patterns, and blockers
4. **Next Steps** — priority-ordered action items
5. **Active Context** — working directory, branch,
   key files

## Install

```bash
/install-plugin RemoteCTO/seamless-claude
```

## Setup (Full Mode)

Add to your `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "95"
  },
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/seamless-claude/scripts/statusline.mjs"
  }
}
```

Adjust the path to wherever the plugin is installed.
The statusline shows context usage after every
response:

```
seamless: 45% █████████░░░░░░░░░░░
seamless: 73% ██████████████░░░░░░ 🔄
seamless: 92% ██████████████████░░ ⚠️
```

Icons: 🔄 compacting, ✅ summary ready, ⚠️ wrap-up.

For Basic Mode, skip the statusline config entirely.

### Custom statusline display

If you already have a statusline script, set
`SEAMLESS_DISPLAY_CMD` to delegate display to it.
seamless-claude handles monitoring, then calls your
command for the actual output.

Your command receives:

- **stdin**: the original Claude Code JSON (same
  data your statusline already parses)
- **env vars**: seamless-claude status

| Env var | Example | Description |
|---------|---------|-------------|
| `SEAMLESS_PCT` | `73.5` | Context usage % |
| `SEAMLESS_STATUS` | `compacting` | idle, compacting, ready, wrapup |
| `SEAMLESS_SESSION_ID` | `a1b2...` | Full session UUID |
| `SEAMLESS_SESSION_SHORT` | `a1b2c3d4` | First 8 chars |
| `SEAMLESS_SUMMARY_PATH` | `/path/to/summary.md` | Empty if not ready |

Example `settings.json`:

```json
{
  "env": {
    "SEAMLESS_DISPLAY_CMD": "ruby ~/.claude/statusline.rb",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "95"
  },
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/seamless-claude/scripts/statusline.mjs"
  }
}
```

Your script can then incorporate the status:

```ruby
# In your existing statusline script
status = ENV['SEAMLESS_STATUS']
short  = ENV['SEAMLESS_SESSION_SHORT']
icon = { 'compacting' => '🔄',
         'ready' => '✅',
         'wrapup' => '⚠️' }[status]
# Add to your display: "✅ a1b2c3d4"
```

If your command exits non-zero or produces no output,
seamless-claude falls back to its built-in bar.

### Status file

Whether or not you use `SEAMLESS_DISPLAY_CMD`,
seamless-claude writes `~/.seamless-claude/status.json`
after every response:

```json
{
  "pct": 73.5,
  "status": "compacting",
  "session_id": "a1b2c3d4-...",
  "session_short": "a1b2c3d4",
  "summary_path": "",
  "updated_at": "2026-02-12T15:30:00Z"
}
```

Any tooling can read this file — no need to
integrate with the statusline at all.

## Requirements

- Claude Code
- Node.js 18+
- `claude` CLI in PATH (comes with Claude Code)

## Configuration

Everything works with defaults. Optional environment
variables for tuning:

| Variable | Default | Purpose |
|----------|---------|---------|
| `SEAMLESS_COMPACT_PCT` | `70` | Start compaction |
| `SEAMLESS_WRAPUP_PCT` | `90` | Inject wrap-up |
| `SEAMLESS_MODEL` | `sonnet` | Compaction model |
| `SEAMLESS_TIMEOUT` | `300` | Compaction timeout (s) |
| `SEAMLESS_MAX_CHARS` | `400000` | Max transcript chars |
| `SEAMLESS_HOOK_TIMEOUT` | `60` | Per-hook timeout (s) |
| `SEAMLESS_DISPLAY_CMD` | — | Custom statusline command |

Also set in `settings.json`:

| Variable | Value | Purpose |
|----------|-------|---------|
| `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` | `95` | Safety net |

## Cross-session resume

The automatic flow handles compaction within a
session. For resuming a *different* session (next
day, different machine), use the skill:

```
/seamless-claude:resume --latest
/seamless-claude:resume --list
/seamless-claude:resume --pick
/seamless-claude:resume a1b2c3d4
```

Short ID prefixes work — you don't need the full
UUID.

## Extensibility (hooks.d)

Drop executable scripts into
`~/.seamless-claude/hooks.d/` to run custom commands
after each compaction. Zero config — if the directory
doesn't exist, nothing happens.

Scripts run sequentially in alphabetical order, so
prefix with numbers to control execution order:

```
~/.seamless-claude/hooks.d/
  01-extract-knowledge.sh
  02-update-tickets.sh
  03-notify.sh
```

### Hook contract

Each script receives these environment variables:

| Variable | Value |
|----------|-------|
| `SEAMLESS_SESSION_ID` | The session UUID |
| `SEAMLESS_TRANSCRIPT` | Path to JSONL transcript |
| `SEAMLESS_SUMMARY` | Path to base summary .md |
| `SEAMLESS_OUTPUT_DIR` | Temp dir for file outputs |

Scripts can:

- **Write to stdout** — captured and appended to
  the session summary
- **Write .md files to `$SEAMLESS_OUTPUT_DIR`** —
  contents collected and appended to the summary
- **Perform side effects** — write to ticket dirs,
  knowledge systems, send notifications, etc.

A non-zero exit code logs a warning but does **not**
abort other hooks or the compaction. Each hook has a
60-second timeout (configurable via
`SEAMLESS_HOOK_TIMEOUT`).

### Example hook

```bash
#!/bin/sh
# ~/.seamless-claude/hooks.d/01-knowledge.sh
# Extract knowledge entries and save them

claude -p --model haiku \
  --no-session-persistence \
  "Extract DECISION/LEARNED/PATTERN/BLOCKER entries
   from this summary. Output as JSON array." \
  < "$SEAMLESS_SUMMARY" \
  > "$SEAMLESS_OUTPUT_DIR/knowledge.md"
```

The output from all hooks is appended to the session
summary under `## Post-compaction: {script-name}`
headings, so Claude sees it on resume.

## Resilience

The compactor handles failure gracefully:

- **Timeout**: 5-minute default, kills the child
  process on expiry
- **Retry**: On failure (timeout, bad exit, empty
  result), retries once with a halved transcript
- **Validation**: Checks the summary contains at
  least 3 of the 5 expected sections and exceeds
  500 characters
- **Lockfiles**: Prevents duplicate compactions;
  stale locks (>10 min) are automatically cleaned
- **Output cap**: Resume output capped at 200K
  characters to stay within shell limits
- **One-shot triggers**: Each threshold fires once
  per session (state tracking prevents re-triggers)

## How it compares

| Feature | seamless-claude | precompact-hook | claude-mem | Continuous Claude |
|---------|----------------|-----------------|------------|-------------------|
| Proactive monitoring | Yes | No | No | No |
| LLM summarisation | Yes | Yes | Yes | No (template) |
| Auto-compaction | Yes | Yes | No | Yes |
| Cross-session resume | Yes | No | Yes | Partial |
| Extensible (hooks.d) | Yes | No | No | No |
| Retry on failure | Yes | No | No | No |
| Output validation | Yes | No | No | No |
| Dependencies | Node.js | claude CLI | Bun + more | Docker + PG |
| Complexity | ~2000 lines | ~140 lines | Large | Very large |

## Data storage

All data is stored locally under `~/.seamless-claude/`:

```
~/.seamless-claude/
  sessions/           # summaries, metadata, logs
    {session_id}.md
    {session_id}.json
    {session_id}.log
    {session_id}.lock
  state/              # per-session threshold state
    {session_id}.json
  hooks.d/            # user hook scripts
  status.json         # current session status
  resume-intent.json  # cross-session handover
```

No data leaves your machine beyond the `claude -p`
call, which uses the same privacy terms as your
normal Claude Code usage.

## Uninstall

The plugin cleans up after itself when uninstalled.
All data under `~/.seamless-claude/` is removed.

## Licence

Apache 2.0 — see [LICENCE](LICENCE) and
[NOTICE](NOTICE).
