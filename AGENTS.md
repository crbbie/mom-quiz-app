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
