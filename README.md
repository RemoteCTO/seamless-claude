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

**Important:** Disable Claude Code's built-in
auto-compaction. seamless-claude replaces it
entirely — running both will cause conflicts.
See [Setup](#setup-full-mode).

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

1. Disable auto-compaction in Claude Code settings
   (`/config` → auto-compact off)

2. Add the statusline to `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/seamless-claude/scripts/statusline.mjs"
  }
}
```

Adjust the path to wherever the plugin is installed.

> **Why disable auto-compaction?** seamless-claude
> replaces it. Native auto-compaction fires at ~90%,
> the same threshold where seamless-claude injects
> its wrap-up. Running both means native compaction
> interrupts the managed handoff. If you want a
> safety net, you can set
> `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=95` in your env
> instead of fully disabling — but this is
> unsupported and may still cause conflicts.

The statusline shows context usage after every
response:

```
seamless: 45% █████████░░░░░░░░░░░
seamless: 73% ██████████████░░░░░░ 🔄 a1b2c3d4
seamless: 80% ████████████████░░░░ ✅ a1b2c3d4
seamless: 80% ████████████████░░░░ ❌ a1b2c3d4
seamless: 92% ██████████████████░░ ⚠️ a1b2c3d4
```

The session hash (first 8 chars of ID) appears once
compaction starts. Icons:

| Icon | Status | Meaning |
|------|--------|---------|
| 🔄 | `compacting` | Background compaction running |
| ✅ | `ready` | Summary ready for resume |
| ❌ | `error` | Compaction failed |
| ⚠️ | `wrapup` | Context critical, finishing up |

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
| `SEAMLESS_STATUS` | `compacting` | idle, compacting, ready, error, wrapup |
| `SEAMLESS_SESSION_ID` | `a1b2...` | Full session UUID |
| `SEAMLESS_SESSION_SHORT` | `a1b2c3d4` | First 8 chars |
| `SEAMLESS_SUMMARY_PATH` | `/path/to/summary.md` | Empty if not ready |

Example `settings.json`:

```json
{
  "env": {
    "SEAMLESS_DISPLAY_CMD": "/path/to/your/statusline.sh"
  },
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/seamless-claude/scripts/statusline.mjs"
  }
}
```

Your script can read the env vars to incorporate
seamless status into its own display. For example,
in a shell script:

```bash
#!/bin/sh
# Read seamless status from env
STATUS="$SEAMLESS_STATUS"
SHORT="$SEAMLESS_SESSION_SHORT"
# ... include in your output
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

On error, additional fields appear:

```json
{
  "status": "error",
  "log_path": "~/.seamless-claude/sessions/a1b2...log",
  "error_message": "Attempt 2 failed: timeout"
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

## Cross-session resume

The automatic flow handles compaction within a
session. For resuming a *different* session (next
day, different machine), use the `claude-resume`
command:

```bash
claude-resume              # resume latest session
claude-resume a1b2c3d4     # resume by prefix
claude-resume --list       # show available
claude-resume --pick       # interactive picker
claude-resume --print      # output text only
```

This starts a new `claude` session with the
pre-compacted summary injected as context. Short
ID prefixes work — you don't need the full UUID.
The 8-character prefix shown in the statusline is
enough.

Any extra arguments pass through to `claude`:

```bash
claude-resume --latest -p "continue the migration"
claude-resume a1b2c3d4 --model opus
```

`--print` outputs the resume text to stdout without
launching claude — useful for piping or inspection.

### From within a session

If you're already inside Claude Code and want to
load a previous session's context, use the skill
instead:

```
/seamless-claude:resume --latest
/seamless-claude:resume a1b2c3d4
```

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
- **Error detection**: If the compactor dies, the
  statusline shows ❌ within 10 minutes and Claude
  is notified on the next prompt with the last log
  line and log path

## Token usage

seamless-claude adds one extra API call per
compaction cycle: a `claude -p` call using the
Sonnet model to generate the structured summary.
This is the same mechanism Claude Code uses for
native compaction, but it runs in the background
instead of blocking your session.

**What it costs:**

- One Sonnet call per compaction (~50-150K input
  tokens for the transcript, ~2-5K output tokens
  for the summary)
- Roughly $0.15-0.50 per compaction depending on
  session length
- A retry (if the first attempt fails) halves the
  transcript, so roughly half the cost again

**What you get back:**

- No idle time during compaction (3+ minutes saved
  per cycle)
- Structured summaries preserve more technical
  detail than native compaction
- Cross-session resume means less context re-reading
  at the start of new sessions

With native auto-compaction disabled, seamless-claude
is the only thing generating summaries. There's no
duplicate work.

**Net effect:** slightly more tokens per session,
but significantly more productive use of those
tokens. The background compaction cost is roughly
equivalent to one medium-length Claude response.

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
