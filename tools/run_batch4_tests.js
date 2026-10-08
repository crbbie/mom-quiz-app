// BATCH 4 regression tests (wrong-question Study session + accent-insensitive search).
// Run: node tools/run_batch4_tests.js
// Functional normalize checks (extracted from js/app.js) + source guards.
const fs = require('fs');
const app = fs.readFileSync('js/app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

// Extract normalizeVi from app.js and evaluate it in isolation.
function loadNormalize() {
  const m = app.match(/function normalizeVi\(s\) \{[\s\S]*?\n  \}/);
  if (!m) return null;
  return new Function(m[0] + '; return normalizeVi;')();
}
const normalizeVi = loadNormalize();

// ---------- 1. Wrong-question Study session ----------
{
  t('wrong session entry exists (startWrongStudy)', app.indexOf('window.startWrongStudy') >= 0);
  t('home per-set wrong button starts session (not bare list)', (() => {
    const i = app.indexOf('[data-act="wrong"]');
    const body = app.slice(i, i + 120);
    return body.indexOf('startWrongStudy') >= 0;
  })());
  t('home global wrong tile starts session', app.indexOf("startWrongStudy(null)") >= 0);
  t('queue snapshot from stable keys (setId:questionId via questionById)', (() => {
    const i = app.indexOf('window.startWrongStudy = function');
    const body = app.slice(i, i + 1400);
    return body.indexOf('LddStore.getWrong()') >= 0 && body.indexOf('LddStore.questionById(cache, k)') >= 0 && body.indexOf('list.slice()') >= 0;
  })());
  t('N wrong -> N-item session (list built from ids map)', (() => {
    const i = app.indexOf('window.startWrongStudy = function');
    const body = app.slice(i, i + 1400);
    return body.indexOf('ids.map(function (k)') >= 0 && body.indexOf('answers: list.map') >= 0;
  })());
  t('answering correctly updates persistent wrong (answerStudy filter)', (() => {
    const i = app.indexOf('function answerStudy');
    const end = app.indexOf('window.studyNext', i);
    const body = app.slice(i, end);
    return body.indexOf('LddStore.setWrong(LddStore.getWrong().filter') >= 0;
  })());
  t('active queue stable mid-session (answerStudy never splices study.list)', (() => {
    const i = app.indexOf('function answerStudy');
    const end = app.indexOf('window.studyNext', i);
    const body = app.slice(i, end);
    return body.indexOf('study.list.splice') < 0 && body.indexOf('study.list.pop') < 0 && body.indexOf('study.list.shift') < 0;
  })());
  t('wrong session persists for resume (isWrongReview in session)', app.indexOf('isWrongReview: !!study.isWrongReview') >= 0);
  t('wrong session restores flags (s.isWrongReview)', app.indexOf('isWrongReview: !!s.isWrongReview') >= 0);
  t('resume card labels wrong review (Ôn câu sai mode)', app.indexOf("kept.isWrongReview ? 'Ôn câu sai'") >= 0);
  t('completion shows simple result + retry still-wrong', app.indexOf("Ôn lại các câu vẫn sai (' + stillWrong + ' câu)") >= 0 || app.indexOf('Ôn lại các câu vẫn sai') >= 0);
  t('retry button wired (retryStillWrong)', app.indexOf('window.retryStillWrong') >= 0 && html.indexOf('id="sr-retry-wrong"') >= 0);
  t('per-set scope honored (wrongSetId filter)', app.indexOf('wrongSetId') >= 0);
  t('global review keeps subject context per question', app.indexOf("setTitleOf(study.list[study.idx].setId)") >= 0);
  t('empty wrong list handled clearly (no session, friendly toast)', (() => {
    const i = app.indexOf('window.startWrongStudy = function');
    const body = app.slice(i, i + 600);
    return body.indexOf('Chưa có câu nào sai') >= 0 && body.indexOf('return;') >= 0;
  })());
}

// ---------- 2. Accent-insensitive search ----------
{
  t('normalizeVi extracted', !!normalizeVi);
  if (normalizeVi) {
    t('exact accents match (bất động sản)', normalizeVi('bất động sản') === normalizeVi('bất động sản'));
    t('no-accent matches (bat dong san)', normalizeVi('bat dong san') === normalizeVi('bất động sản'));
    t('uppercase/lowercase (BẤT ĐỘNG SẢN)', normalizeVi('BẤT ĐỘNG SẢN') === normalizeVi('bất động sản'));
    t('đ/d equivalence (đất ~ dat)', normalizeVi('đất đai') === normalizeVi('dat dai'));
    t('Đ/D uppercase (ĐẤT ~ DAT)', normalizeVi('ĐẤT') === normalizeVi('dat'));
    t('partial query normalizes (dong san)', normalizeVi('BẤT ĐỘNG SẢN').indexOf(normalizeVi('dong san')) >= 0);
    t('mixed query (Bat Dong San ~ bất động sản)', normalizeVi('Bat Dong San') === normalizeVi('bất động sản'));
  } else {
    t('exact accents match (bất động sản)', false);
    t('no-accent matches (bat dong san)', false);
    t('uppercase/lowercase (BẤT ĐỘNG SẢN)', false);
    t('đ/d equivalence (đất ~ dat)', false);
    t('Đ/D uppercase (ĐẤT ~ DAT)', false);
    t('partial query normalizes (dong san)', false);
    t('eskers: mixed query (Bat Dong San ~ bất động sản)', false);
  }
  t('search uses normalizeVi on query', app.indexOf('var kw = normalizeVi(lastSearchQuery)') >= 0);
  t('search uses normalizeVi on question+options', app.indexOf('normalizeVi(q.q)') >= 0 && app.indexOf('normalizeVi(o)') >= 0);
  t('displayed text never mutated (escapeHtml for render)', app.indexOf('escapeHtml(q.q)') >= 0);
  t('search implementation: NFD + strip marks + đ/Đ + lowercase', (() => {
    const i = app.indexOf('function normalizeVi');
    const body = app.slice(i, i + 400);
    return body.indexOf("normalize('NFD')") >= 0 && body.indexOf('[\\u0300-\\u036f]') >= 0 &&
      body.indexOf('/đ/g') >= 0 && body.indexOf('toLowerCase()') >= 0;
  })());
  t('no-result state names the query', app.indexOf('Không tìm thấy câu hỏi nào cho') >= 0);
  t('result count shown (search-count)', app.indexOf('search-count') >= 0);
  t('query preserved across return (lastSearchQuery restore)', app.indexOf('inp.value = lastSearchQuery') >= 0);
  t('hint mentions no-accent works', html.indexOf('không dấu') >= 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
