---
description: "Generate agent handoff documentation for the current session"
argument-hint: "[notes] [instructions] (optional - additional context to include)"
allowed-tools: ["Read", "Edit", "Bash", "Glob", "Grep"]
---

# Agent Handoff Generator

Generate or refresh `_docs/agent-handoff.md` with the current project state so a fresh coding agent can pick up where we left off.

Usage examples:
- `/handoff` (auto-summarize current session state)
- `/handoff "Include note about pending navigation improvements"`

### Documents to reference for current status
@_docs/agent-handoff.md
@_docs/development-tracker.md
@_docs/issue-backlog.md
@_docs/work-breakdown-structure.md
@_docs/README.md

If arguments are provided (`$ARGUMENTS` is not empty):
- Include the provided notes under a section titled **Additional Notes**.

If no arguments are provided:
- Inspect recent changes since the last handoff update using git status/log and modified files.
- Summarize the current state in a concise, scannable format.

The generated handoff must include these sections:
- **Project State Summary** (key implemented features and behavior)
- **Key Files Touched** (paths only)
- **Outstanding Work / Next Focus**
- **Testing Notes**
- **Git Notes** (uncommitted files to ignore, local env notes)
- **Additional Notes** (only if `$ARGUMENTS` provided)

Formatting requirements:
- Use short bullets, no paragraphs longer than 3 lines.
- Use absolute dates where relevant.
- Keep content factual and derived from repo state.

