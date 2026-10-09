// Continuous-scroll answer review — EXECUTION tests with a minimal DOM shim.
// Run: node tools/run_view_scroll_tests.js
// Loads the REAL js/store.js + js/app.js + data/*.json in a vm sandbox and
// drives startView/openViewAt/changeViewTopic/viewLoadMore/toggleViewCardStar.
// Fails on the old bug (missing #view-position threw TypeError, blank view).
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' -- ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal DOM ----------
function matches(el, sel) {
  if (!el || el._isText || el._frag) return false;
  sel = String(sel).trim();
  if (!sel || sel.includes(' ') || sel.includes('>')) return false;
  if (sel[0] === '.') return sel.slice(1).split('.').every((c) => el._cls.has(c));
  const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
  if (m) {
    const v = Object.prototype.hasOwnProperty.call(el.attributes, m[1]) ? el.attributes[m[1]] : undefined;
    return m[2] === undefined ? (v !== undefined && v !== null) : v === m[2];
  }
  if (sel[0] === '#') return el.id === sel.slice(1);
  return el.tagName === sel.toUpperCase();
}
function walk(el, sel, out) {
  (el.children || []).forEach((c) => {
    if (matches(c, sel)) out.push(c);
    if (c.children && c.children.length) walk(c, sel, out);
  });
  return out;
}
function makeEl(tag, id) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '',
    children: [], attributes: {}, parentNode: null,
    style: {}, hidden: false, disabled: false,
    value: '', _text: '', _html: '', _cls: new Set(), _listeners: {},
  };
  Object.defineProperty(el, 'className', {
    get() { return [...el._cls].join(' '); },
    set(v) { el._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
  });
  el.classList = {
    add(...c) { c.forEach((x) => el._cls.add(x)); },
    remove(...c) { c.forEach((x) => el._cls.delete(x)); },
    toggle(c, f) { if (f === undefined) f = !el._cls.has(c); if (f) el._cls.add(c); else el._cls.delete(c); return f; },
    contains(c) { return el._cls.has(c); },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v); el.children = []; },
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el.children = []; },
  });
  el.setAttribute = (k, v) => { el.attributes[k] = String(v); };
  el.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(el.attributes, k) ? el.attributes[k] : null);
  el.appendChild = (c) => {
    if (!c) return c;
    if (c._frag) c.children.forEach((x) => { x.parentNode = el; el.children.push(x); });
    else { c.parentNode = el; el.children.push(c); }
    return c;
  };
  el.addEventListener = (type, fn) => { (el._listeners[type] = el._listeners[type] || []).push(fn); };
  el.removeEventListener = () => {};
  el.querySelectorAll = (sel) => walk(el, sel, []);
  el.querySelector = (sel) => { const r = walk(el, sel, []); return r.length ? r[0] : makeEl('div', ''); };
  el.getBoundingClientRect = () => ({ top: 50, left: 0, bottom: 600, right: 300, width: 300, height: 550 });
  el.scrollIntoView = () => { try { sandbox.__scrolled = el.getAttribute('data-key'); } catch (e) {} };
  el.focus = () => {};
  el.closest = () => null;
  Object.defineProperty(el, 'offsetTop', { get() { return 0; } });
  return el;
}

const html = fs.readFileSync('index.html', 'utf8');
const registry = new Map();
[...html.matchAll(/id="([^"]+)"/g)].forEach((m) => {
  if (!registry.has(m[1])) registry.set(m[1], makeEl('div', m[1]));
});
registry.forEach((el, id) => {
  if (id === 'screen-home' || id.indexOf('screen-') === 0) el.classList.add('screen');
});
registry.get('screen-home').classList.add('active');

const scrollCalls = [];
const sandbox = {
  console, setTimeout, clearTimeout, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
  scrollCalls, __scrolled: null,
  navigator: { onLine: false },
  fetch: () => Promise.reject(new Error('offline')),
  localStorage: {
    _d: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = {
  documentElement: makeEl('html', ''),
  visibilityState: 'visible',
  getElementById: (id) => { if (!registry.has(id)) registry.set(id, makeEl('div', id)); return registry.get(id); },
  querySelectorAll: (sel) => {
    if (sel === '.screen') return [...registry.values()].filter((e) => e._cls.has('screen'));
    return [];
  },
  querySelector: (sel) => {
    if (sel === '.screen.active') {
      for (const e of registry.values()) if (e._cls.has('screen') && e._cls.has('active')) return e;
      return null;
    }
    if (sel[0] === '#') { const id = sel.split(' ')[0].slice(1); return sandbox.document.getElementById(id); }
    return makeEl('div', '');
  },
  createElement: (tg) => makeEl(tg, ''),
  createTextNode: (tx) => ({ _isText: true, nodeValue: String(tx), children: [], parentNode: null }),
  createDocumentFragment: () => ({ _frag: true, children: [], appendChild(c) { this.children.push(c); return c; } }),
  addEventListener: () => {},
  removeEventListener: () => {},
};
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.window.scrollTo = (...a) => { scrollCalls.push(a); };
sandbox.window.scrollY = 0;
sandbox.window.matchMedia = () => ({ matches: false });
sandbox.window.location = { reload() {} };
vm.createContext(sandbox);

// ---------- seed content cache from REAL data files (same mapping as toInternal) ----------
function toInternal(setId, sq, idx) {
  if (!sq || typeof sq.id !== 'string' || !sq.id) return null;
  if (typeof sq.question !== 'string' || !sq.question.trim()) return null;
  if (!Array.isArray(sq.options) || sq.options.length !== 4) return null;
  if (sq.correct !== 0 && sq.correct !== 1 && sq.correct !== 2 && sq.correct !== 3) return null;
  return {
    id: sq.id, setId,
    category: (typeof sq.category === 'string' && sq.category.trim()) ? sq.category.trim() : null,
    q: sq.question, o: sq.options.slice(), c: sq.correct, e: sq.explanation || '',
    order: (idx + 1) * 10,
  };
}
const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
const sets = catalog.sets.filter((s) => s.published !== false);
const questionsBySet = {};
sets.forEach((s) => {
  const doc = JSON.parse(fs.readFileSync('data/' + s.file, 'utf8'));
  questionsBySet[s.id] = doc.questions.map((q, i) => toInternal(s.id, q, i)).filter(Boolean);
});
sandbox.localStorage.setItem('ldd_cache_v2', JSON.stringify({
  catalogVersion: catalog.version, sets, questionsBySet, syncedAt: Date.now(),
}));
const keyOf = (q) => q.setId + ':' + q.id;
const LETTERS = ['A', 'B', 'C', 'D'];

// ---------- load the real app ----------
try {
  vm.runInContext(fs.readFileSync('js/store.js', 'utf8'), sandbox, { filename: 'store.js' });
  vm.runInContext(fs.readFileSync('js/app.js', 'utf8'), sandbox, { filename: 'app.js' });
  t('app boots without exception', true);
} catch (e) {
  t('app boots without exception', false, e && e.stack);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}
const $ = (id) => sandbox.document.getElementById(id);
const activeScreen = () => {
  for (const e of registry.values()) if (e._cls.has('screen') && e._cls.has('active')) return e.id;
  return null;
};
const cards = () => $('view-list').querySelectorAll('.view-card');
const cardKeys = () => cards().map((c) => c.getAttribute('data-key'));
// Note: each card's star button carries the same data-key (delegation), so
// attribute queries match card + button — compare against cards only.
const cardByKey = (key) => cards().filter((c) => c.getAttribute('data-key') === key);
function drainBatches() {
  let guard = 0;
  while ($('view-load-more').style.display !== 'none' && guard++ < 20) sandbox.viewLoadMore();
}
const Ldd = sandbox.LddStore;

(async () => {
  // ---- 1. Home -> 80-question set (would throw TypeError on the old bug) ----
  try {
    sandbox.startView('kdbds-2023');
    await sleep(180);
  } catch (e) { t('startView(80) throws no exception', false, e && e.stack); }
  t('startView(80) throws no exception', true);
  t('view screen becomes active', activeScreen() === 'screen-view', activeScreen());
  t('first batch renders ~20 cards', cards().length === 20, 'got ' + cards().length);
  t('view-position counter mentions 80', /80/.test($('view-position').textContent), $('view-position').textContent);
  t('topic filter hidden for 80-set', $('view-topic-filter').hidden === true);

  // ---- 2. Scroll to end: all 80, order + answers match JSON ----
  drainBatches();
  const list80 = questionsBySet['kdbds-2023'];
  t('all 80 cards reachable', cards().length === 80, 'got ' + cards().length);
  t('keys unique + in original order', JSON.stringify(cardKeys()) === JSON.stringify(list80.map(keyOf)));
  let ansOk = true, expOk = true, fourOk = true, oneCorrectOk = true;
  cards().forEach((c, i) => {
    const q = list80[i];
    const opts = c.querySelectorAll('.opt');
    const texts = c.querySelectorAll('.otext');
    if (opts.length !== 4 || texts.length !== 4) { fourOk = false; }
    else {
      for (let k = 0; k < 4; k++) {
        if (texts[k].textContent !== q.o[k]) ansOk = false;
      }
    }
    const corrects = c.querySelectorAll('.opt.correct');
    if (corrects.length !== 1) { oneCorrectOk = false; }
    else {
      const otext = corrects[0].querySelector('.otext');
      const letter = corrects[0].querySelector('.letter');
      if (!otext || otext.textContent !== q.o[q.c]) ansOk = false;
      if (!letter || letter.textContent !== LETTERS[q.c]) ansOk = false;
      const aria = corrects[0].getAttribute('aria-label') || '';
      if (aria.indexOf('Đáp án đúng') !== 0) ansOk = false;
    }
    const hasExp = c.querySelectorAll('.feedback').length > 0;
    if (hasExp !== (typeof q.e === 'string' && !!q.e.trim())) expOk = false;
  });
  t('every card shows all 4 options verbatim in A-D order', ansOk && fourOk);
  t('every card marks exactly one .correct at options[correct]', oneCorrectOk);
  t('explanation only when data has it (79/80)', expOk);
  t('load-more hides at end', $('view-load-more').style.display === 'none');

  // ---- 3. 111-set + topic filter counts ----
  sandbox.startView('chuyen-de-4-7-9-10');
  await sleep(180);
  t('topic filter visible for 111-set', $('view-topic-filter').hidden === false);
  t('filter offers 5 options', $('view-topic-select').children.length === 5, 'got ' + $('view-topic-select').children.length);
  const list111 = questionsBySet['chuyen-de-4-7-9-10'];
  const topicCount = (id) => list111.filter((q) => new RegExp('^Chuyên đề ' + id + ' ·').test(q.category || '')).length;
  sandbox.changeViewTopic('4'); drainBatches();
  t('topic 4 renders 20 in order', cards().length === 20 && topicCount('4') === 20 &&
    JSON.stringify(cardKeys()) === JSON.stringify(list111.filter((q) => /^Chuyên đề 4 ·/.test(q.category || '')).map(keyOf)));
  sandbox.changeViewTopic('9'); drainBatches();
  t('topic 9 renders 25', cards().length === 25 && topicCount('9') === 25);
  sandbox.changeViewTopic('all'); drainBatches();
  t('back to all renders 111', cards().length === 111, 'got ' + cards().length);

  // ---- 4. Deep user-chosen destination scrolls to its anchor (search/star only) ----
  const deep = list111[list111.length - 1];
  sandbox.__scrolled = null;
  sandbox.openViewAt(deep.setId, deep.id, { type: 'search', query: 'x', scroll: 0 });
  await sleep(180);
  const anchor = cardByKey(keyOf(deep));
  t('deep question card present in DOM', anchor.length === 1);
  t('user-chosen destination scrolled into view once', sandbox.__scrolled === keyOf(deep), String(sandbox.__scrolled));
  sandbox.exitView();

  // ---- 4b. Home entry always starts at Q1 and never anchor-scrolls ----
  const mid = list80[30];
  Ldd.setViewPos({ 'kdbds-2023': keyOf(mid) }); // stale saved position must be ignored
  sandbox.__scrolled = null;
  scrollCalls.length = 0;
  sandbox.startView('kdbds-2023');
  await sleep(180);
  t('home opens at Q1 despite saved position', cardKeys()[0] === keyOf(list80[0]), String(cardKeys()[0]));
  t('home entry performs no anchor scroll', sandbox.__scrolled === null, String(sandbox.__scrolled));

  // ---- 5. Per-card stars are independent, no list rebuild ----
  const k1 = keyOf(list80[0]), k2 = keyOf(list80[1]);
  const before = cards().length;
  sandbox.toggleViewCardStar(k1, null);
  sandbox.toggleViewCardStar(k2, null);
  let stars = Ldd.getStars();
  t('two stars stored', stars.includes(k1) && stars.includes(k2), JSON.stringify(stars));
  sandbox.toggleViewCardStar(k1, null);
  stars = Ldd.getStars();
  t('untoggle removes only its own key', !stars.includes(k1) && stars.includes(k2));
  t('star taps do not rebuild the list', cards().length === before, 'was ' + before + ' now ' + cards().length);
  // DOM-level aria on a real card button
  sandbox.openViewAt('kdbds-2023', list80[2].id, { type: 'home', setId: 'kdbds-2023' });
  await sleep(180);
  const firstCard = $('view-list').querySelector('.view-card');
  const starBtn = firstCard.querySelector('.view-star-btn');
  const skey = starBtn.getAttribute('data-key');
  const pressedBefore = starBtn.getAttribute('aria-pressed');
  sandbox.toggleViewCardStar(skey, starBtn);
  t('card button flips aria-pressed + label', starBtn.getAttribute('aria-pressed') !== pressedBefore &&
    /Đã lưu|Lưu câu/.test(starBtn.querySelector('.view-star-label').textContent));
  sandbox.toggleViewCardStar(skey, starBtn); // restore

  // ---- 6. Search origin: exact card + back restores query ----
  const q0 = list80[10];
  sandbox.openViewAt(q0.setId, q0.id, { type: 'search', query: 'bao hiem', scroll: 123 });
  await sleep(180);
  t('search origin shows the exact card', cardByKey(keyOf(q0)).length === 1);
  sandbox.exitView();
  t('back returns to search screen', activeScreen() === 'screen-search', activeScreen());
  t('search query restored', $('search-input').value === 'bao hiem', $('search-input').value);

  // ---- 7. Star origin: exact card + back returns to saved list ----
  sandbox.toggleViewCardStar(k2, null); // ensure starred (k2 already starred; toggle twice to keep)
  sandbox.toggleViewCardStar(k2, null);
  sandbox.toggleViewCardStar(k2, null);
  const sq = list80[5];
  if (!Ldd.getStars().includes(keyOf(sq))) sandbox.toggleViewCardStar(keyOf(sq), null);
  sandbox.openViewAt(sq.setId, sq.id, { type: 'star', setId: null, scroll: 0 });
  await sleep(180);
  t('star origin shows the exact card', cardByKey(keyOf(sq)).length === 1);
  sandbox.exitView();
  t('back returns to saved list', activeScreen() === 'screen-list', activeScreen());

  // ---- 8. Read-only isolation: session/wrong/history untouched ----
  const snap = JSON.stringify({ s: Ldd.getSession(), w: Ldd.getWrong(), h: Ldd.getHistory() });
  sandbox.startView('kdbds-2023'); await sleep(150);
  drainBatches();
  sandbox.changeViewTopic('all'); drainBatches();
  sandbox.openViewAt(q0.setId, q0.id, { type: 'search', query: 'x', scroll: 0 }); await sleep(150);
  sandbox.exitView();
  // reset stars touched above
  Ldd.setStars([]);
  const snap2 = JSON.stringify({ s: Ldd.getSession(), w: Ldd.getWrong(), h: Ldd.getHistory() });
  t('review never touches session/wrong/history', snap === snap2);

  // ---- 9. Home reopen ignores the saved per-set position (starts at Q1) ----
  const mid2 = list80[30];
  sandbox.openViewAt(mid2.setId, mid2.id, { type: 'search', query: 'q', scroll: 0 });
  await sleep(180);
  sandbox.exitView();
  const saved = (Ldd.getViewPos() || {})['kdbds-2023'];
  sandbox.__scrolled = null;
  sandbox.startView('kdbds-2023');
  await sleep(180);
  t('home starts at Q1 even with a saved key', !!saved && cardKeys()[0] === keyOf(list80[0]),
    'saved=' + String(saved) + ' first=' + String(cardKeys()[0]));
  t('home reopen performs no anchor scroll', sandbox.__scrolled === null, String(sandbox.__scrolled));

  // ---- 10. Combined-answer card: A and C readable, only D marked correct ----
  sandbox.startView('chuyen-de-4-7-9-10');
  await sleep(180);
  drainBatches();
  const comboId = 'chuyen-de-4-7-9-10:fe3bd3cd-6a58-492f-98d7-192a682736ac';
  const combo = cardByKey(comboId);
  let comboOk = combo.length === 1;
  if (comboOk) {
    const src = questionsBySet['chuyen-de-4-7-9-10'].find((x) => keyOf(x) === comboId);
    comboOk = !!src && src.c === 3;
    const ts = combo[0].querySelectorAll('.otext');
    const cs = combo[0].querySelectorAll('.opt.correct');
    comboOk = comboOk && ts.length === 4 &&
      ts[0].textContent === src.o[0] && ts[2].textContent === src.o[2] &&
      cs.length === 1 && cs[0].querySelector('.otext').textContent === src.o[3];
  }
  t('combo card shows A..D, only D marked correct', comboOk);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL: harness error ' + (e && e.stack)); process.exit(1); });
