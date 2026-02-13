# Changelog

All notable changes to seamless-claude are documented
here. Format follows [Keep a Changelog][kac].

[kac]: https://keepachangelog.com/en/1.1.0/

## [0.2.0] — 2026-02-13

### Added

- **Custom compaction prompt** (`SEAMLESS_PROMPT_FILE`):
  override the default prompt entirely with a
  user-supplied file. Tilde expansion supported.
  Silent fallback to the default if the file is
  missing or unreadable.
- **User Intent section** in the default prompt.
  Instructs the summariser to preserve the user's
  original requests, clarifications, and stated
  constraints verbatim — only direction-shaping
  messages, not every exchange.

### Changed

- Output validation relaxed when a custom prompt is
  active: section-name check skipped (custom prompts
  produce different sections), minimum length check
  (500 chars) still applies.
- Default prompt sections renumbered from 5 to 6 to
  accommodate User Intent.
- `EXPECTED_SECTIONS` in config.mjs updated to
  include `User Intent`.

## [0.1.1] — 2026-02-13

### Fixed

- Section heading validation is now case-insensitive.
  Sonnet sometimes produces lowercase headings
  (`session summary` vs `Session Summary`), which
  caused valid summaries to fail validation and
  trigger unnecessary retries.
- Test suite no longer leaks `SEAMLESS_DISPLAY_CMD`
  from the host environment into integration tests.

### Added

- Error logging for UserPromptSubmit hook. Errors
  now logged to `~/.seamless-claude/ups-errors.log`
  instead of being silently swallowed.
- `SEAMLESS_INDICATOR` env var passed to custom
  display commands. Always set when the plugin is
  active: `S` when idle, status emoji otherwise.
  Makes it easy to confirm the plugin is running.
- `indicator()` function exported from
  `lib/statusline.mjs`.
- Community files: Apache 2.0 licence, contributing
  guide, security policy, issue templates, PR
  template, CI workflow.

## [0.1.0] — 2026-02-12

Initial release.

### Added

- **Core compaction engine**: background `claude -p`
  call generates structured five-section summaries
  (Session Summary, Technical Context, Knowledge
  Extractions, Next Steps, Active Context).
- **Two-threshold monitoring** via statusline:
  compaction at 70%, wrap-up injection at 90%.
  Thresholds configurable via env vars.
- **Custom display command** (`SEAMLESS_DISPLAY_CMD`):
  delegate statusline rendering to an external script
  while seamless-claude handles monitoring. Passes
  env vars (`SEAMLESS_PCT`, `SEAMLESS_STATUS`, etc.)
  and raw Claude Code JSON on stdin.
- **Status file** (`~/.seamless-claude/status.json`):
  machine-readable session status updated after every
  response, usable by external tooling.
- **Error detection** (three layers): statusline icon
  within 10 minutes of compactor failure, structured
  `error_message` in status.json, one-shot in-context
  notification to Claude via UserPromptSubmit.
- **Cross-session resume**: `claude-resume` CLI
  command and `/seamless-claude:resume` skill for
  loading previous session summaries into new
  sessions. Supports prefix matching, `--list`,
  `--pick`, `--print`, and claude passthrough args.
- **Extensibility** (`hooks.d`): drop executable
  scripts into `~/.seamless-claude/hooks.d/` to run
  custom post-compaction commands. Output appended to
  the session summary.
- **Resilience**: retry with halved transcript on
  failure, output validation, lockfile-based
  concurrency control, stale lock detection, one-shot
  state markers to prevent re-triggers.
- **Session auto-resume**: SessionStart hook injects
  the most recent summary when starting a fresh
  session. Resume intent marker enables targeted
  resume across sessions.
- **PreCompact hook**: fallback compaction for Basic
  Mode (no statusline configured).
- CI workflow (lint + tests on Node 18/22).
