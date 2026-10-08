// BATCH 2 regression tests (low-vision typography + accessibility).
// Run: node tools/run_batch2_tests.js
const fs = require('fs');
const css = fs.readFileSync('css/styles.css', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const storeSrc = fs.readFileSync('js/store.js', 'utf8');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

// ---------- 1. typography tokens ----------
{
  const tokens = ['--font-home-title', '--font-set-title', '--font-important', '--font-meta',
    '--font-question', '--font-answer', '--font-feedback-head', '--font-explanation',
    '--font-button', '--font-counter', '--font-timer'];
  tokens.forEach(tk => t('token defined ' + tk, css.indexOf(tk + ':') >= 0));
  t('xlarge overrides exist', css.indexOf('data-text-size="xlarge"') >= 0 || css.indexOf('data-text-size=\'xlarge\'') >= 0 || css.indexOf('[data-text-size=xlarge]') >= 0);
  // xlarge values bigger than large ones (spot-check question/answer/button)
  t('question uses token', css.indexOf('font-size:var(--font-question)') >= 0);
  t('answer uses token', css.indexOf('font-size:var(--font-answer)') >= 0);
  t('button uses token', css.indexOf('font-size:var(--font-button)') >= 0);
  t('no global scale() transform on body', css.indexOf('body{transform:scale') < 0 && css.indexOf('transform: scale(') < 0);
}

// ---------- 2. text-size control + persistence ----------
{
  t('exactly two modes in HTML (Lớn/Rất lớn)', (html.match(/setTextSize\('(large|xlarge)'\)/g) || []).length === 2);
  t('control has pressed state', html.indexOf('id="ts-large"') >= 0 && html.indexOf('id="ts-xlarge"') >= 0 && html.indexOf('aria-pressed') >= 0);
  t('app applies root data-text-size', app.indexOf("setAttribute('data-text-size'") >= 0);
  t('app exposes setTextSize', app.indexOf('window.setTextSize') >= 0);
  t('store merges textSize default (backward compat)', storeSrc.indexOf("textSize: 'large'") >= 0 && storeSrc.indexOf("p.textSize === 'xlarge'") >= 0);
  // functional: old prefs without textSize -> large; round-trip xlarge
  const mem = {};
  const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const S = new Function('window', 'localStorage', storeSrc + '; return window.LddStore;')({}, ls);
  t('default textSize is large', S.getPrefs().textSize === 'large');
  ls.setItem('ldd_prefs_v1', JSON.stringify({ shuffleQ: true }));
  t('old prefs merge keeps flags + large', S.getPrefs().shuffleQ === true && S.getPrefs().textSize === 'large');
  const p = S.getPrefs(); p.textSize = 'xlarge'; S.setPrefs(p);
  t('xlarge persists', S.getPrefs().textSize === 'xlarge');
}

// ---------- 3. zoom ----------
{
  const vp = html.match(/<meta name="viewport"[^>]*>/) || [''];
  t('no maximum-scale restriction', vp[0].indexOf('maximum-scale') < 0);
  t('no user-scalable=no', vp[0].indexOf('user-scalable=no') < 0);
  t('viewport-fit=cover kept', vp[0].indexOf('viewport-fit=cover') >= 0);
}

// ---------- 4. contrast ----------
{
  ['#7b8698', '#6b7688', '#8b96a8', '#a0aabb'].forEach(c =>
    t('no pale learner text ' + c, css.toLowerCase().indexOf(c) < 0));
  t('readable secondary #41506b used', css.indexOf('#41506b') >= 0);
}

// ---------- 5. answer states ----------
{
  t('no .opt.dim low-opacity', /\.opt\.dim\s*\{[^}]*opacity\s*:\s*\.55/.test(css) === false && css.indexOf('.opt.dim{opacity:.55') < 0);
  t('study correct tag (text meaning)', app.indexOf('✓ Đáp án đúng') >= 0);
  t('study wrong tag (text meaning)', app.indexOf('✕ Bạn chọn') >= 0);
  t('exam chosen tag (text meaning)', app.indexOf('✓ Đã chọn') >= 0);
  t('no strikethrough on long answers', css.indexOf('.wrong-ans') >= 0 && /text-decoration\s*:\s*line-through/.test(css) === false);
}

// ---------- 6. touch targets / spacing ----------
{
  t('answer min-height ~72px', /min-height:\s*72px/.test(css));
  t('primary button min-height ~60px', /\.btn\{[^}]*min-height:\s*60px/.test(css));
  t('back/action min 48px', /min-width:\s*48px/.test(css) && /min-height:\s*48px/.test(css));
  t('nav cells min 52px', /min-height:\s*52px/.test(css));
  t('answer gap 14-16px', /\.options\{[^}]*gap:\s*1[456]px/.test(css));
}

// ---------- 7. star/save ----------
{
  t('star has accessible name', html.indexOf('id="study-star"') >= 0 && html.indexOf('aria-label') >= 0);
  t('star pressed state in JS', app.indexOf("aria-pressed', starOn") >= 0);
  t('star names Lưu câu/Đã lưu', app.indexOf('Lưu câu') >= 0 && app.indexOf('Đã lưu') >= 0);
}

// ---------- 8. semantic controls ----------
{
  t('switches are buttons with role=switch', html.indexOf('role="switch"') >= 0 && html.indexOf('<button class="switch') >= 0);
  t('switch state exposed (aria-checked)', app.indexOf("aria-checked', el.classList.contains('on')") >= 0);
  t('chips expose aria-pressed', app.indexOf('syncChips') >= 0);
  t('back buttons labelled', (html.match(/aria-label="Quay lại"/g) || []).length >= 7);
  t('search has label', html.indexOf('<label class="sr-only" for="search-input"') >= 0);
  t('nav cells labelled + current', app.indexOf("aria-label', 'Câu '") >= 0 && app.indexOf("aria-current', 'true'") >= 0);
  t('options labelled', app.indexOf("aria-label', 'Đáp án '") >= 0);
}

// ---------- 9. focus / motion ----------
{
  t('visible focus ring (~3px)', /:focus-visible\s*\{[^}]*outline:\s*3px/.test(css));
  t('no global outline removal', css.indexOf('outline:none') < 0 || css.indexOf(':focus{outline:none') < 0);
  t('reduced-motion honored', css.indexOf('prefers-reduced-motion: reduce') >= 0);
}

// ---------- 10. lists / results ----------
{
  t('no 3-line clamp on list text', css.indexOf('-webkit-line-clamp') < 0);
  t('review question readable (token)', /\.review-item \.rq\{[^}]*var\(--font-important\)/.test(css));
  t('review answer readable (token)', /\.review-item \.ra\{[^}]*var\(--font-explanation\)/.test(css));
}

// ---------- 11. footer ----------
{
  t('footer participates in layout (sticky, not fixed)', /\.bottom-actions\{[^}]*position:\s*sticky/.test(css));
  t('no fragile 120px content reserve', css.indexOf('padding:18px 16px 120px') < 0 && css.indexOf('120px') < 0);
  t('safe-area respected in footer', css.indexOf('env(safe-area-inset-bottom)') >= 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
