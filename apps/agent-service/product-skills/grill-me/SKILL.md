---
name: grill-me
description: Pressure-test a plan or design one question at a time until assumptions, tradeoffs, risks, failure modes and scope edges are explicit, keeping a Markdown Q&A log and a planning-ready outcome in the task folder.
disable-model-invocation: true
---

# Grill Me

Pressure-test a plan or design until it is decision-ready. The log is support infrastructure, not the goal. The goal is to expose hidden assumptions, weak tradeoffs, missing branch decisions, and operational gaps before they harden into a plan.

## When It Runs

- Loaded directly (the `/grill-me` chip): start grilling the plan or design the user names.
- Loaded as a companion of another skill (for example plan-mode loads it alongside itself): stay inactive until that skill calls for an interview under its own rules. Do not start questioning just because these instructions are present.

## Depth Standard

Do not stop at surface clarification. Keep questioning until the plan is concrete enough that another engineer could:

- explain the goal, success criteria, and non-goals
- name the critical constraints, assumptions, and unknowns
- compare the main alternatives and why one wins
- describe the major failure modes, edge cases, and irreversible decisions
- state how the decision will be validated, rolled out, monitored, and, if needed, rolled back

Use the highest-leverage unresolved question each turn. Prefer the dependency that blocks many later decisions.

## Coverage Map

Before finalizing, make sure the grilling pass has covered the relevant branches. Not every session needs every branch, but skipping a relevant one is a failure.

- objective, problem statement, and success criteria
- scope, non-goals, phase boundaries, and what is intentionally deferred
- stakeholders, owners, and who pays the cost of failure
- assumptions, evidence, and what would falsify them
- constraints: time, staffing, budget, compatibility, compliance, latency, scale, or policy
- alternatives considered and why they were rejected
- tradeoffs and why the chosen downside is acceptable
- failure modes, abuse cases, edge cases, and one-way-door decisions
- testing, observability, rollout, migration, and rollback
- open unknowns that should block implementation instead of being hand-waved away

## Question Selection

1. Inspect the task folder or existing docs first (`read`, `grep`, `find`, `ls`) when a question can be answered locally. Only ask the user when the uncertainty is genuinely external.
2. Ask one question at a time, but stay on the current branch until the answer is operationally useful. Do not breadth-scan ten shallow topics when one foundational decision is still vague.
3. Prefer questions that force consequence, ownership, or measurable boundaries:
   - "What breaks if this assumption is wrong?"
   - "Which alternative did you reject, and why is that cost acceptable?"
   - "How will we know this decision failed in production?"
   - "What is the last safe rollback point?"
4. If the user answers vaguely, sharpen the question. Do not accept words like `simple`, `robust`, `secure`, `scalable`, `later`, or `MVP` without making them concrete.
5. If the user's answer conflicts with your recommendation, follow the consequence of that divergence instead of immediately moving on.
6. If a branch reveals a more fundamental missing decision, pivot upward and resolve that parent decision first.

## Question Quality

Prefer pressure over pleasantries. Weak questions collect narration. Strong questions surface commitments, tradeoffs, and failure boundaries.

- Weak: "How will auth work here?"
  Stronger: "Which actor or threat model makes this auth design necessary, and what unacceptable failure must it prevent?"
- Weak: "How will this scale?"
  Stronger: "At what concrete load or growth assumption does the current design stop being acceptable, and what is the planned escape hatch?"
- Weak: "Do we have a rollback plan?"
  Stronger: "What change here is hard to reverse, and what is the last safe rollback point if rollout goes wrong?"

## Session Log

The log is a Markdown transcript in the task folder, kept with the file tools. Exact formats, file naming, recovery, and repair are in `references/logged-grilling.md` (relative to this skill's directory; reading it needs no confirmation). Read it before the first question of a session.

- Transcript: `plans/grill-me/session-<name>.md`; outcome: `plans/grill-me/outcome-<name>.md`. A path the user gives wins. When a plan file exists, `<name>` is the plan's file name, so the files pair up.
- One session per grilling pass. Reuse the active transcript (header `- Status: active`) for the whole session; do not keep its path only in memory. Recover it from the folder as the reference describes.
- Each question entry holds the question, your recommendation, the resolved answer, and the raw user answer. An unanswered entry holds the marker `<<PENDING_ANSWER_<n>>>` in place of its answer.
- Writes may ask the user for permission. A declined or failed write is a failed logging step (see Hard Gates).

## Hard Gates

- Before any user-facing clarification question, append the question entry (question, recommendation, pending marker) to the transcript and wait for the write to succeed.
- Ask through `ask_user`, exactly one question per call. Put the recommended answer in the `question` text, and keep it under 4000 characters. Pass `options` (up to 8, each under 500 characters) only when the question has a few discrete answers, with your recommendation first. The user can always type a free-text answer instead.
- After every user answer, backfill it in the transcript before any follow-up analysis. Replace the pending marker with the resolved answer and the raw user reply. Do only the minimal normalization needed for logging.
- If a log write fails or is declined, stop and tell the user the logging step failed. Do not continue the grilling flow until the log is repaired.
- Keep one pending question at a time. Before asking, confirm that the transcript has no `<<PENDING_ANSWER_` marker; do not ask the next question until the previous answer is backfilled.

## Answer Normalization

Treat the transcript `Answer` field as the confirmed conclusion, not as a raw echo of the user's message. The raw user reply is audit context only.

- If the user accepts the recommendation (`yes`, `ok`, `sure`, `agreed`, `sounds good`, `that works`, `lgtm`, `proceed`, `按推荐来`, `按建议来`, `同意`, `可以`, `就这样`, `照这个来`, or an equivalent), or picks an option that is the recommendation, the resolved answer is the actual recommendation.
- If the user modifies the recommendation (for example `yes, but …` or `按推荐来，但 …`), the resolved answer is the merged decision: the accepted parts plus the user's explicit change.
- If the user gives a vague or incomplete reply, the resolved answer is the concrete part that is confirmed. Immediately ask a logged follow-up for the unresolved gap.
- If `ask_user` returns `The user cancelled the request.` (the user skipped, or sent a message instead), record the raw answer as `_Skipped by the user._` and the resolved answer as `Not decided: the user skipped this question.` Then follow the user's new message if there is one, or ask whether to continue, and treat the gap as an open blocker.
- Do not write a planning outcome whose answer is only `按推荐来`, `yes`, `OK`, `later`, `MVP`, or another pointer back to context. It must stand alone for a later planning pass.
- Preserve the exact raw user reply; do not hide reversals, hesitation, or wording that may matter later.

## Workflow

1. Resolve local answers first when the task folder or docs already contain them. Do not waste a user turn on a question the folder can answer.
2. Select the single highest-leverage unresolved question using the depth standard and coverage map above.
3. Log the question: create the transcript if the session has none, then append the question entry.
4. Only after the log write succeeds, ask exactly one question with `ask_user`, including your recommended answer.
5. When `ask_user` returns, your first action is to backfill that reply: replace the pending marker with the resolved answer and the raw answer.
6. Only after the backfill succeeds, decide whether the current branch is actually resolved or whether the answer created a sharper follow-up.
7. Conclude only when the depth standard is met or the remaining gaps are explicitly identified as blocking unknowns. Do not stop merely because several questions have already been asked.
8. When the session is complete, finalize it before presenting the result: write the planning-ready outcome file, then mark the transcript finalized and record the outcome path in its header.
9. Tell the user where both the finalized transcript and the planning-ready outcome file live.

## Response Shape

When asking:

1. Write the question entry to the log.
2. Ask one concrete question with `ask_user` that targets the highest-leverage unresolved branch.
3. Include the recommended answer.

When the user answers:

1. Backfill the log first, with raw answer and resolved answer separated.
2. Then either ask the next logged question or conclude with the transcript and outcome paths.

When concluding:

1. Write the outcome file and finalize the transcript.
2. Tell the user where the transcript and planning-ready outcome file were written.

## Guardrails

- Never let logging mechanics crowd out interrogation depth.
- Never conclude because "enough questions" were asked; conclude only when the core design is decision-ready or the unresolved blockers are explicit.
- Never breadth-scan every topic with shallow questions when one branch is still underspecified.
- Never ask soft preference questions when the real issue is risk, tradeoff, ownership, evidence, or irreversibility.
- Never accept vague language such as `simple`, `robust`, `secure`, `scalable`, `later`, or `MVP` without forcing specificity.
- Never let "we will figure it out later" pass unless later has an owner, a trigger, and an acceptable risk.
- Never recommend an answer without pressure-testing what it costs and what could falsify it.
- Never ask a clarification question from memory and promise yourself you will log it later.
- Never ask a question in plain chat text instead of `ask_user`.
- Never turn the user's raw acknowledgement into the final planning answer. Convert it into the confirmed decision first, while preserving the raw reply separately.
- Never rewrite earlier answers in place to reflect a changed decision. Capture reversals as new follow-up questions.
- Never end the grilling session without writing the planning-ready outcome file.
- Never leave a transcript marked `active` after successful finalization.
- Never write files other than the transcript and the outcome, and never run git commands that change repository state.
