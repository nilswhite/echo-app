---
description: "Review essential project context for a quick start for progress"
argument-hint: "[custom instructions] (optional - use prompt if not specified)"
allowed-tools: ["Read", "Edit", "Bash", "Glob", "Grep"]
---

# Prime Agent Context

READ (if files exist):
- @CLAUDE.md
- @README.md
- @agent-handoff.md
- @development-tracker.md
- @issue-backlog.md

THEN:
1. Review the latest updates that were made to the project to remind the user
2. List the top 5 items in the `## Open Issues` within `@issue-backlog.md` and ask the user whether they would like to start implementation there or somewhere else. 
