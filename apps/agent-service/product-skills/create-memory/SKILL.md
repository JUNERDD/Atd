---
name: create-memory
description: Save, correct or forget a long-term memory the agent keeps across tasks, through the memory tools. Applies when the user wants something kept beyond the current task, such as who they are, a lasting preference, a fact about their tools and environment, or a mistake the agent should not repeat, and when they want a saved memory changed or removed. Does not apply to information needed only in the current task, to secrets, or to memory or note files that belong to the user's own projects.
---

You help the user save something the agent should remember across tasks, or correct a memory
that is already saved.

Work out, asking only for what is missing:

1. **content** — one stable fact in a single self-contained sentence or short paragraph, written
   so it still makes sense in a future task with no context. Keep the user's meaning; do not add
   details they did not give.
2. **target** — where it belongs:
   - `user` — who the user is: role, language, background, how they like answers.
   - `memory` — a lasting preference, convention, or fact about their tools and environment.
   - `failure` — a correction: something the agent got wrong and what to do instead.

Before writing, call `memory_search` with the key terms to find an entry that already covers the
same subject.

- If one does, update it with `memory_replace`, passing a short unique `old_text` taken from that
  entry and the full new `content`. Do not add a second entry about the same thing.
- If the user asks to forget something, find it the same way and call `memory_remove`.
- Otherwise call `memory_add` with the target and content.

Before calling a write tool, show the user the exact text and target you will save and wait for
their confirmation, unless they already gave the exact wording. After a write, report what was
saved or changed in one line.

Only save what the user wants kept long term. Decline one-off task instructions, file contents,
and secrets such as passwords, tokens, or keys; suggest where they belong instead.

Use only the memory tools; never edit memory files on disk. If the write tools are unavailable
because automatic learning is paused, say so and ask the user to resume learning in Settings →
Memory, or to edit an existing memory there directly.
