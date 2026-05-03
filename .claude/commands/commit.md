---
description: "Commit current changes with a clear message"
argument-hint: "[commit message]"
allowed-tools: ["Read", "Edit", "Bash", "Glob", "Grep"]
---

# Commit Changes

Create a git commit for the current working tree changes.

Usage examples:
- `/commit "Fix shopping list delete flow"`
- `/commit "Update navigation shell styling"`

Rules:
- If `$ARGUMENTS` is empty, ask the user for a commit message.

If arguments are provided (`$ARGUMENTS` is not empty):
- Add the provided description as a new log entry with today's date and current time

If no arguments are provided (`$ARGUMENTS` is empty):
- Analyze recent changes since the last log entry in `specs/development-tracker.md`
- Analyze recent issues logged and fixed in `specs/issue-backlog.md`
- Use file modification times, and recent file changes to detect:
  - New files created in src/, components/, lib/, api/ directories
  - Modified TypeScript/JavaScript files with significant changes
  - New API endpoints or major functionality additions
  - Database schema changes (prisma/schema.prisma)
  - New dependencies added (package.json changes)
- Generate a comprehensive summary of the major feature and functionality additions

- Do not include `.env`, `.next/*`, or `prisma/dev.db` in commits.
- Show a short `git status -sb` summary before committing.
- Stage only tracked or new project files relevant to the changes (avoid build artifacts).
- Commit with the provided or created message.

Suggested flow:
1) `git status -sb`
2) `git add <target files>` (exclude `.env`, `.next/*`, `prisma/dev.db`)
3) `git commit -m "$ARGUMENTS"`
