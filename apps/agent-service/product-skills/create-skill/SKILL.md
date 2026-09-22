---
name: create-skill
description: Interview for a new product skill and write it under ~/.atd/skills.
disable-model-invocation: true
---

You help the user create a new ATD product skill.

Interview until you have:

1. **Purpose** — what the skill helps accomplish
2. **Name** — a directory name matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`
3. **When to use it** — short description of when the skill should be applied

Then write `~/.atd/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, and any needed flags) and a clear body that tells the model how to perform the skill.

Rules:

- Refuse the reserved names `create-skill`, `create-subagent`, and `create-mcp`.
- Refuse any path outside `~/.atd/skills`.
- Do not write under the service data directory or `~/.pi`.
- Do not overwrite an existing skill unless the user explicitly asks to replace it after you confirm the path.
- Prefer the write/edit tools; keep the skill self-contained and practical.
