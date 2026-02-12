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
| `SEAMLESS_POST_HOOK` | (none) | Command to run after compaction (see below) |

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

## Post-compact hook

If you have your own knowledge system or want to run
additional processing after compaction, set the
`SEAMLESS_POST_HOOK` environment variable:

```bash
export SEAMLESS_POST_HOOK="ruby ~/my-knowledge-extractor.rb %{output}"
```

Available placeholders:

| Placeholder | Value |
|-------------|-------|
| `%{output}` | Path to the generated summary (.md) |
| `%{meta}` | Path to the metadata file (.json) |
| `%{session}` | Session ID |

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
| Retry on failure | Yes | No | No | No |
| Output validation | Yes | No | No | No |
| Dependencies | Node.js | claude CLI | Bun, Chroma, SQLite | Docker, PostgreSQL |
| Complexity | ~1000 lines | ~140 lines | Large | Very large |

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

MIT
