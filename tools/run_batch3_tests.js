// BATCH 3 regression tests (learner UX / study / exam).
// Run: node tools/run_batch3_tests.js
// Source-level + behavioral checks; no browser required.
const fs = require('fs');
const css = fs.readFileSync('css/styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

// ---------- 1. Home hierarchy ----------
{
  const rs = html.indexOf('id="resume-slot"');
  const sl = html.indexOf('id="set-list"');
  const hn = html.indexOf('id="home-nav"');
  const sy = html.indexOf('id="sync-dot"');
  t('home order: resume-slot before set-list', rs >= 0 && sl > rs);
  t('home order: set-list before home-nav', hn > sl);
  t('home order: sync info last (after home-nav)', sy > hn);
  const rh = app.indexOf('Bắt đầu ôn tập');
  const ex = app.indexOf('Thi thử', rh);
  const wr = app.indexOf('Ôn câu sai', ex);
  const st = app.indexOf('Câu đã lưu', wr);
  t('hierarchy: start before exam before wrong before starred', rh > 0 && ex > rh && wr > ex && st > wr);
  t('primary study action prominent (study-primary)', app.indexOf('study-primary') >= 0 && css.indexOf('.study-primary') >= 0);
  t('per-set wrong count (Ôn câu sai · N câu)', /Ôn câu sai · ' \+ nw/.test(app) || app.indexOf("Ôn câu sai · ' + nw") >= 0 || app.indexOf('Ôn câu sai · ') >= 0);
}

// ---------- 2. Resume card ----------
{
  t('resume card id', app.indexOf("id = 'resume-card'") >= 0 || app.indexOf('resume-card') >= 0);
  t('resume shows subject+mode+position (resume-meta)', app.indexOf('resume-meta') >= 0);
  t('resume shows exam remaining time (còn MM:SS)', app.indexOf('còn ') >= 0);
  t('resume primary action Tiếp tục (resume-continue)', app.indexOf('resume-continue') >= 0);
  t('resume destructive action Bỏ bài (resume-discard)', app.indexOf('resume-discard') >= 0);
  t('discard requires explicit confirmation (showModal)', (() => {
    const i = app.indexOf('window.discardSession = function');
    const body = app.slice(i, i + 800);
    return body.indexOf('showModal') >= 0 && body.indexOf('Bỏ bài đang làm dở') >= 0;
  })());
  t('discard safe choice first (Giữ lại bài)', app.indexOf('Giữ lại bài') >= 0);
  t('no vague browser confirm for resume (offerResume has no confirm call)', (() => {
    const i = app.indexOf('function offerResume');
    const body = app.slice(i, i + 900);
    return body.indexOf('confirm(') < 0;
  })());
  t('returning Home never deletes progress (exitStudy persists)', (() => {
    const i = app.indexOf('window.exitStudy');
    const body = app.slice(i, i + 700);
    return body.indexOf('persistSession()') >= 0;
  })());
}

// ---------- 3. Study header ----------
{
  t('study title is Câu X / Y (clearest context)', app.indexOf("'Câu ' + (study.idx + 1) + ' / ' + total") >= 0 || app.indexOf("'Câu ' + (study.idx + 1) + ' / ' + list.length") >= 0);
  t('subject de-emphasized as sub (Ôn tập · title)', app.indexOf("Ôn tập' + ' · '") >= 0 || app.indexOf("Ôn tập · '") >= 0 || app.indexOf("'Ôn tập · '") >= 0);
  t('save control understandable (Lưu câu/Đã lưu)', app.indexOf('Lưu câu') >= 0 && app.indexOf('Đã lưu') >= 0);
}

// ---------- 4. Study feedback ----------
{
  t('feedback scrolls into view (nearest)', app.indexOf('scrollIntoView') >= 0 && app.indexOf("block: 'nearest'") >= 0);
  t('feedback honors reduced motion', app.indexOf('prefers-reduced-motion') >= 0);
  t('no auto-advance after answer (answerStudy never calls studyNext)', (() => {
    const i = app.indexOf('function answerStudy');
    const end = app.indexOf('window.studyNext', i);
    const body = app.slice(i, end);
    return body.indexOf('studyNext(') < 0 && body.indexOf('study.idx++') < 0;
  })());
  t('next remains manual (studyNext wired to button)', html.indexOf('onclick="studyNext()"') >= 0);
  t('explanation revealed from source (q.e, no invention)', app.indexOf('q.e ?') >= 0);
}

// ---------- 5. Study navigation ----------
{
  t('final study button = Hoàn thành', app.indexOf('Hoàn thành ✓') >= 0);
  t('study nav retains position (scrollTo predictable)', app.indexOf('window.studyPrev') >= 0 && app.indexOf('window.scrollTo(0, 0)') >= 0);
  t('transient hides prev (no confusing nav stack)', app.indexOf("$('study-prev').style.display = 'none'") >= 0);
}

// ---------- 6. Single-question / list context ----------
{
  t('origin tracked (study.origin)', app.indexOf('origin: null') >= 0 && app.indexOf('study.origin') >= 0);
  t('contextual retry exists (Thử lại câu này)', app.indexOf('Thử lại câu này') >= 0 && app.indexOf('retrySingleQuestion') >= 0);
  t('contextual return wrong (Quay lại câu sai)', app.indexOf('Quay lại câu sai') >= 0);
  t('contextual return starred (Quay lại câu đã lưu)', app.indexOf('Quay lại câu đã lưu') >= 0);
  t('contextual return search (Quay lại tìm kiếm)', app.indexOf('Quay lại tìm kiếm') >= 0);
  t('transient never starts full set (returnToOrigin, no startStudy)', (() => {
    const i = app.indexOf('function returnToOrigin');
    const body = app.slice(i, i + 800);
    return body.indexOf('startStudy') < 0 && body.indexOf("show('search')") >= 0;
  })());
  t('transient never clears kept session (returnToOrigin has no clearSession)', (() => {
    const i = app.indexOf('function returnToOrigin');
    const body = app.slice(i, i + 800);
    return body.indexOf('clearSession') < 0;
  })());
  t('search query preserved (lastSearchQuery)', app.indexOf('lastSearchQuery') >= 0);
  t('search input restored on return', app.indexOf('inp.value = lastSearchQuery') >= 0);
  t('wrong list passes origin (openList setId + origin)', app.indexOf('openSingleQuestion(k, { type: type') >= 0);
  t('search passes query origin', app.indexOf("type: 'search', query: lastSearchQuery") >= 0);
}

// ---------- 7. Exam setup ----------
{
  t('setup wording Chọn bài thi (not chọn cấu hình)', html.indexOf('Chọn bài thi') >= 0 && html.indexOf('chọn cấu hình') < 0);
  t('default path obvious (20 câu · 20 phút)', app.indexOf('20 câu · 20 phút') >= 0 || html.indexOf('20 câu · 20 phút') >= 0);
  t('start button echoes selection (exam-start-btn)', html.indexOf('id="exam-start-btn"') >= 0 && app.indexOf('updateExamStartBtn') >= 0);
  t('semantic shuffle controls kept (role=switch)', html.indexOf('role="switch"') >= 0);
}

// ---------- 8. Exam screen ----------
{
  t('exam shows Câu X / Y', app.indexOf("'Câu ' + (exam.idx + 1) + ' / ' + total") >= 0);
  t('exam shows Đã trả lời X / Y', app.indexOf('Đã trả lời ') >= 0);
  t('selected state text+style (✓ Đã chọn)', app.indexOf('✓ Đã chọn') >= 0);
  t('navigator labels answered/unanswered', app.indexOf('(đã trả lời)') >= 0 && app.indexOf('(chưa trả lời)') >= 0);
  t('absolute endsAt deadline kept', app.indexOf('endsAt') >= 0 && app.indexOf('examRemaining()') >= 0);
}

// ---------- 9. Submit guard ----------
{
  t('submit warns how many unanswered (Còn N câu)', app.indexOf('Còn ') >= 0 && app.indexOf('câu chưa trả lời') >= 0);
  t('safe choice obvious (Tiếp tục làm bài first)', app.indexOf('Tiếp tục làm bài') >= 0);
  t('modal used (not bare confirm) for submit', (() => {
    const i = app.indexOf('window.confirmSubmitExam');
    const body = app.slice(i, i + 700);
    return body.indexOf('showModal') >= 0;
  })());
  t('modal safe button focused first', app.indexOf('safe.focus()') >= 0);
}

// ---------- 10. Exam result ----------
{
  t('result shows unanswered explicitly (Bạn chưa trả lời)', app.indexOf('Bạn chưa trả lời') >= 0);
  t('result renders source explanation (d.q.e)', app.indexOf('d.q.e') >= 0);
  t('no strikethrough (readable review)', /text-decoration\s*:\s*line-through/.test(css) === false);
}

// ---------- 11. Back / navigation safety ----------
{
  t('exam exit keeps session (no silent delete)', (() => {
    const i = app.indexOf('window.confirmExitExam');
    const body = app.slice(i, i + 700);
    return body.indexOf('LddStore.clearSession()') < 0 && body.indexOf('persistSession()') >= 0;
  })());
  t('transient back returns to origin (exitStudy branch)', (() => {
    const i = app.indexOf('window.exitStudy');
    const body = app.slice(i, i + 500);
    return body.indexOf('returnToOrigin()') >= 0;
  })());
  t('browser swipe safe: pagehide persists', app.indexOf("'pagehide'") >= 0);
}

// ---------- 12. Landscape ----------
{
  t('short viewport rule exists', css.indexOf('@media (max-height:500px)') >= 0);
  t('landscape keeps large text (no font-size shrink in media)', (() => {
    const i = css.indexOf('@media (max-height:500px)');
    const body = css.slice(i, i + 600);
    return body.indexOf('font-size') < 0;
  })());
  t('footer flows in landscape (static, not covering)', (() => {
    const i = css.indexOf('@media (max-height:500px)');
    const body = css.slice(i, i + 600);
    return body.indexOf('.bottom-actions') >= 0 && body.indexOf('position:static') >= 0;
  })());
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
