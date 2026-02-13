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

### From [marketplace][mkt] (recommended)

```
/plugin marketplace add RemoteCTO/claude-plugins-marketplace
/plugin install seamless-claude
```

### Manual

```bash
/install-plugin RemoteCTO/seamless-claude
```

Either method installs the hooks (PreCompact,
SessionStart, UserPromptSubmit) automatically.
Basic Mode works immediately — no further setup
needed.

[mkt]: https://github.com/RemoteCTO/claude-plugins-marketplace

For Full Mode (recommended), continue to
[Setup](#setup-full-mode).

## Updating

The plugin cache path includes the version number.
After updating, you **must** update the statusline
path in `~/.claude/settings.json` to match the new
version:

```bash
# Find the new path
find ~/.claude/plugins -name statusline.mjs \
  -path '*seamless*' 2>/dev/null
```

Update the `statusLine.command` value in
`settings.json` with the new path, then restart
Claude Code.

## Setup (Full Mode)

Full Mode adds proactive monitoring via the
statusline. Three steps:

### 1. Find the plugin path

The plugin installs to a versioned cache directory.
Find it with:

```bash
find ~/.claude/plugins -name statusline.mjs \
  -path '*seamless*' 2>/dev/null
```

This returns something like:
```
~/.claude/plugins/cache/remotecto-plugins/seamless-claude/0.1.1/scripts/statusline.mjs
```

### 2. Add the statusline to settings.json

Edit `~/.claude/settings.json` and add the
`statusLine` block using the full path from step 1:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/cache/remotecto-plugins/seamless-claude/0.1.1/scripts/statusline.mjs"
  }
}
```

### 3. Disable native auto-compaction

seamless-claude replaces Claude Code's built-in
compaction. Running both causes conflicts — native
compaction fires at ~90%, the same threshold where
seamless-claude injects its wrap-up.

Add to the `env` block in `settings.json`:

```json
{
  "env": {
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "100"
  }
}
```

Setting this to `100` effectively disables native
compaction (it would only fire at 100%, which never
happens). seamless-claude handles everything instead.

### 4. Restart Claude Code

Restart for the changes to take effect. You should
see the built-in statusline:

```
seamless: 45% █████████░░░░░░░░░░░
```

If you have an existing statusline you want to keep,
see [Using with an existing statusline](#using-with-an-existing-statusline).

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
| — | `idle` | Monitoring, below threshold |
| 🔄 | `compacting` | Background compaction running |
| ✅ | `ready` | Summary ready for resume |
| ❌ | `error` | Compaction failed |
| ⚠️ | `wrapup` | Context critical, finishing up |

Custom display commands receive a `SEAMLESS_INDICATOR`
env var that always has a value (`S` when idle, emoji
otherwise) — useful for confirming the plugin is
active.

For Basic Mode, skip the statusline config entirely.

### Why seamless-claude owns the statusline slot

Ideally, you'd own the statusline and call a
seamless-claude widget from within your script.
We'd prefer that architecture too — it's more
composable, keeps you in control, and means version
bumps don't break your statusline path.

The constraint is Claude Code's hook model. The
`statusLine` hook is the only reliable trigger that
fires after every response. seamless-claude needs
that trigger to monitor context usage and fire
background compaction at the right moment. There's
no generic "AfterResponse" hook available.

If Claude Code adds one, we'll invert the flow so
your script is primary and seamless-claude becomes
a callable widget. Until then, the `SEAMLESS_DISPLAY_CMD`
delegation is the best we can do.

### Using with an existing statusline

If you already have a custom statusline command,
you don't need to replace it. The data flow is:

```
Claude Code → seamless-claude statusline.mjs
                ├── monitors context, triggers compaction
                ├── writes status.json
                └── calls YOUR script via SEAMLESS_DISPLAY_CMD
                      ├── receives original JSON on stdin
                      ├── receives env vars with seamless status
                      └── prints statusline to stdout
```

#### Step 1: Point seamless-claude at your script

Add `SEAMLESS_DISPLAY_CMD` to the `env` block in
`settings.json`:

```json
{
  "env": {
    "SEAMLESS_DISPLAY_CMD": "~/.claude/statusline.rb",
    "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "100"
  },
  "statusLine": {
    "type": "command",
    "command": "node ~/.claude/plugins/cache/remotecto-plugins/seamless-claude/0.1.1/scripts/statusline.mjs"
  }
}
```

The `statusLine.command` points to seamless-claude
(not your script). seamless-claude handles
monitoring, then delegates display to your script.

#### Step 2: Read the env vars in your script

Your script receives the original Claude Code JSON
on stdin (unchanged) plus these env vars:

| Env var | Example | Description |
|---------|---------|-------------|
| `SEAMLESS_PCT` | `73` | Context usage % |
| `SEAMLESS_STATUS` | `compacting` | idle, compacting, ready, error, wrapup |
| `SEAMLESS_INDICATOR` | `S` or `🔄` | Short indicator (always set) |
| `SEAMLESS_SESSION_ID` | `a1b2...` | Full session UUID |
| `SEAMLESS_SESSION_SHORT` | `a1b2c3d4` | First 8 chars |
| `SEAMLESS_SUMMARY_PATH` | `/path/to.md` | Empty if not ready |

Your script processes stdin as normal for its own
output, then reads the env vars to show compaction
status. Here's a minimal example in Ruby:

```ruby
#!/usr/bin/env ruby
data = JSON.parse($stdin.read)

# Your existing statusline logic here...
pct = data.dig('context_window', 'used_percentage')
# ... build your output ...

# Add seamless-claude status from env vars
status = ENV['SEAMLESS_STATUS']
short  = ENV['SEAMLESS_SESSION_SHORT']
indicator = case status
  when 'compacting' then ' 🔄'
  when 'ready'      then " ✅ #{short}"
  when 'error'      then " ❌ #{short}"
  when 'wrapup'     then " ⚠️ #{short}"
  when 'idle'       then ' S'
  else ''
  end

puts "#{your_bar}#{indicator}"
```

And in shell:

```sh
#!/bin/sh
# Parse stdin JSON with jq for your own output
PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage')

# Seamless status from env vars
case "$SEAMLESS_STATUS" in
  compacting) ICON="🔄" ;;
  ready)      ICON="✅ $SEAMLESS_SESSION_SHORT" ;;
  error)      ICON="❌ $SEAMLESS_SESSION_SHORT" ;;
  wrapup)     ICON="⚠️ $SEAMLESS_SESSION_SHORT" ;;
  idle)       ICON="S" ;;
  *)          ICON="" ;;
esac

echo "${PCT}% ${ICON}"
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

### PATH setup

Claude Code's plugin system installs the binary at
a versioned path but doesn't add it to your shell's
PATH. You have two options:

**Option A: Durable wrapper (recommended)**

Create a thin wrapper that finds the latest version
automatically — survives plugin updates:

```bash
mkdir -p ~/.claude/bin

cat > ~/.claude/bin/claude-resume << 'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
PLUGIN_DIR="$HOME/.claude/plugins/cache"
PLUGIN_DIR+="/remotecto-plugins/seamless-claude"
LATEST=$(ls -1 "$PLUGIN_DIR" 2>/dev/null \
  | sort -V | tail -1)
if [ -z "$LATEST" ]; then
  echo "seamless-claude not installed" >&2
  exit 1
fi
exec node \
  "$PLUGIN_DIR/$LATEST/bin/claude-resume" "$@"
WRAPPER

chmod +x ~/.claude/bin/claude-resume
```

Then add `~/.claude/bin` to your PATH (if not
already there):

```bash
# Add to ~/.zshrc or ~/.bashrc
export PATH="$HOME/.claude/bin:$PATH"
```

**Option B: Direct symlink**

Simpler but breaks on each version update:

```bash
ln -sf ~/.claude/plugins/cache/remotecto-plugins/\
seamless-claude/0.1.1/bin/claude-resume \
  ~/.local/bin/claude-resume
```

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
  least 3 of the 5 expected sections (case-insensitive)
  and exceeds 500 characters
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

## Troubleshooting

**Statusline not showing**

The statusline only appears in Full Mode. Check:
1. `statusLine` is set in `~/.claude/settings.json`
2. The path to `statusline.mjs` is correct — run
   `find ~/.claude/plugins -name statusline.mjs -path '*seamless*'`
3. Restart Claude Code after changing settings

**Compaction not triggering**

Compaction triggers at 70% context usage (default).
Check `~/.seamless-claude/status.json` for the
current state. If `pct` is below the threshold,
the session hasn't used enough context yet.

**Native compaction still firing**

Add `"CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "100"` to
the `env` block in `settings.json`. This prevents
native compaction from competing with seamless-claude.

**"UserPromptSubmit hook error" messages**

Claude Code shows a generic error if any
UserPromptSubmit hook fails — it doesn't identify
which plugin. Check
`~/.seamless-claude/ups-errors.log` for
seamless-claude errors. If that file is empty or
missing, the error is from another plugin.

**Plugin path changed after update**

See [Updating](#updating).

**Reverting to default**

Remove the `statusLine` block from `settings.json`,
remove `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` from `env`,
and restart Claude Code. The plugin's hooks still
work in Basic Mode without the statusline.

## Uninstall

The plugin cleans up after itself when uninstalled.
All data under `~/.seamless-claude/` is removed.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Please update
[CHANGELOG.md](CHANGELOG.md) with your changes.

## Licence

Apache 2.0 — see [LICENCE](LICENCE) and
[NOTICE](NOTICE).
