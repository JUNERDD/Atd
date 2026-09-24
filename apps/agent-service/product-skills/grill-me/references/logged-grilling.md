# Logged Grilling Reference

Use this reference for the exact transcript and outcome formats, and for recovery steps. All paths are relative to the task folder. Keep the files with `read`, `write`, `edit`, and `grep`.

## Table of contents

- File naming
- Transcript format
- Question logging
- Answer backfill
- Finalization
- Outcome format
- Planning seed buckets
- Current transcript
- Recovery
- Repair

## File naming

- A path the user gives wins.
- Grilling for a plan: use the plan's file name. For the plan `plans/2026-01-15-export-csv.md`, the transcript is `plans/grill-me/session-2026-01-15-export-csv.md` and the outcome is `plans/grill-me/outcome-2026-01-15-export-csv.md`.
- Standalone: `plans/grill-me/session-<YYYY-MM-DD>-<slug>.md`, where the slug is the topic in lowercase with every run of other characters replaced by `-`. The app gives you no clock. Use a date the conversation shows, or run `date +%F` once through `bash` (no side effects; the user may be asked to allow it). Without a date, leave out the date part.
- If the name is taken by another session, add `-2`, `-3`, and so on. The outcome takes the transcript's name with `session-` replaced by `outcome-`, plus the next free suffix if that name is taken.
- `write` creates `plans/grill-me/` when it is missing.

## Transcript format

Create the transcript with `write` just before logging the first question:

```text
# Grill Me Session

- Created: 2026-01-15
- Log file: plans/grill-me/session-2026-01-15-export-csv.md
- Plan: plans/2026-01-15-export-csv.md
- Status: active

## Questions

```

- `Created` holds the date, or `not recorded`.
- Include the `Plan` line only when grilling for a plan file.
- The header is the list above the `## Questions` heading. Every header line has the form `- Key: value`.

Every text block in an entry is a Markdown quote: each line is prefixed with `> `, and an empty line becomes a lone `>`. An empty question or recommendation is written as `> _No question recorded._` or `> _No recommendation recorded._`.

## Question logging

Before sending a question to the user:

1. `read` the transcript. Confirm that it contains no `<<PENDING_ANSWER_` marker; if it does, backfill that answer first.
2. The next number is the highest `## Question <n>` plus one, or 1 for the first question.
3. Append the entry. Use `write` with the full current content plus the new entry, and never drop earlier content:

```text
## Question 1

Question:
> What is the single failure mode this design must prevent?

Recommendation:
> Name the one failure that would make the design unacceptable.

Answer:
<<PENDING_ANSWER_1>>
```

4. Only after the write succeeds, call `ask_user` with the same question and the recommendation in the `question` text, for example `{"question": "What is the single failure mode this design must prevent?\n\nRecommendation: silent data loss; the design must favor visible retries and operator-friendly diagnostics."}`. Add `options` only for a few discrete answers, with the recommendation first.

## Answer backfill

As soon as `ask_user` returns, `edit` the transcript and replace the pending marker, which is unique, with the resolved answer and the raw reply:

```text
Answer:
> Silent data loss is unacceptable, and the design must prioritize visible retry behavior and operator-friendly diagnostics.

Raw user answer:
> yes, that one
```

That is, `oldText` is `<<PENDING_ANSWER_1>>` and `newText` is the resolved-answer quote, a blank line, `Raw user answer:`, and the raw-answer quote.

- The `Answer` block holds the standalone confirmed conclusion (see Answer Normalization in SKILL.md). If the user accepts the recommendation with `yes`, `按推荐来`, or similar, the resolved answer is the recommendation itself, not the acknowledgement.
- The `Raw user answer` block holds the exact reply, line by line. A multi-line reply keeps its lines:

```text
Raw user answer:
> The core requirement is:
> - no silent data loss
> - visible retry behavior
> - operator-friendly diagnostics
```

- A skipped question (`The user cancelled the request.`) is backfilled with `> Not decided: the user skipped this question.` and `> _Skipped by the user._`.

Do not analyze the answer or ask a follow-up question until this edit succeeds.

## Finalization

When the grilling pass is complete:

1. `read` the transcript. Finalization requires no `<<PENDING_ANSWER_` marker and at least one answered question; otherwise backfill or keep grilling first.
2. `write` the outcome file (format below) next to the transcript.
3. `edit` the transcript header: replace `- Status: active` with these lines:

```text
- Status: finalized
- Finalized: 2026-01-15
- Outcome file: plans/grill-me/outcome-2026-01-15-export-csv.md
```

4. Report both paths to the user. When grilling for a plan, also write them into the plan's `Grill-Me Outcome` section with a one-line summary.

The raw transcript remains the full audit record: the question-time recommendation and the exact turn-by-turn exchange. The outcome stays compact and must not require reopening the transcript to interpret answers like `按推荐来`, `yes`, or `OK`. Those belong only in `Raw user answer`.

## Outcome format

```text
# Grill Me Outcome

- Source transcript: plans/grill-me/session-2026-01-15-export-csv.md
- Confirmed questions: 3

## Planning Seeds

### Goals

- Q1: Export must reproduce every visible task field so users can audit work outside the app.
  Source question: What outcome makes this export worth shipping?

### Risks

- Q2: Silent data loss is unacceptable, and the design must prioritize visible retry behavior and operator-friendly diagnostics.
  Source question: What is the single failure mode this design must prevent?

## Confirmed Q&A

### Q1. What outcome makes this export worth shipping?

Resolved answer:
> Export must reproduce every visible task field so users can audit work outside the app.

### Q2. What is the single failure mode this design must prevent?

Resolved answer:
> Silent data loss is unacceptable, and the design must prioritize visible retry behavior and operator-friendly diagnostics.

Raw user answer:
> yes, that one
```

Rules:

- `Confirmed questions` counts the answered entries.
- Planning seeds: one line per answered question, under its bucket. The line is `- Q<n>: <resolved answer>`, with whitespace collapsed to single spaces and cut to at most 160 characters (159 characters plus `…` when longer). The next line is `  Source question: <question on one line>`.
- Print only buckets that have entries, in this order: Goals, Scope Boundaries, Assumptions and Evidence, Constraints, Risks, Decisions and Alternatives, Operations and Delivery, Uncategorized Planning Seeds.
- Confirmed Q&A: every answered question once, in order. The heading is `### Q<n>. <question on one line>`, followed by the resolved answer as a quote. Add `Raw user answer:` with its quote only when the raw reply differs from the resolved answer after collapsing whitespace.
- `Uncategorized Planning Seeds` is a fallback bucket for confirmed answers that match no more specific category. It is not a second Q&A log; every confirmed answer still appears once in `Confirmed Q&A`.

## Planning seed buckets

Assign each question to one bucket by its question text. Check the buckets in this order and take the first one whose hints match; the hints are case-insensitive substrings.

1. Goals: goal, objective, success, outcome, purpose, problem, 目标, 价值, 成败, 成功, 解决.
2. Scope Boundaries: scope, non-goal, out of scope, defer, phase, 范围, 不做, 延后, 阶段.
3. Assumptions and Evidence: assumption, assume, evidence, prove, validate, unknown, uncertain, hypothesis, 假设, 证据, 验证, 未知, 不确定, 验收.
4. Risks: risk, failure, prevent, danger, concern, edge case, abuse, threat, 风险, 失败, 错误, 底线, 不能.
5. Decisions and Alternatives: choose, decision, prefer, trade-off, tradeoff, approach, architecture, design, alternative, option, 选择, 决策, 取舍, 方案, 支持, 入口, 路径, 主界面, 功能.
6. Operations and Delivery: owner, stakeholder, operator, rollout, rollback, migrate, migration, monitor, alert, test, verify, deploy, 上线, 发布, 回滚, 监控, 测试, 反馈, 删除, 登录, 注册, 数据.
7. Constraints: constraint, limit, budget, deadline, cannot, requirement, latency, throughput, compatibility, compliance, 约束, 限制, 预算, 期限, 必须, 最低, 合规.
8. Otherwise: Uncategorized Planning Seeds.

## Current transcript

The active transcript is the session file in `plans/grill-me/` whose header says `- Status: active`. Keep using it for the whole session.

## Recovery

When you lose track of the transcript, for example after a long pause or a compaction:

1. `grep` with pattern `- Status: active`, `literal: true`, path `plans/grill-me`, and glob `session-*.md` to list the active transcripts. `grep` respects the folder's ignore files, so if it finds nothing, `ls plans/grill-me` and `read` the session files' headers instead.
2. Pick the one for the current plan or topic (its `Plan` line or file name). If several fit and the choice matters, ask the user.
3. `read` it. If it has a `<<PENDING_ANSWER_<n>>>` marker and the user has already answered that question in the conversation, backfill that answer before anything else.

## Repair

Use these only when the normal flow cannot continue:

- The transcript is missing or unreadable: create a replacement transcript with the next free name, re-log the pending question if there is one, and tell the user which file replaced which.
- A malformed entry: fix only that entry's structure with `edit`. Keep its recorded question, recommendation, and answers unchanged.
- Never rewrite an earlier answer to reflect a changed decision. Capture the reversal as a new follow-up question.
