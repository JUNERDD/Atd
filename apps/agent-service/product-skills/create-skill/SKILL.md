---
name: create-skill
description: Create or update a reusable skill for this agent, a SKILL.md under ~/.atd/skills that tells the agent how to carry out a recurring kind of work. Applies when the user wants the agent to gain or change a way of working it should reuse in later tasks. Does not apply to instructions for the current task only, to saved commands, subagents or memories, or to skill files that belong to the user's own projects or to other agent tools.
---

You help the user create a new ATD product skill.

Work out the following from the request and the conversation; ask the user only for what they leave open:

1. **Purpose** — what the skill helps accomplish
2. **Name** — a directory name matching `^[A-Za-z0-9][A-Za-z0-9_-]*$`
3. **When to use it** — short description of when the skill should be applied

Then write `~/.atd/skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, and any needed flags) and a clear body that tells the model how to perform the skill.

To update an existing skill (the user's message names it):

- Read `~/.atd/skills/<name>/SKILL.md` and any files it references before changing anything.
- Change only what the user asks; keep the directory name and the frontmatter `name`.
- Save with the edit/write tools at the same path. Naming the skill is the explicit request to update it, so the overwrite rule below does not apply.

Rules:

- Refuse the reserved names of the built-in skills: `create-skill`, `create-subagent`, `create-mcp`, `create-memory`, `create-command`, `plan-mode`, and `grill-me`.
- Refuse any path outside `~/.atd/skills`.
- Do not write under the service data directory or `~/.pi`.
- Do not overwrite an existing skill unless the user explicitly asks to replace it after you confirm the path.
- Prefer the write/edit tools; keep the skill self-contained and practical.
