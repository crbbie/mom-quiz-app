// BATCH A regression: answer-card mobile layout + feedback scroll.
// Run: node tools/run_batchA_tests.js
const fs = require('fs');
const css = fs.readFileSync('css/styles.css', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok: ' + name); } else { fail++; console.log('FAIL: ' + name); } }

function cssBlock(sel) {
  const i = css.indexOf(sel);
  if (i < 0) return '';
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close);
}
const opt = cssBlock('.opt{') || cssBlock('.opt {') || (() => { const i = css.indexOf('.opt{'); return ''; })();
// robust: find first ".opt{" occurrence
{
  const i = css.indexOf('.opt{');
  const j = css.indexOf('.opt {');
  const start = (i >= 0 ? i : 1e9) < (j >= 0 ? j : 1e9) ? i : j;
  t('.opt block exists', start >= 0 && start < 1e9);
}
const optCss = (() => { const idx = css.indexOf('.opt{display:grid'); return idx >= 0 ? css.slice(idx, idx + 600) : ''; })();
t('.opt uses grid (not flex row)', css.indexOf('.opt{display:grid') >= 0);
t('.opt letter column 36-38px', /grid-template-columns:\s*3[6-8]px/.test(css));
t('.opt answer column flexible (1fr/minmax)', /grid-template-columns:[^;]*1fr/.test(css));
t('.opt column gap 10-12px', /column-gap:\s*1[0-2]px/.test(optCss));
t('.opt horizontal padding 14-16px', /padding:\s*1[4-6]px/.test(optCss));
t('.tag in answer column (grid-column:2)', /\.opt \.tag\{[^}]*grid-column:\s*2/.test(css));
t('.tag spacing before status 8-12px (margin-top)', /\.opt \.tag\{[^}]*margin-top:\s*(8|9|10|11|12)px/.test(css));
t('option cards gap 14-16px (.options)', /\.options\{[^}]*gap:\s*1[456]px/.test(css));
t('no truncation of answers (no ellipsis/nowrap on .otext)', !/\.opt \.otext\{[^}]*(text-overflow:\s*ellipsis|white-space:\s*nowrap)/.test(css));
t('no faded answers (.opt.dim opacity 1 kept)', /\.opt\.dim\{[^}]*opacity:\s*1/.test(css));
t('correct badge text ✓ Đáp án đúng', app.indexOf('✓ Đáp án đúng') >= 0);
t('wrong badge text ✕ Bạn chọn — chưa đúng', app.indexOf('Bạn chọn — chưa đúng') >= 0);
t('exam selected badge ✓ Đã chọn', app.indexOf('✓ Đã chọn') >= 0);
t('revealStudyAnswer takes scroll param', /function revealStudyAnswer\(scroll\)/.test(app));
t('renderStudy does NOT auto-scroll (passes false)', app.indexOf('revealStudyAnswer(false)') >= 0);
t('answerStudy scrolls newly answered (passes true)', app.indexOf('revealStudyAnswer(true)') >= 0);
t('scroll gated on param (scroll === false return)', app.indexOf('scroll === false') >= 0);
t('feedback still honors reduced motion', app.indexOf('prefers-reduced-motion') >= 0);
t('letter column stays 38px (no shrink)', /\.opt \.letter\{[^}]*width:\s*38px/.test(css));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
