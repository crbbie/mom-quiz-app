# AGENTS.md — repository instructions for coding agents

This repository is a **static-data quiz PWA** (installable iPhone study app).
There is no backend, no database, no login, no admin UI, no build step.

- Question content lives in `data/*.json` (one file per Question Set).
- `data/catalog.json` is the authoritative question-set index.
- When the user provides ANY unfamiliar file containing exam questions,
  answers, explanations, or study material, read
  `QUESTION-IMPORT-GUIDE.md` **before** modifying data.
- Never hardcode new questions into `index.html` or app JavaScript.
- Never regenerate IDs for existing logical questions.
- Never use array index as question identity.
- Never silently rewrite source question wording, correct answers, or
  explanations — flag ambiguity instead.
- Run the canonical validator (`python tools/validate_questions.py`, must
  print `OK`) before committing/deploying. Do not deploy unless asked.

`QUESTION-IMPORT-GUIDE.md is the canonical source of truth for question-bank imports and updates.`

## Course source of truth (permanent rule)

The original class/course question material is authoritative for this app.
External sources (websites, current legislation, AI knowledge) must never be
used to silently modify question wording, answer options, the marked correct
answer, or explanations. If outside information appears to contradict a
course question: preserve the course source exactly, mention the discrepancy
separately, and only change that question with explicit user authorization.

# COURSE ANSWER-KEY LOCK (permanent rule)

For course-backed Question Sets, the source/course answer key is immutable
unless the user explicitly authorizes a specific answer-key change.

Agents MUST NOT change `correct` answers because:

- legislation changed
- an external website disagrees
- web search gives another answer
- AI believes another answer is more accurate
- an answer appears outdated

External factual correctness is NOT the authority for these study sets.

The course/source key is authoritative.

If an external discrepancy is noticed:

1. Do not modify the answer.
2. Report it separately if relevant.
3. Preserve the course key.
4. Only change it after explicit user authorization.

When a machine-readable course answer lock exists
(`tools/fixtures/*-course-answer-key.json`), it must pass before
commit/deploy: `python tools/validate_questions.py` enforces the lock
mechanically and fails with `COURSE ANSWER LOCK FAILED` on any mismatch.

Question wording/options/explanations from course material must not be
silently rewritten or modernized.
