// BATCH B regression: session protection + UX bugs + exam timeout safety.
// Run: node tools/run_batchB_tests.js
const fs = require('fs');
const app = fs.readFileSync('js/app.js', 'utf8');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok: ' + name); } else { fail++; console.log('FAIL: ' + name); } }
function bodyOf(startMarker, len) {
  const i = app.indexOf(startMarker);
  if (i < 0) return '';
  return app.slice(i, i + (len || 1200));
}

// ---- 1. session protection guard ----
t('guard helper exists (guardReplaceSession)', app.indexOf('guardReplaceSession') >= 0);
t('startStudy goes through guard', bodyOf('function startStudy(setId)').indexOf('guardReplaceSession') >= 0);
t('startWrongStudy goes through guard', bodyOf('window.startWrongStudy = function').indexOf('guardReplaceSession') >= 0);
t('startExam goes through guard', bodyOf('window.startExam = function').indexOf('guardReplaceSession') >= 0);
t('new quiz explicitly bypasses former interrupting modal', (() => {
  const b = bodyOf('function guardReplaceSession', 650);
  return b.indexOf('proceed()') >= 0 && b.indexOf('showModal') < 0;
})());
t('existing resume card remains available', app.indexOf('resume-continue') >= 0 && app.indexOf('window.resumeSession()') >= 0);
t('explicit discard confirmation remains', app.indexOf('window.discardSession = function') >= 0 && app.slice(app.indexOf('window.discardSession = function'), app.indexOf('window.discardSession = function') + 500).indexOf('showModal') >= 0);

// ---- 2. final study button ----
t('answerStudy updates next label on last question (Hoàn thành)', (() => {
  const b = bodyOf('function answerStudy(i)', 1100);
  return b.indexOf('Hoàn thành ✓') >= 0;
})());

// ---- 3. wrong-study retry scoped ----
t('restartStudy retries wrong scope (startWrongStudy via lastResult)', (() => {
  const b = bodyOf('window.restartStudy = function', 600);
  return b.indexOf('lastResult') >= 0 && b.indexOf('startWrongStudy') >= 0;
})());
t('restartStudy never restarts full set for wrong review (no startStudy in wrong branch)', (() => {
  const b = bodyOf('window.restartStudy = function', 600);
  return b.indexOf('startStudyNow(activeSetId') >= 0 && b.indexOf('startStudy(activeSetId)') < 0;
})());
t('finishStudy records result context (lastResult)', app.indexOf('lastResult = { wasWrongReview') >= 0);
t('retryStillWrong stays scoped (startWrongStudy)', bodyOf('window.retryStillWrong = function', 500).indexOf('startWrongStudy') >= 0);

// ---- 4. global starred return context ----
t('global list return keeps scope (no narrowing to q.setId)', app.indexOf('setId: setId || q.setId') < 0);
t('list origin preserves scope (setId || null)', app.indexOf('{ type: type, setId: setId || null }') >= 0);

// ---- 5. exam timeout / modal safety ----
t('exam carries submitted flag', app.indexOf('submitted: false') >= 0);
t('submitExam single-submission guard (first call wins)', (() => {
  const b = bodyOf('function submitExam()', 500);
  return b.indexOf('if (exam.submitted) return;') >= 0 && b.indexOf('exam.submitted = true;') >= 0;
})());
t('timeout submit dismisses stale modals (hideModal in submitExam)', bodyOf('function submitExam()', 500).indexOf('hideModal()') >= 0);
t('confirmSubmitExam ignored after submit', bodyOf('window.confirmSubmitExam = function', 400).indexOf('exam.submitted') >= 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
