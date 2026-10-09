// Course answer-key lock regression tests. Run: node tools/run_course_lock_tests.js
// Guards the class/course answer key for locked Question Sets (§12b).
// - locked 80-question key passes against data/
// - reverting Q1 to index 0 fails the canonical validator
// - flipping any other locked correct index fails the validator
// - stable IDs unchanged (lock keys == data IDs, exactly)
// - no duplicate/missing lock entries
// - normal unlocked-set workflow still works (importer smoke test)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

const DATA_FILE = 'data/luat-kdbds-2023.json';
const LOCK_FILE = 'tools/fixtures/kdbds-2023-course-answer-key.json';
const Q1_ID = 'bd9eb282-4418-43d3-a849-08ec9b1f1cdb';

const doc = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));

function runValidator() {
  const r = spawnSync('python', ['tools/validate_questions.py'], { encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ---------- 1. lock shape ----------
{
  t('lock targets kdbds-2023', lock.question_set_id === 'kdbds-2023');
  t('lock names the course source', typeof lock.source === 'string' && lock.source.length > 0);
  t('lock has exactly 80 entries', lock.answers && Object.keys(lock.answers).length === 80);
  t('lock values are all 0-3', Object.values(lock.answers).every(v => v === 0 || v === 1 || v === 2 || v === 3));
  t('no PII in lock (no email/name keys)', !/email|name|student|user/i.test(JSON.stringify(lock).slice(0, 500).replace(/"answers".*/, '')));
}

// ---------- 2. lock <-> data agreement (the passing state) ----------
{
  const byId = {};
  doc.questions.forEach(q => { byId[q.id] = q.correct; });
  const dataIds = Object.keys(byId).sort();
  const lockIds = Object.keys(lock.answers).sort();
  t('all 80 lock entries correspond to real questions', lockIds.every(id => id in byId));
  t('no missing lock entries (data IDs all locked)', dataIds.every(id => id in lock.answers));
  t('no extra lock entries (lock keys == data IDs exactly)',
    dataIds.length === lockIds.length && dataIds.every((id, i) => id === lockIds[i]));
  t('stable IDs: 80 unique, Q1 UUID present',
    new Set(dataIds).size === 80 && dataIds.indexOf(Q1_ID) >= 0);
  const mism = lockIds.filter(id => byId[id] !== lock.answers[id]);
  t('locked 80-question answer key passes (0 mismatches)', mism.length === 0);
  t('Q1 locked at course index 1 (01/08/2024)', lock.answers[Q1_ID] === 1 && byId[Q1_ID] === 1);
}

// ---------- 3. validator enforces the lock (mutate -> fail -> restore) ----------
function withMutatedData(mut, fn) {
  const orig = fs.readFileSync(DATA_FILE, 'utf8');
  const d = JSON.parse(orig);
  mut(d);
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2) + '\n', 'utf8');
  try {
    return fn();
  } finally {
    fs.writeFileSync(DATA_FILE, orig, 'utf8');
  }
}
{
  const r = runValidator();
  t('validator passes on the corrected key', r.status === 0 && /OK/.test(r.out));
}
{
  const r = withMutatedData(d => { d.questions[0].correct = 0; }, runValidator);
  t('Q1 reverted to 0 fails validation', r.status !== 0);
  t('Q1 failure names the lock + question', /COURSE ANSWER LOCK FAILED/.test(r.out) && r.out.indexOf(Q1_ID) >= 0);
  t('Q1 failure shows expected 1 vs actual 0', /expected correct index: 1/.test(r.out) && /actual correct index: 0/.test(r.out));
}
{
  const other = doc.questions[1].id;
  const flipped = (doc.questions[1].correct + 1) % 4;
  const r = withMutatedData(d => { d.questions[1].correct = flipped; }, runValidator);
  t('any other locked index change fails validation', r.status !== 0);
  t('other-question failure names that question', /COURSE ANSWER LOCK FAILED/.test(r.out) && r.out.indexOf(other) >= 0);
}
{
  // restore check: the file must be byte-identical after the mutation tests
  const after = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  t('data file restored after mutation tests (Q1 still 1)', after.questions[0].correct === 1);
  const r = runValidator();
  t('validator green again after restore', r.status === 0);
}

// ---------- 4. normal unlocked-set workflow unaffected ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-test-'));
  const inp = path.join(tmp, 'in.txt');
  const out = path.join(tmp, 'out.json');
  fs.writeFileSync(inp, 'Câu 1: Hỏi gì?\nA. một\nB. hai\nC. ba\nD. bốn\nĐáp án: A\n', 'utf8');
  const r = spawnSync('python', ['tools/import_questions.py', '--slug', 'zz-unlocked', '--title', 'ZZ', inp, '-o', out], { encoding: 'utf8' });
  let okDoc = null;
  try { okDoc = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
  t('unlocked new-set import still works', r.status === 0 && okDoc && okDoc.questions.length === 1);
  t('unlocked set untouched by course lock', okDoc && okDoc.id === 'zz-unlocked');
}

// ---------- 5. second locked set: chuyen-de-4-7-9-10 (111 questions) ----------
{
  const DATA2 = 'data/chuyen-de-4-7-9-10.json';
  const LOCK2 = 'tools/fixtures/chuyen-de-4-7-9-10-course-answer-key.json';
  const doc2 = JSON.parse(fs.readFileSync(DATA2, 'utf8'));
  const lock2 = JSON.parse(fs.readFileSync(LOCK2, 'utf8'));
  t('new lock targets chuyen-de-4-7-9-10', lock2.question_set_id === 'chuyen-de-4-7-9-10');
  t('new lock names the course source', typeof lock2.source === 'string' && lock2.source.length > 0);
  t('new lock has exactly 111 entries', lock2.answers && Object.keys(lock2.answers).length === 111);
  t('new lock values are all 0-3', Object.values(lock2.answers).every(v => v === 0 || v === 1 || v === 2 || v === 3));
  t('new set has 111 questions', doc2.questions.length === 111);
  t('new set every question has 4 options + 1 index 0-3',
    doc2.questions.every(q => Array.isArray(q.options) && q.options.length === 4 && q.correct >= 0 && q.correct <= 3));
  const byId2 = {};
  doc2.questions.forEach(q => { byId2[q.id] = q.correct; });
  const dataIds2 = Object.keys(byId2).sort();
  const lockIds2 = Object.keys(lock2.answers).sort();
  t('new lock keys == new data IDs exactly (111/111)',
    dataIds2.length === 111 && lockIds2.length === 111 && dataIds2.every((id, i) => id === lockIds2[i]));
  t('new locked answer key passes (0 mismatches)', lockIds2.every(id => byId2[id] === lock2.answers[id]));
  t('new IDs do not collide with old set', doc2.questions.every(q => !(q.id in byId0())));
  function byId0() {
    const m = {};
    doc.questions.forEach(q => { m[q.id] = 1; });
    return m;
  }
  const dist = [0, 0, 0, 0];
  doc2.questions.forEach(q => { dist[q.correct]++; });
  t('new answer distribution is course-extracted 14/39/39/19',
    dist[0] === 14 && dist[1] === 39 && dist[2] === 39 && dist[3] === 19);
  // mutation of the new set must fail the canonical validator, then restore
  const orig2 = fs.readFileSync(DATA2, 'utf8');
  const d2 = JSON.parse(orig2);
  d2.questions[0].correct = (d2.questions[0].correct + 1) % 4;
  fs.writeFileSync(DATA2, JSON.stringify(d2, null, 2) + '\n', 'utf8');
  let r2;
  try {
    r2 = runValidator();
  } finally {
    fs.writeFileSync(DATA2, orig2, 'utf8');
  }
  t('new-set index change fails validation', r2.status !== 0);
  t('new-set failure is a course-lock failure naming the question',
    /COURSE ANSWER LOCK FAILED/.test(r2.out) && r2.out.indexOf(doc2.questions[0].id) >= 0);
  const r3 = runValidator();
  t('validator green after new-set restore (2 sets, 191 questions)', r3.status === 0 && /2 set\(s\), 191 question\(s\)/.test(r3.out));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
