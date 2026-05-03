---
description: "Update development tracker with progress notes"
argument-hint: "[description] (optional - auto-detects changes if empty)"
allowed-tools: ["Read", "Edit", "Bash", "Glob", "Grep"]
---

# Development Log Update

Update the development tracker (`specs/development-tracker.md`) with new progress entries. 
Add new entries to the top of the `### Progress Notes` section

Usage examples for updates made:
- `/log` (auto-detect recent changes since last log entry)
- `/log "Fixed database retention policy"`
- `/log "Added new API endpoint for recipe cleanup"`

Usage examples for updating `## Open Issues` list
- `/log "Next feature: build out light/dark mode toggle"`
- `/log "Pull next feature from WBS"`

INSTRUCTION: Include completed items from the `## Completed Issues` from `_docs/issue-backlog.md` if an issue fix is significant

Arguments:
- `$ARGUMENTS`: Description of what was accomplished (optional)
or 
- `$ARGUMENTS`: Instructions or description for on-deck feature(s)

If arguments are provided (`$ARGUMENTS` is not empty):
- Add the provided description as a new log entry with today's date
- Format consistently with existing entries

If no arguments are provided (`$ARGUMENTS` is empty):
- Analyze recent changes since the last log entry in `_docs/development-tracker.md`
- Analyze recent issues logged and fixed in `_docs/issue-backlog.md`
- Use git log, file modification times, and recent file changes to detect:
  - New files created in src/, components/, lib/, api/ directories
  - Modified TypeScript/JavaScript files with significant changes
  - New API endpoints or major functionality additions
  - Database schema changes (prisma/schema.prisma)
  - New dependencies added (package.json changes)
- Generate a comprehensive log entry summarizing the major functionality additions
- Include relevant technical details about what was implemented
- Note what's ready for testing and next steps

## Progress Notes Format
Populate all sections with the appropriate update information:
**#### [Date+Time] - [Title - Short Title of Categorical Updates]:**
**Updates**: 
Format: bulleted list

**Testing**
Format: checkbox list
Rule: tests that were completed = checked box, items ready for testing: unchecked box

Formatting rule:
- Always leave a blank line between the Updates list and the Testing section heading to avoid markdown rendering issues.

For all updates, keep entries concise but informative for future reference when returning to the project.