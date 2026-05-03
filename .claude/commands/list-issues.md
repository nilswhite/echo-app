---
description: "Generate a simple distilled list of issues in the issue-backlog"
argument-hint: none
allowed-tools: ["Read", "Edit", "Bash", "Glob", "Grep"]
---

# Issue Backlog Presenter

Your objective is to present the user with a structured list of open issues in the backlog in the @issue-backlog.md file.

## Output Structure
- Tabular format is preferred with:
  - Issue ID
  - Issue name
  - Short summary description of the issue - one or two sentences - enough to ensure the user understands the gist. DO NOT be verbose here - the user will ask for more information if they cannot glean the intent from your short description.
  - Effort estimate to implement - based on your quick assessment of the scope of the issue.
- Provide a short recommendation of next issues to take up based on a quick assessment of effort x impact