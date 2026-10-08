// BATCH D regression: shared "Danh sách câu" picker.
// Run: node tools/run_batchD_tests.js
const fs = require('fs');
const css = fs.readFileSync('css/styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok: ' + name); } else { fail++; console.log('FAIL: ' + name); } }
function bodyOf(marker, len) {
  const i = app.indexOf(marker);
  if (i < 0) return '';
  return app.slice(i, i + (len || 1500));
}

// ---- entry: visible text, placement ----
t('visible text "Danh sách câu" (not icon-only)', html.indexOf('Danh sách câu') >= 0 && app.indexOf("'Danh sách câu'") >= 0);
t('study entry above question content (before study-cat)', html.indexOf('id="study-picker-btn"') > html.indexOf('id="study-counter"') && html.indexOf('id="study-picker-btn"') < html.indexOf('id="study-cat"'));
t('exam entry above question content (before exam-cat)', html.indexOf('id="exam-picker-btn"') > html.indexOf('id="exam-counter"') && html.indexOf('id="exam-picker-btn"') < html.indexOf('id="exam-cat"'));
t('entry is a text button, not a footer action', html.indexOf('picker-open') >= 0 && html.indexOf('id="study-picker-btn"') < html.indexOf('class="bottom-actions"'));
t('picker hidden for transient single-question reviews', app.indexOf("study-picker-btn')") >= 0 && app.indexOf('study.transient ?') >= 0);

// ---- overlay: full-screen ----
t('full-screen overlay exists (picker-overlay)', html.indexOf('id="picker-overlay"') >= 0 && css.indexOf('.picker-overlay{position:fixed;inset:0') >= 0);
t('dialog semantics (role=dialog aria-modal)', html.indexOf('role="dialog"') >= 0 && html.indexOf('aria-modal="true"') >= 0);
t('cancel control (Đóng)', html.indexOf('>Đóng</button>') >= 0 && app.indexOf('closeQuestionPicker') >= 0);

// ---- grid: 4 cols, ~64px, gaps, large numbers ----
t('grid is 4 columns (not six-column exam CSS)', /\.picker-grid\{[^}]*grid-template-columns:\s*repeat\(4,\s*1fr\)/.test(css));
t('exam six-column CSS untouched (not reused)', /\.nav-grid\{[^}]*grid-template-columns:\s*repeat\(6,1fr\)/.test(css));
t('targets ~64px (min-height:64px)', /\.picker-cell\{[^}]*min-height:\s*64px/.test(css));
t('gaps 10-12px', /\.picker-grid\{[^}]*gap:\s*1[012]px/.test(css));
t('large numbers (font-counter)', /\.picker-cell\{[^}]*font-size:\s*var\(--font-counter\)/.test(css));

// ---- states + legend + labels ----
t('states: current (cur)', app.indexOf('picker-cell') >= 0 && css.indexOf('.picker-cell.cur') >= 0);
t('states: answered ✓ (ok)', css.indexOf('.picker-cell.ok') >= 0 && app.indexOf('đã trả lời đúng') >= 0);
t('states: wrong ✕ (bad)', css.indexOf('.picker-cell.bad') >= 0 && app.indexOf('đã trả lời sai') >= 0);
t('no star state in grid v1 (picker has no star)', bodyOf('function renderPicker', 2200).toLowerCase().indexOf('star') < 0 && bodyOf('function openStudyPicker', 2200).toLowerCase().indexOf('star') < 0);
t('legend present', app.indexOf('picker-legend') >= 0 && app.indexOf('Chưa trả lời</span>') >= 0);
t('accessible labels ("Câu N, chưa trả lời")', app.indexOf("'Câu ' + (i + 1) + ', '") >= 0 && app.indexOf('chưa trả lời') >= 0);
t('aria-current on current cell', app.indexOf("aria-current', 'true'") >= 0);

// ---- behavior ----
t('tap jumps immediately (pick sets idx + renders)', bodyOf('pick: function (i) {\n        study.idx = i;', 300).indexOf('renderStudy()') >= 0 || app.indexOf('study.idx = i;\n        renderStudy();') >= 0);
t('jump preserves answers (no answers reset in pick)', (() => {
  const i = app.indexOf('pick: function (i) {\n        study.idx = i;');
  const b = app.slice(i, i + 200);
  return b.indexOf('answers') < 0 || b.indexOf('answers:') < 0;
})());
t('jump persists session + scrolls to beginning', app.indexOf('study.idx = i;\n        renderStudy();\n        persistSession();\n        window.scrollTo(0, 0);') >= 0);
t('reopen brings current into view (scrollIntoView cur)', bodyOf('var cur = g.querySelector', 300).indexOf('scrollIntoView') >= 0);
t('exam reuses shared picker (openExamPicker via renderPicker)', bodyOf('function openExamPicker', 400).indexOf('renderPicker(') >= 0);
t('exam picker has no wrong-leak (answered/unanswered only)', bodyOf('function openExamPicker', 1200).indexOf("'bad'") < 0);

// ---- completion with unanswered ----
t('final question does not auto-finish (confirmFinishStudy)', app.indexOf('confirmFinishStudy') >= 0 && bodyOf('window.studyNext = function', 800).indexOf('confirmFinishStudy()') >= 0);
t('unanswered count stated + return offered', bodyOf('function confirmFinishStudy', 900).indexOf('câu chưa trả lời') >= 0 && bodyOf('function confirmFinishStudy', 900).indexOf('Quay lại làm tiếp') >= 0);
t('result notes unanswered questions', app.indexOf('câu chưa trả lời') >= 0 && app.indexOf('$(\'sr-sub\')') >= 0);
t('wrong snapshot stable (answerStudy never splices list)', bodyOf('function answerStudy(i)', 900).indexOf('study.list.splice') < 0);
t('wrong picker shows session position (vị trí trong buổi ôn)', app.indexOf('vị trí trong buổi ôn này') >= 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
