# Question Import Guide

This file defines the canonical workflow for adding or updating study material in this repository.

Read this document completely whenever a new source file containing questions, answers, explanations, or exam material is provided.

---

# 1. Goal

The learner should never need to:

- reinstall the PWA
- import files manually
- log in
- modify app settings

The content workflow is:

SOURCE FILE
→ parse/convert
→ Question Set JSON
→ validate
→ update catalog
→ test
→ commit/deploy
→ installed PWA detects new content

**Never modify learner-app code (`index.html`, `js/`, `sw.js`,
`manifest.webmanifest`) to add or update questions.** Content changes must
never require app-code changes. The only exception is bumping `APP_VERSION`
in `sw.js`, and only when a deploy actually changes code — never for
content-only changes.

---

# 2. First inspect the source

Before changing repository files, inspect the entire provided source.

Supported source types may include:

- TXT
- Markdown
- DOC/DOCX
- PDF
- JSON
- CSV
- XLS/XLSX
- pasted text
- other readable structured documents

Determine:

- title/topic
- number of questions
- question format
- answer format
- explanations if present
- categories/sections if present
- whether this is a new Question Set or an update to an existing one

Do not assume the file format from its extension alone.

---

# 3. Preserve source content

Treat the source file as authoritative.

Preserve:

- question wording
- answer choices
- correct answer
- explanation
- section/category information when present

Do NOT silently:

- rewrite questions
- improve grammar
- change legal wording
- correct factual content
- invent explanations
- infer missing correct answers

If something appears incorrect or ambiguous, flag it for review instead.

---

# 4. Determine import type

Classify the task as one of:

## A. NEW QUESTION SET

Use when the source represents a new subject/exam.

Create:

`data/<question-set-slug>.json`

Then add the set to:

`data/catalog.json`

---

## B. ADD QUESTIONS TO EXISTING SET

Find the existing Question Set.

Append only genuinely new questions.

Preserve all existing Question IDs.

Do not regenerate the entire file.

---

## C. UPDATE EXISTING QUESTIONS

Match existing questions carefully.

When the same logical question already exists:

KEEP ITS EXISTING ID.

Only update the requested fields.

Never change IDs simply because wording, answer options, explanation, or ordering changed.

---

# 5. Question identity

Every Question Set must have a stable unique ID.

Every question must have a stable unique ID.

Existing sets in this repo use UUIDs (e.g. `bd9eb282-4418-43d3-a849-08ec9b1f1cdb`).
New questions created via the import tool use `<slug>-NNN`
(e.g. `kdbds-001`). Either form is acceptable; what matters is permanence.

IDs are permanent identity, not display order.

Never use array index as identity.

Never renumber all questions merely because one question was inserted or deleted.

Local learner data depends on stable IDs for:

- wrong answers
- stars
- history
- unfinished sessions

---

# 6. Canonical Question Set structure

This is the repository's actual schema — follow it exactly.
Do not invent a parallel schema.

`data/catalog.json`:

```json
{
  "version": 1,
  "updated_at": "2026-10-07",
  "sets": [
    {
      "id": "kdbds-2023",
      "title": "Luật Kinh doanh BĐS 2023",
      "description": "Bộ đề Luật Kinh doanh Bất động sản 2023 — 80 câu.",
      "file": "luat-kdbds-2023.json",
      "version": 1,
      "updated_at": "2026-10-07",
      "published": true
    }
  ]
}
```

`data/<slug>.json`:

```json
{
  "id": "kdbds-2023",
  "title": "Luật Kinh doanh BĐS 2023",
  "description": "Bộ đề Luật Kinh doanh Bất động sản 2023 — 80 câu.",
  "version": 1,
  "updated_at": "2026-10-07",
  "questions": [
    {
      "id": "kdbds-001",
      "question": "...",
      "options": [
        "...",
        "...",
        "...",
        "..."
      ],
      "correct": 0,
      "explanation": "..."
    }
  ]
}
```

Rules: question `id` unique across the whole repo · exactly 4 non-empty
`options` · `correct` is 0–3 · `question` non-empty · set-file `id` and
`version` must match its catalog entry · `description`/`explanation` may be
empty but must be present. (`category` per question is accepted but optional.)

---

# 7. Parsing rules

For common text such as:

```text
Câu 1: Nội dung câu hỏi
A. Đáp án A
B. Đáp án B
C. Đáp án C
D. Đáp án D
Đáp án: B
Giải thích: Nội dung giải thích
```

Convert to the repository schema. Use the repo converter — do not
hand-roll parsing:

```powershell
# New set (fresh <slug>-NNN IDs). Output goes to a REVIEW file, never
# straight into data/:
python tools/import_questions.py --slug <slug> --title "<Tên bộ đề>" nguon.txt -o $env:TEMP/review.json

# Existing set (--update matches by normalized text and KEEPS old IDs;
# only genuinely new questions get fresh IDs):
python tools/import_questions.py --slug <set-id> --update data/<file>.json moi.txt -o $env:TEMP/review.json
```

Correct-answer indexes:

- A → 0
- B → 1
- C → 2
- D → 3

Explanation may be empty only if the source genuinely contains no explanation.

Do not fabricate one.

---

# 8. Malformed questions

Do not silently import malformed content.

The converter reports malformed blocks on stderr (block number + reason +
preview). Every one of them must appear in the final report — never
quietly "fix" a block just to reach 4 options.

Flag questions with problems such as:

- missing question text
- missing correct answer
- fewer/more options than supported
- duplicated answer letters
- invalid answer letter
- ambiguous structure
- broken source extraction
- unreadable content

Report:

- source question number
- reason
- whether it was skipped

Valid questions may continue to be processed.

---

# 9. Duplicate detection

Before adding questions, compare against the destination Question Set.

(The `--update` mode does text-match reporting automatically — read its
`matched existing ids` line. Manual review is still required.)

Check for:

- same existing ID
- exact same question
- normalized same question
- obvious near-duplicate wording

Do not automatically duplicate a question just because its source number differs.

Do not automatically overwrite a possible duplicate either.

A text match whose options/answer differ from the existing question is an
**update (type C)**, not an addition — handle it manually per §4C and say so
in the report.

Report uncertain cases.

---

# 10. Catalog

`data/catalog.json` is the authoritative Question Set index.

For a new Question Set:

- add its entry (`id`, `title`, `description`, `file`, `version: 1`,
  `updated_at`, `published`)
- use a stable ID
- point to the correct JSON file
- mark publication state correctly (`published: false` to stage a set
  without showing it to the learner)
- update relevant version/update metadata (see §11)

Do not hardcode the new set into application JavaScript.

A new set should normally require no learner-app code changes.

---

# 11. Versioning

Repository convention — bump **all three**, every time content changes:

1. `version` + 1 in the set file (`data/<slug>.json`)
2. `version` + 1 in that set's `data/catalog.json` entry (must equal the file)
3. `version` + 1 in `data/catalog.json` itself, plus fresh `updated_at`
   dates (`YYYY-MM-DD`) on the set file and its catalog entry

The validator (§12) rejects file↔catalog version mismatches, so the three
bumps are atomic: one commit, or nothing.

Do not bump the app/service-worker version for content-only changes.
Content updates and application-code updates are separate concepts.

---

# 12. Validation

Run the repository's canonical validation tool before committing:

```powershell
python tools/validate_questions.py
```

It must print `OK: …` and exit 0. It checks, at minimum:

- valid JSON
- referenced Question Set files exist
- unique Question Set IDs
- unique Question IDs (per file and repo-wide)
- correct schema
- non-empty question text
- valid options (exactly 4, non-empty)
- valid correct-answer index
- catalog/set IDs match
- catalog/set versions match

Not checked by the tool (no history to compare against): accidental ID
regeneration. Verify manually via the ID-list diff in §13 — old IDs must
all still be present, only additions allowed.

If validation fails:

DO NOT deploy.

Fix valid mechanical issues or report source-content issues requiring human review.

---

# 13. Regression checks

After content import/update, verify:

- Home loads
- all published Question Sets appear
- question counts are correct
- Study mode opens
- answers work
- explanations appear
- Mock Exam works
- search works
- wrong-question review works
- stars work
- existing saved progress is not reset

Concrete steps:

```powershell
node tools/run_store_tests.js   # expect 14/14 pass (ID preservation, progress survival)
npx serve .                     # or: python -m http.server 8080
```

Then open `http://localhost:8080/`, confirm the new/updated set appears
after sync, spot-check wording against the source, and re-check with
DevTools offline enabled (study/exam/history must work from cache).

For an existing set, explicitly verify that old Question IDs were preserved
(diff the ID list before/after — only additions, never renames).

---

# 14. Adding a completely new Question Set

Expected normal workflow:

1. Inspect source.
2. Parse questions.
3. Report malformed/ambiguous items.
4. Create `data/<slug>.json`.
5. Assign stable IDs to NEW questions.
6. Validate.
7. Add entry to `data/catalog.json`.
8. Increment content version metadata.
9. Run regression tests.
10. Commit.
11. Deploy only if deployment was requested.

---

# 15. Updating an existing Question Set

Expected normal workflow:

1. Locate existing set.
2. Compare source questions with existing questions.
3. Preserve existing IDs.
4. Add IDs only for genuinely new questions.
5. Modify requested content.
6. Do not reorder unnecessarily.
7. Update version metadata.
8. Validate.
9. Regression-test saved-progress compatibility.
10. Commit.
11. Deploy only if requested.

---

# 16. Never do these

Never:

- paste a whole new question bank into `index.html`
- hardcode Question Sets in app JavaScript
- use array position as question identity
- regenerate all Question IDs
- erase stars/wrong/history because content changed
- invent missing answers
- silently correct source content
- deploy malformed content
- modify learner UI merely to add another Question Set
- deploy or commit before the user approves (unless explicitly requested)

---

# 17. Final report format

After processing a source file, report:

## Source
- filename
- detected topic
- detected import type

## Import
- questions found
- questions imported
- questions updated
- duplicates found
- malformed/skipped questions

## Files
- created
- modified
- deleted

## Identity
- existing IDs preserved
- new IDs created

## Validation
- validator result
- question counts
- regression test result

## Content update
- previous version
- new version

## Deployment
- committed: yes/no
- deployed: yes/no
- commit SHA if applicable

Clearly list anything requiring manual review.
