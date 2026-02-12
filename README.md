# seamless-claude

Seamless session continuity for Claude Code.

When Claude Code compacts your context window, you
lose the nuance of what you were working on. Templates
and token counts don't capture *why* you made a
decision or *what* you tried that failed.

seamless-claude fixes this. It watches for compaction,
summarises your session using a fresh Claude instance,
and automatically restores that context into your new
window. No manual intervention, no lost threads.

## How it works

```
Session hits threshold
        |
        v
  PreCompact hook fires
        |
        v
  Background compactor spawns
  (reads transcript JSONL,
   calls claude -p for structured summary)
        |
        v
  Native compaction happens
        |
        v
  SessionStart hook fires
        |
        v
  Summary injected into fresh context
        |
        v
  Claude picks up where you left off
```

The summary is structured into five sections:

1. **Session Summary** — what was requested, accomplished,
   and what remains
2. **Technical Context** — file paths, commands, config
   values, error messages (verbatim, not paraphrased)
3. **Knowledge Extractions** — reusable decisions,
   learnings, patterns, and blockers
4. **Next Steps** — priority-ordered action items
5. **Active Context** — working directory, branch,
   key files

## Install

```bash
/plugin marketplace add RemoteCTO/seamless-claude
/plugin install seamless-claude
```

That's it. No configuration required.

## Requirements

- Claude Code
- Node.js 18+
- `claude` CLI in PATH (comes with Claude Code)

## Configuration

Everything works out of the box. Optional environment
variables for tuning:

| Variable | Default | Description |
|----------|---------|-------------|
| `SEAMLESS_MODEL` | `sonnet` | Model for summarisation |
| `SEAMLESS_TIMEOUT` | `300` | Seconds before timeout |
| `SEAMLESS_MAX_CHARS` | `400000` | Max transcript chars to process |
| `SEAMLESS_HOOK_TIMEOUT` | `60` | Per-hook timeout in seconds |

## Cross-session resume

The automatic flow handles compaction within a session.
For resuming a *different* session (next day, different
machine), use the skill:

```
/seamless-claude:resume --latest
/seamless-claude:resume --list
/seamless-claude:resume --pick
/seamless-claude:resume a1b2c3d4
```

Short ID prefixes work — you don't need the full UUID.

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

- **Write to stdout** — captured and appended to the
  session summary
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

The compactor is built to handle failure gracefully:

- **Timeout**: 5-minute default, kills the child process
  on expiry
- **Retry**: On failure (timeout, bad exit, empty result),
  retries once with a halved transcript
- **Validation**: Checks the summary contains at least 3
  of the 5 expected sections and exceeds 500 characters
- **Lockfiles**: Prevents duplicate compactions; stale
  locks (>10 min) are automatically cleaned
- **Output cap**: Resume output capped at 200K characters
  to stay within shell limits

## How it compares

| Feature | seamless-claude | precompact-hook | claude-mem | Continuous Claude v3 |
|---------|----------------|-----------------|------------|---------------------|
| LLM summarisation | Yes | Yes | Yes | No (template) |
| Handles auto-compaction | Yes | Yes | No | Yes |
| Cross-session resume | Yes | No | Yes | Partial |
| Extensible (hooks.d) | Yes | No | No | No |
| Retry on failure | Yes | No | No | No |
| Output validation | Yes | No | No | No |
| Dependencies | Node.js | claude CLI | Bun, Chroma, SQLite | Docker, PostgreSQL |
| Complexity | ~1600 lines | ~140 lines | Large | Very large |

## Data storage

Summaries are stored locally at
`~/.seamless-claude/sessions/`. Each compaction
produces three files:

- `{session_id}.md` — the structured summary
- `{session_id}.json` — metadata (timestamps, offsets)
- `{session_id}.log` — compaction log (for debugging)

No data leaves your machine beyond the `claude -p` call,
which uses the same privacy terms as your normal Claude
Code usage.

## Licence

Apache 2.0 — see [LICENCE](LICENCE) and [NOTICE](NOTICE).
