// BATCH E regression: "Xem đáp án" read-only mode.
// Run: node tools/run_batchE_tests.js
const fs = require('fs');
const css = fs.readFileSync('css/styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const store = fs.readFileSync('js/store.js', 'utf8');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok: ' + name); } else { fail++; console.log('FAIL: ' + name); } }
function viewBody() {
  const i = app.indexOf('/* ---------- "Xem đáp án"');
  if (i < 0) return '';
  const end = app.indexOf("/* ---------- wrong / star / history", i);
  return app.slice(i, end > 0 ? end : i + 7000);
}
const vb = viewBody();
// Strip comments so isolation checks only see real code (the section's own
// doc comment names the forbidden calls to explain the boundary).
const vcode = vb.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

// ---- home hierarchy (redesigned approved layout: mode rows in static HTML,
// study first; rows always stack vertically full-width; view hint stays small) ----
t('home order: study before view before exam', (() => {
  const r = html.indexOf('data-mode="study"');
  const v = html.indexOf('data-mode="view"', r);
  const e = html.indexOf('data-mode="exam"', v);
  return r > 0 && v > r && e > v;
})());
t('view action is a clear mode row (full width by layout)', html.indexOf('data-mode="view"') >= 0 && /\.mode-list\{[^}]*flex-direction:\s*column/.test(css));
t('modes always stack vertically (never cramped side-by-side)', /\.mode-list\{[^}]*flex-direction:\s*column/.test(css));
t('resume hint small (Tiếp tục xem từ câu N, no large card)', app.indexOf('Tiếp tục xem từ câu ') >= 0 && app.indexOf('view-resume-hint') >= 0);

// ---- view screen: continuous-scroll answer review ----
t('view screen exists (screen-view)', html.indexOf('id="screen-view"') >= 0);
// DOM–JS contract (the shipped bug: JS wrote #view-position which HTML
// lacked, throwing TypeError and blanking the screen). Both sides must agree.
t('view-position element exists in DOM', html.indexOf('id="view-position"') >= 0);
t('renderView writes the existing #view-position (no null textContent)', vb.indexOf("$('view-position')") >= 0 && html.indexOf('id="view-position"') >= 0);
t('every view-section $() id exists in index.html (DOM contract)', (() => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
  const used = [...vb.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
  const missing = [...new Set(used)].filter(id => !ids.has(id));
  if (missing.length) console.log('   missing ids: ' + missing.join(', '));
  return missing.length === 0;
})());
t('view header shows Xem đáp án + set title', vb.indexOf("'Xem đáp án'") >= 0 && vb.indexOf('renderViewHeader') >= 0);
t('view renders a card list (view-list container)', html.indexOf('id="view-list"') >= 0 && vb.indexOf("$('view-list')") >= 0);
t('view has Xem thêm fallback (view-load-more)', html.indexOf('id="view-load-more"') >= 0 && vb.indexOf('viewLoadMore') >= 0);
t('view appends progressive batches (no full innerHTML wipe per card)', vb.indexOf('renderViewBatch') >= 0 && vb.indexOf('DocumentFragment') >= 0);
t('view shows correct badge (✓ Đáp án đúng)', vb.indexOf('✓ Đáp án đúng') >= 0);
t('view shows per-card star control (Lưu câu/Đã lưu + aria-pressed)', vb.indexOf('view-star-btn') >= 0 && vb.indexOf('Lưu câu') >= 0 && vb.indexOf('Đã lưu') >= 0 && vb.indexOf('aria-pressed') >= 0);
t('no single-question prev/next (continuous scroll needs none)', html.indexOf('id="view-prev"') < 0 && html.indexOf('id="view-next"') < 0 && app.indexOf('window.viewPrev') < 0 && app.indexOf('window.viewNext') < 0);
t('no single-question picker in review (study/exam pickers untouched)', vb.indexOf('openViewPicker') < 0 && app.indexOf('function openViewPicker') < 0 && app.indexOf('openStudyPicker') >= 0 && app.indexOf('openExamPicker') >= 0);

// ---- read-only isolation ----
t('correct comes DIRECTLY from data (q.o[q.c])', vb.indexOf('q.o[q.c]') >= 0);
t('no inference/recalc (no search inside view section)', vb.toLowerCase().indexOf('fetch(') < 0 && vb.indexOf('normalizeVi') < 0);
// ---- explanation guard ----
t('explanation only when present (non-empty q.e check)', /typeof q\.e === 'string' && q\.e\.trim\(\)/.test(vb));
t('view never answers study quiz (no answerStudy call)', vcode.indexOf('answerStudy(') < 0);
t('view never answers exam (no selectExam/submitExam)', vcode.indexOf('selectExam') < 0 && vcode.indexOf('submitExam') < 0);
t('view never writes wrong membership (no setWrong)', vcode.indexOf('setWrong') < 0);
t('view never writes history (no pushHistory)', vcode.indexOf('pushHistory') < 0);
t('view never touches session slot (no setSession/clearSession/persistSession)', vcode.indexOf('setSession') < 0 && vcode.indexOf('clearSession') < 0 && vcode.indexOf('persistSession') < 0);
t('view never starts quiz sessions (no startStudy/startExam)', vcode.indexOf('startStudy') < 0 && vcode.indexOf('startExam') < 0 && vcode.indexOf('startWrongStudy') < 0);
t('only star tap writes stars (setStars once, in toggleViewCardStar)', (() => {
  const n = vcode.split('setStars').length - 1;
  return n === 1 && vcode.indexOf('window.toggleViewCardStar') >= 0;
})());
t('star tap updates only its own card (no full renderView rebuild)', (() => {
  const i = vcode.indexOf('window.toggleViewCardStar');
  const b = vcode.slice(i, i + 1400);
  return b.indexOf('renderView(') < 0;
})());

// ---- viewing position ----
t('separate position slot (ldd_viewpos_v1)', store.indexOf('ldd_viewpos_v1') >= 0);
t('position keyed per set (getViewPos/setViewPos)', store.indexOf('getViewPos') >= 0 && store.indexOf('setViewPos') >= 0);
t('first visit opens Q1 (viewResumeIndex defaults 0)', vb.indexOf('return 0;') >= 0);
t('later visits resume saved key (stable setId:qid match)', vb.indexOf('LddStore.key(list[i].setId, list[i].id) === k') >= 0);

// ---- picker: review no longer paginates, study/exam pickers intact ----
t('study/exam pickers intact (openStudyPicker/openExamPicker via renderPicker)', app.indexOf('function openStudyPicker') >= 0 && app.indexOf('function openExamPicker') >= 0);
t('dispatcher routes only study/exam (no view picker branch)', app.indexOf('view && view.active') < 0);

// ---- search + starred integration ----
t('search tap opens view mode (openViewAt + search origin)', app.indexOf("openViewAt(q.setId, q.id, { type: 'search', query: lastSearchQuery") >= 0);
t('search back restores query + list + scroll (exitView)', (() => {
  const i = app.indexOf('window.exitView = function');
  const b = app.slice(i, i + 800);
  return b.indexOf("show('search')") >= 0 && b.indexOf('inp.value = lastSearchQuery') >= 0 && b.indexOf('lastSearchScroll') >= 0;
})());
t('starred tap opens view mode (openViewAt + star origin)', app.indexOf('openViewAt(q.setId, q.id, { type: type, setId: setId || null') >= 0);
t('starred back returns to Câu đã lưu list (openList star + scope)', (() => {
  const i = app.indexOf('window.exitView = function');
  const b = app.slice(i, i + 800);
  return b.indexOf("openList('star'") >= 0;
})());
t('starred list wording says viewing (chạm để xem đáp án)', app.indexOf('chạm để xem đáp án') >= 0);
t('wrong list stays PRACTICE (openSingleQuestion for wrong)', app.indexOf('Wrong-question taps stay PRACTICE') >= 0 && app.indexOf('openSingleQuestion(k, { type: type, setId: setId || null })') >= 0);

// ---- do-not-add guardrails ----
t('no TTS (no speechSynthesis)', app.indexOf('speechSynthesis') < 0);
t('no accounts/backend (no fetch POST/login)', /fetch\([^)]*method[^)]*POST/i.test(app) === false && app.toLowerCase().indexOf('login') < 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
