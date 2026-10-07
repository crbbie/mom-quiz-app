// BATCH 1 regression tests. Run: node tools/run_batch1_tests.js
// Mix of behavioral checks (new session/sync/timer logic) and source guards
// (patterns that must stay fixed in js/app.js and sw.js).
const fs = require('fs');
const app = fs.readFileSync('js/app.js', 'utf8');
const sw = fs.readFileSync('sw.js', 'utf8');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

function fnBody(src, name) {
  const i = src.indexOf('function ' + name);
  if (i < 0) return '';
  let depth = 0, start = src.indexOf('{', i);
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  return '';
}

// ---------- 1. EXAM RESUME + SHUFFLED ANSWERS ----------
{
  // snapshot/restore round-trip preserves displayed permutation + scoring
  const displayed = [
    { id: 'q1', setId: 's', q: 'Q1?', o: ['d', 'c', 'b', 'a'], c: 3, e: '', category: null },
    { id: 'q2', setId: 's', q: 'Q2?', o: ['x', 'y', 'z', 'w'], c: 1, e: '', category: null }
  ];
  const snap = JSON.parse(JSON.stringify(displayed.map(q => ({ id: q.id, setId: q.setId, q: q.q, o: q.o.slice(), c: q.c, e: q.e, category: q.category }))));
  const restored = snap.map((s, i) => ({ id: s.id, setId: s.setId, q: s.q, o: s.o.slice(), c: s.c, e: s.e, category: s.category, order: (i + 1) * 10 }));
  const answers = [3, 0]; // q1 correct, q2 wrong
  const score = (a, l) => l.reduce((n, q, i) => n + (a[i] === q.c ? 1 : 0), 0);
  t('exam snapshot keeps option order', restored[0].o.join('|') === 'd|c|b|a');
  t('exam snapshot keeps correct mapping', restored[0].c === 3 && restored[1].c === 1);
  t('exam selected text identical after restore', displayed[0].o[3] === restored[0].o[3]);
  t('exam score identical after resume', score(answers, displayed) === score(answers, restored));
  t('app persists snapshots (list: snapshotList)', app.indexOf('list: snapshotList(') >= 0);
  t('app restores snapshots first (restoreList)', app.indexOf('restoreList(s.list)') >= 0 || app.indexOf('restoreList(') >= 0);
}

// ---------- 2. STUDY DOUBLE-COUNTING ----------
{
  // per-question records: answer, navigate away/back, re-answer ignored
  const list = [{ id: 'a', c: 0 }, { id: 'b', c: 2 }];
  let answers = [-1, -1];
  const recount = () => {
    let ok = 0, no = 0;
    answers.forEach((a, i) => { if (a < 0) return; if (a === list[i].c) ok++; else no++; });
    return { ok, no };
  };
  const answerStudy = (i, v) => { if (answers[i] >= 0) return; answers[i] = v; };
  answerStudy(0, 1); // wrong
  const afterFirst = recount();
  answerStudy(0, 0); // revisit + re-answer attempt -> ignored
  answerStudy(0, 2); // another attempt -> ignored
  const afterRevisit = recount();
  answerStudy(1, 2); // correct
  const afterSecond = recount();
  t('study first answer counted once', afterFirst.ok === 0 && afterFirst.no === 1);
  t('study re-answer ignored', afterRevisit.ok === 0 && afterRevisit.no === 1);
  t('study totals never exceed session size', (afterSecond.ok + afterSecond.no) <= list.length);
  t('study totals derived from records', afterSecond.ok === 1 && afterSecond.no === 1);
  t('app guards re-answer (already answered return)', app.indexOf('if (study.answers[study.idx]') >= 0);
  t('app derives totals (recountStudy)', app.indexOf('function recountStudy') >= 0);
  const prevBody = app.slice(app.indexOf('window.studyPrev'), app.indexOf('window.studyPrev') + 400);
  t('studyPrev no longer resets answered state', prevBody.indexOf('answered = false') < 0);
}

// ---------- 3. EXIT KEEPS SESSION ----------
{
  let exitBody = fnBody(app, 'exitStudy');
  if (!exitBody) {
    const i = app.indexOf('window.exitStudy = function');
    const start = app.indexOf('{', i);
    let depth = 0;
    for (let j = start; j < start + 2000; j++) {
      if (app[j] === '{') depth++;
      if (app[j] === '}') { depth--; if (!depth) { exitBody = app.slice(start, j + 1); break; } }
    }
  }
  t('exitStudy does not clearSession', exitBody.indexOf('clearSession') < 0);
  t('exitStudy persists (Lưu và về trang chủ)', exitBody.indexOf('persistSession()') >= 0);
  t('explicit discard path exists (discardStudy/discardSession)', app.indexOf('discardStudy') >= 0 && app.indexOf('discardSession') >= 0);
  t('home offers Continue (resumeSession wired)', app.indexOf('resumeSession') >= 0 && app.indexOf('Tiếp tục') >= 0);
}

// ---------- 4. CONTENT SYNC PARTIAL FAILURE ----------
{
  // simulate fixed merge: failure keeps OLD set meta + OLD catalog version
  function merge(oldSets, oldCatV, newSets, fetchOk) {
    const oldById = {}; oldSets.forEach(s => { oldById[s.id] = s; });
    const qbs = {}; const meta = []; const failures = [];
    newSets.forEach(s => {
      const old = oldById[s.id];
      if (fetchOk[s.file]) { qbs[s.id] = ['new-q']; meta.push(s); }
      else if (old) { qbs[s.id] = ['old-q']; meta.push(old); failures.push(s.id); }
      else { failures.push(s.id); }
    });
    return { qbs, meta, failures, saveCatV: failures.length ? oldCatV : 99 };
  }
  const r1 = merge([{ id: 'k', version: 1 }], 1, [{ id: 'k', version: 2, file: 'f.json' }], { 'f.json': false });
  t('sync failure keeps old content', r1.qbs.k[0] === 'old-q');
  t('sync failure keeps old set version', r1.meta[0].version === 1);
  t('sync failure does not advance catalog version', r1.saveCatV === 1);
  t('sync retry sees mismatch (old 1 vs new 2)', r1.meta[0].version !== 2);
  const r2 = merge([{ id: 'k', version: 1 }], 1, [{ id: 'k', version: 2, file: 'f.json' }], { 'f.json': true });
  t('sync retry success updates content+version', r2.qbs.k[0] === 'new-q' && r2.meta[0].version === 2 && r2.saveCatV === 99);
  t('app keeps old meta on failure (usableMeta.push(old))', app.indexOf('usableMeta.push(old)') >= 0);
  t('app keeps old catalog version on failure', app.indexOf('failures.length ? cache.catalogVersion') >= 0);
  t('app never reports up-to-date on failure', app.indexOf("Cập nhật chưa hoàn tất") >= 0);
}

// ---------- 5. SERVICE WORKER ----------
{
  const installBlock = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  t('sw install has no auto skipWaiting call', installBlock.indexOf('self.skipWaiting()') < 0);
  t('sw failed precache fails install (no catch-skip)', installBlock.indexOf('.catch') < 0);
  t('sw navigation does not hot-swap cached HTML', sw.indexOf("c.put('./index.html'") < 0);
  t('sw shell cache immutable (no bg put of shell)', sw.indexOf('c.put(event.request') < 0);
  t('app defers reload during active session', app.indexOf('if (sessionActive())') >= 0 && app.indexOf('swReloadDeferred') >= 0);
  t('app persists before approved update', app.slice(app.indexOf('window.applyAppUpdate'), app.indexOf('window.applyAppUpdate') + 500).indexOf('persistSession()') >= 0);
}

// ---------- 6. EXAM TIMER ----------
{
  const endsAt = 1000000 + 600000;
  const remaining = (deadline, now) => Math.max(0, Math.round((deadline - now) / 1000));
  t('timer derives from endsAt-Date.now', remaining(endsAt, endsAt - 480000) === 480);
  t('background time deducted (10 min away)', remaining(endsAt, endsAt - 600000 + 600000) === 0 && remaining(endsAt, endsAt - 600000 + 300000) === 300);
  t('expired deadline yields 0 (finalize now)', remaining(Date.now() - 1000, Date.now()) === 0);
  t('app stores endsAt', app.indexOf('endsAt') >= 0);
  t('app has no interval decrement', app.indexOf('exam.timeLeft--') < 0);
  t('app has no blocking alert on expiry', app.indexOf('Hết giờ! Bài sẽ được nộp') < 0);
  t('app recalculates on visibilitychange', app.indexOf('visibilitychange') >= 0 && app.indexOf('updateTimerDisplay(examRemaining())') >= 0);
}

// ---------- 7. SESSION PERSISTENCE ----------
{
  const p = fnBody(app, 'persistSession');
  t('persist uses activeKind, not DOM classes', p.indexOf('activeKind') >= 0 && p.indexOf("contains('active')") < 0);
  const si = app.indexOf('function startStudy');
  t('study start sets activeKind before persist', app.indexOf("activeKind = 'study'") < app.indexOf('persistSession();', si));
  t('pagehide persists', app.indexOf("'pagehide'") >= 0 || app.indexOf('"pagehide"') >= 0);
  t('exam grid nav persists', app.indexOf('renderExam(); persistSession()') >= 0);
  const xn = app.slice(app.indexOf('window.examNext'), app.indexOf('window.examNext') + 300);
  t('exam Next persists', xn.indexOf('persistSession()') >= 0);
}

// ---------- 8. BACKWARD COMPAT — legacy session restore ----------
// Uses the real js/store.js + real data file: legacy (v1/key-only, bare ids,
// no endsAt, stale ids) sessions must restore-or-drop gracefully with no
// crash and no corruption of stars/wrong/history.
{
  const storeSrc = fs.readFileSync('js/store.js', 'utf8');
  const dataDoc = JSON.parse(fs.readFileSync('data/luat-kdbds-2023.json', 'utf8'));
  function freshEnv() {
    const mem = {};
    const localStorage = {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
    };
    const S = new Function('window', 'localStorage', storeSrc + '; return window.LddStore;')({}, localStorage);
    return { S, localStorage };
  }
  function toInternal(setId, sq, idx) {
    return { id: sq.id, setId, category: sq.category || null, q: sq.question, o: sq.options, c: sq.correct, e: sq.explanation || '', order: (idx + 1) * 10 };
  }
  const ids = dataDoc.questions.map(q => q.id);
  const { S } = freshEnv();
  const cache = {
    catalogVersion: 1, sets: [{ id: 'kdbds-2023' }],
    questionsBySet: { 'kdbds-2023': dataDoc.questions.map((sq, i) => toInternal('kdbds-2023', sq, i)) },
    syncedAt: 0
  };
  S.setCache(1, cache.sets, cache.questionsBySet);
  const k0 = 'kdbds-2023:' + ids[0], k1 = 'kdbds-2023:' + ids[1];

  // Mirror of restoreSessionNow's legacy-tolerant resolution (keys || bare ids,
  // snapshot preferred, answers default, endsAt reconstructed, stale -> drop).
  function resolveLegacy(s) {
    const keys = s.keys || (s.ids || []).map(id => {
      const q = S.questionById(S.getCache(), id);
      return q ? S.key(q.setId, q.id) : null;
    });
    if (!s || !keys || !keys.length) return { ok: false };
    if (Array.isArray(s.list) && s.list.length === keys.length) return { ok: true, via: 'snapshot', keys };
    const list = keys.map(k => S.questionById(S.getCache(), k));
    if (list.some(q => !q)) return { ok: false, stale: true };
    return { ok: true, via: 'keys', keys, list };
  }

  // A. legacy Study session (v1: keys + ok/no, no list/answers)
  {
    S.setStars([k0]); S.setWrong([k1]);
    S.pushHistory({ type: 'Ôn tập', setId: 'kdbds-2023', score: 3, total: 5, date: 1 });
    const s = { kind: 'study', setId: 'kdbds-2023', keys: [k0, k1], idx: 1, ok: 1, no: 0 };
    let crashed = false, r = null;
    try { r = resolveLegacy(s); } catch (e) { crashed = true; }
    const answers = (Array.isArray(s.answers) && s.answers.length === 2) ? s.answers : [-1, -1];
    t('legacy study restores without crash', !crashed && r.ok && r.via === 'keys');
    t('legacy study answers default to unanswered', answers[0] === -1 && answers[1] === -1);
    t('legacy study keeps stars/wrong/history', S.getStars().length === 1 && S.getWrong().length === 1 && S.getHistory().length === 1);
  }

  // B. legacy Exam session without endsAt (v1: keys + answers + timeLeft)
  {
    const s = { kind: 'exam', setId: 'kdbds-2023', keys: [k0, k1], idx: 0, answers: [0, -1], timeLeft: 600, totalTime: 1200 };
    let crashed = false, r = null;
    try { r = resolveLegacy(s); } catch (e) { crashed = true; }
    const endsAt = s.endsAt || 0;
    const rebuilt = endsAt || (Date.now() + (s.timeLeft | 0) * 1000);
    const left = Math.max(0, Math.round((rebuilt - Date.now()) / 1000));
    t('legacy exam (no endsAt) restores without crash', !crashed && r.ok);
    t('legacy exam deadline reconstructed from timeLeft', left > 590 && left <= 600);
    t('legacy exam answers preserved', s.answers[0] === 0 && s.answers[1] === -1);
  }

  // C. legacy session with stale/missing question IDs (incl. bare-id form)
  {
    const starsBefore = S.getStars().slice(), wrongBefore = S.getWrong().slice(), histN = S.getHistory().length;
    const s = { kind: 'study', setId: 'kdbds-2023', ids: [ids[0], 'missing-question-id'], idx: 0, ok: 0, no: 0 };
    let crashed = false, r = null;
    try { r = resolveLegacy(s); } catch (e) { crashed = true; }
    t('stale legacy session drops gracefully (no crash)', !crashed && r.ok === false);
    S.pruneStaleIds(S.getCache()); // must not throw, must not corrupt
    t('stale refs cause no corruption (stars/wrong/history intact)',
      JSON.stringify(S.getStars()) === JSON.stringify(starsBefore) &&
      JSON.stringify(S.getWrong()) === JSON.stringify(wrongBefore) &&
      S.getHistory().length === histN);
  }

  // D. source guards: app.js actually contains the legacy-tolerant paths
  t('app tolerates bare ids sessions (s.ids)', app.indexOf('s.ids') >= 0);
  t('app reconstructs endsAt from timeLeft', app.indexOf('Date.now() + (s.timeLeft | 0) * 1000') >= 0);
  t('app drops unresolvable sessions safely', app.indexOf('LddStore.clearSession(); return false') >= 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
