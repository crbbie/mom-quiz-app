# Ôn thi PWA — static multi-set quiz app (no backend)

Installable iPhone PWA for studying multiple-choice exam questions.
Fully static: question content ships as JSON files with the deploy.
No database, no login, no admin UI, no secrets, no build step.

## Architecture

```
data/catalog.json ──► data/<set>.json ──► deploy ──► installed PWA syncs
```

- **Content source:** `data/catalog.json` (authoritative set list) + one
  `data/<slug>.json` per question set. Added/edited in the repo, deployed
  with the site. The app never hardcodes sets — Home renders whatever the
  catalog lists with `published: true`.
- **Learner:** `index.html` + `css/styles.css` + `js/store.js` + `js/app.js`.
  Vanilla JS, Vietnamese UI, large touch targets, safe-area support.
- **Personal data (device-local, localStorage):** stars, wrong answers,
  history, prefs, unfinished session — all keyed by composite
  `"setId:questionId"`, never by array position. Reorder/add/remove cannot
  corrupt progress; refs to deleted questions are ignored (history snapshots
  are kept).
- **Content update:** on launch the app renders its local cache immediately,
  then fetches `data/catalog.json?v=<timestamp>` network-first, compares
  catalog + per-set versions, downloads only changed/new set files, updates
  the cache, and toasts `Đã cập nhật dữ liệu mới`. An active study/exam
  session is never interrupted — it keeps its in-memory questions; new
  content applies to future sessions. Manual fallback: `Cập nhật dữ liệu`
  button + auto re-check on `online`.
- **Offline:** downloaded sets work fully offline (study, exam, wrong, stars,
  history, session restore). First launch ever needs network once; otherwise
  a clear Vietnamese message is shown instead of a crash.
- **Cache split (sw.js):** app shell (HTML/CSS/JS/icons) = versioned
  cache-first (`APP_VERSION`, bump per code deploy → `Có phiên bản mới
  [Cập nhật]` banner); `data/*.json` = network-first with cached fallback,
  keyed without the query string so freshness probes always reach the
  network. Content-only deploys update silently without the banner.

## File tree

```
index.html                  learner app (only page)
css/styles.css              all styles
js/store.js                 localStorage: content cache + composite-key progress + migrations
js/app.js                   study/exam/search/history/sync/session-restore/SW-update flow
manifest.webmanifest        PWA manifest
sw.js                       service worker (APP_VERSION + split shell/data caches)
icons/                      icon-192/512 + apple-touch-icon
data/catalog.json           THE set list (version + per-set version/file/published)
data/luat-kdbds-2023.json   set 1: 80 questions, stable UUIDs
tools/validate_questions.py catalog + set validation (run before every deploy)
tools/run_store_tests.js  Node regression tests: migrations, reorder/remove survival
                          (`node tools/run_store_tests.js` — 14 checks)
tools/import_questions.py   dev converter: paste-format text -> set JSON for review
tools/gen_icons.py          regenerate placeholder icons
```

## JSON schemas

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
  "version": 1,
  "updated_at": "2026-10-07",
  "questions": [
    {
      "id": "bd9eb282-4418-43d3-a849-08ec9b1f1cdb",
      "question": "Luật Kinh doanh bất động sản 2023 có hiệu lực…?",
      "options": ["01/01/2025", "01/08/2024", "28/11/2023", "01/01/2015"],
      "correct": 0,
      "explanation": "Luật KDBĐS 2023 … hiệu lực từ 01/01/2025.",
      "category": "Tổng quan"
    }
  ]
}
```

Rules: question `id` is mandatory, globally unique, permanent. Exactly 4
non-empty `options`. `correct` is 0–3. `category`/`explanation`/`description`
are optional. Set-file `id` + `version` must match the catalog entry.
`published: false` hides a set without deleting its file.

## Adding a new Question Set

> For any question-bank import or update, QUESTION-IMPORT-GUIDE.md is the canonical source of truth.

1. Put the source material in the repo (or hand it to the coding agent).
2. Convert it: `python tools/import_questions.py --slug luat-dat-dai --title "…"
   source.txt -o /tmp/review.json` → **review the output**.
3. Save as `data/<slug>.json` (`luat-dat-dai.json`).
4. Validate: `python tools/validate_questions.py` (must print OK).
5. Add the set to `data/catalog.json`; bump catalog `version` (+1) and set
   `updated_at`. New set starts at `version: 1`.
6. Test locally: `npx serve .` (or `python -m http.server`) → open the page,
   confirm the new card appears; also test with devtools offline enabled.
7. Commit and deploy. Done — the installed PWA picks it up on next launch.
   No app-code change needed.

## Updating an existing Question Set

**Critical rule: existing question IDs must NEVER change for the same logical
question. Do NOT regenerate all IDs on update.** Use `--update`:

```
python tools/import_questions.py --slug kdbds-2023 \
  --update data/luat-kdbds-2023.json new-material.txt -o /tmp/review.json
```

This keeps old IDs for matching questions (matched by normalized text) and
mints `<slug>-NNN` IDs only for genuinely new ones. Then: review → replace
the file → bump **both** the set file `version` and the catalog entry
`version` (+1) → validate → test → deploy. Deleting a question is safe
(stale star/wrong refs are ignored, history kept); reordering is safe
(progress is ID-keyed, file order only affects display order).

## Local run / deploy / install

- Run: any static server — `npx serve .` or `python -m http.server 8080`
  (service worker needs http(s), not `file://`).
- Deploy: any static HTTPS host. Code deploys → bump `APP_VERSION` in `sw.js`.
  Content-only deploys → just the `data/` files (+ versions), no SW change.
- iPhone: Safari → Share → **Thêm vào Màn hình chính** → open from the icon.
  New sets appear automatically; never reinstall, never import, never log in.
- Do NOT deploy until explicitly approved.

## Validation

`python tools/validate_questions.py` checks: catalog syntax, integer versions,
unique set IDs, referenced files exist, file↔catalog id+version match, unique
question IDs (per file and global), exactly 4 non-empty options, `correct`
0–3, non-empty question text, malformed JSON. Fails non-zero with
`FILE :: location :: problem` lines.

## Known limitations

- Personal data is per-device (changing phones starts fresh).
- Search is client-side substring over cached questions (cap 100 hits).
- Conflict model is last-deploy-wins via versions; no realtime push.
- Icons are generated placeholders — replace `icons/*` anytime, no code change.
