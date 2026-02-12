---
name: resume
description: Resume from a previous session's precompact summary
argument-hint: "[session_id | --latest | --pick | --list]"
disable-model-invocation: true
---

Resume a previous Claude Code session using its
precompact summary.

Run the resume script:
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/resume.mjs" $ARGUMENTS`

Load the output above as session context. This is a
summary of a previous session — treat it as your
working memory. Do not ask the user to confirm what
they were working on; just pick up where things left
off.
