// Importer/tooling tests (Maintenance M9). Run: node tools/run_import_tests.js
// Uses FIXTURE data in a temp dir only — never touches data/*.json.
// Drives tools/import_questions.py as a subprocess + validates output schema.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'import-test-'));
function runImporter(args, stdinText) {
  const inp = path.join(tmp, 'in-' + Math.random().toString(36).slice(2) + '.txt');
  const out = path.join(tmp, 'out-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(inp, stdinText, 'utf8');
  let stderr = '';
  try {
    execFileSync('python', ['tools/import_questions.py', ...args, inp, '-o', out], { encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    stderr = (e.stderr || '').toString();
    return { ok: false, stderr, out: null, doc: null };
  }
  // capture stderr by re-running? execFileSync throws away stderr on success; use spawn instead.
  return { ok: true, stderr, out, doc: JSON.parse(fs.readFileSync(out, 'utf8')) };
}
function runImporterFull(args, stdinText) {
  // variant that captures stderr text on success too
  const inp = path.join(tmp, 'in-' + Math.random().toString(36).slice(2) + '.txt');
  const out = path.join(tmp, 'out-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(inp, stdinText, 'utf8');
  const { spawnSync } = require('child_process');
  const r = spawnSync('python', ['tools/import_questions.py', ...args, inp, '-o', out], { encoding: 'utf8' });
  let doc = null;
  try { doc = JSON.parse(fs.readFileSync(out, 'utf8')); } catch (e) {}
  return { status: r.status, stderr: r.stderr || '', stdout: r.stdout || '', doc, out };
}

// ---------- 1. Vietnamese answer labels ----------
{
  const src = 'Câu 1: Hỏi gì?\nA. một\nB. hai\nC. ba\nD. bốn\nĐáp án: A\n';
  const r = runImporterFull(['--slug', 't1', '--title', 'T1'], src);
  t('Đáp án: A parsed (correct=0)', r.doc && r.doc.questions[0].correct === 0);
  const src2 = 'Câu 1: Hỏi gì?\nA. một\nB. hai\nC. ba\nD. bốn\nĐáp án đúng: B\nGiải thích: vì thế\n';
  const r2 = runImporterFull(['--slug', 't1', '--title', 'T1'], src2);
  t('Đáp án đúng: B parsed (correct=1)', r2.doc && r2.doc.questions[0].correct === 1);
  t('Giải thích: parsed', r2.doc && r2.doc.questions[0].explanation === 'vì thế');
  const src3 = 'Cau 1: Hoi gi?\nA. mot\nB. hai\nC. ba\nD. bon\nDap an: C\nGiai thich: vi the\n';
  const r3 = runImporterFull(['--slug', 't1', '--title', 'T1'], src3);
  t('unaccented Dap an / Giai thich parsed', r3.doc && r3.doc.questions[0].correct === 2 && r3.doc.questions[0].explanation === 'vi the');
}

// ---------- 2. letter identity (reordered options) ----------
{
  const src = 'Câu 1: Hỏi gì?\nB. hai\nA. một\nD. bốn\nC. ba\nĐáp án: B\n';
  const r = runImporterFull(['--slug', 't1', '--title', 'T1'], src);
  const q = r.doc && r.doc.questions[0];
  t('reordered input maps by letter (options A-D order)', q && q.options.join('|') === 'một|hai|ba|bốn');
  t('reordered correct letter resolves (B -> 1)', q && q.correct === 1);
}

// ---------- 3. duplicate / missing / invalid ----------
{
  const dup = 'Câu 1: Hỏi gì?\nA. một\nB. hai\nB. HAI nữa\nD. bốn\nĐáp án: A\n';
  const r = runImporterFull(['--slug', 't1'], dup);
  t('duplicate letter rejected (0 valid, malformed reported)', r.doc && r.doc.questions.length === 0 && /trung dap an/.test(r.stderr));
  const miss = 'Câu 1: Hỏi gì?\nA. một\nB. hai\nC. ba\nĐáp án: A\n';
  const r2 = runImporterFull(['--slug', 't1'], miss);
  t('missing option rejected + reported', r2.doc && r2.doc.questions.length === 0 && /thieu dap an/.test(r2.stderr));
  const bad = 'Câu 1: Hỏi gì?\nA. một\nB. hai\nC. ba\nD. bốn\nĐáp án: E\n';
  const r3 = runImporterFull(['--slug', 't1'], bad);
  t('invalid answer letter rejected + reported', r3.doc && r3.doc.questions.length === 0 && /dap an khong hop le/.test(r3.stderr));
}

// ---------- 4. multiline ----------
{
  const src = 'Câu 1: Hỏi về vấn đề\nrất dài nhiều dòng?\nA. một\nB. hai\nphần hai của B\nC. ba\nD. bốn\nĐáp án: B\nGiải thích: dòng một\ndòng hai\n';
  const r = runImporterFull(['--slug', 't1'], src);
  const q = r.doc && r.doc.questions[0];
  t('multiline question joined', q && q.question === 'Hỏi về vấn đề rất dài nhiều dòng?');
  t('multiline option joined', q && q.options[1] === 'hai phần hai của B');
  t('multiline explanation joined', q && q.explanation === 'dòng một dòng hai');
}

// ---------- 5. malformed reporting ----------
{
  const src = 'Câu 1: ok?\nA. m\nB. h\nC. b\nD. bo\nĐáp án: A\n\nRác không đầu không đuôi\n';
  const r = runImporterFull(['--slug', 't1'], src);
  t('valid block processed despite bad block', r.doc && r.doc.questions.length === 1);
  t('malformed block number+reason+preview on stderr', /block 2/.test(r.stderr) && /\.\.\./.test(r.stderr));
}

// ---------- 6. --update ID preservation ----------
{
  const oldDoc = {
    id: 'ts', title: 'T', description: 'D', version: 3, updated_at: '2026-01-01',
    questions: [
      { id: 'old-id-1', question: 'Hỏi một?', options: ['a', 'b', 'c', 'd'], correct: 0, explanation: '' },
      { id: 'old-id-2', question: 'Hỏi hai?', options: ['a', 'b', 'c', 'd'], correct: 1, explanation: '' }
    ]
  };
  const oldFile = path.join(tmp, 'old.json');
  fs.writeFileSync(oldFile, JSON.stringify(oldDoc), 'utf8');
  const src = 'Câu 1: Hỏi một?\nA. a\nB. b\nC. c\nD. d\nĐáp án: A\n\nCâu 2: Hỏi BA mới?\nA. a\nB. b\nC. c\nD. d\nĐáp án: D\n';
  const r = runImporterFull(['--slug', 'ts', '--update', oldFile], src);
  const ids = (r.doc ? r.doc.questions.map(q => q.id) : []);
  t('existing question keeps old id', ids[0] === 'old-id-1');
  t('new question gets fresh id (ts-NNN)', /^ts-\d+$/.test(ids[1] || '') && ids[1] !== 'old-id-2');
  t('version increments (3 -> 4)', r.doc && r.doc.version === 4);
  t('description carried from old file', r.doc && r.doc.description === 'D');
  // ambiguous: same text, different options/answer
  const srcAmb = 'Câu 1: Hỏi một?\nA. X\nB. b\nC. c\nD. d\nĐáp án: B\n';
  const r2 = runImporterFull(['--slug', 'ts', '--update', oldFile], srcAmb);
  t('ambiguous match keeps old id + warns (not silent)', r2.doc && r2.doc.questions[0].id === 'old-id-1' && /AMBIGUOUS/.test(r2.stderr));
}

// ---------- 7. output schema matches repo ----------
{
  const src = 'Câu 1: Hỏi gì?\nA. m\nB. h\nC. b\nD. bo\nĐáp án: A\n';
  const r = runImporterFull(['--slug', 'nn', '--title', 'Tên', '--description', 'Mô tả'], src);
  const d = r.doc;
  t('schema: id/title/description/version/updated_at/questions', d && ['id', 'title', 'description', 'version', 'updated_at', 'questions'].every(k => k in d));
  t('schema: question id/question/options/correct/explanation', d && ['id', 'question', 'options', 'correct', 'explanation'].every(k => k in d.questions[0]));
  t('schema: 4 options, correct 0-3', d && d.questions[0].options.length === 4 && d.questions[0].correct >= 0 && d.questions[0].correct <= 3);
  t('schema: fresh version 1', d && d.version === 1);
  t('schema: updated_at is a real date (not stale)', d && /^\d{4}-\d{2}-\d{2}$/.test(d.updated_at));
  t('schema: new ids slug-NNN', d && d.questions[0].id === 'nn-001');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
