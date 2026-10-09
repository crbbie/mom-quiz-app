// Wrong/history delete management — EXECUTION tests with a minimal DOM shim.
// Run: node tools/run_delete_tests.js
// Loads the REAL js/store.js + js/app.js + data/*.json in a vm sandbox and
// drives openList/deleteWrongKey/confirmClearWrong/deleteHistoryAt/
// confirmClearHistory, including modal cancel vs confirm paths.
const fs = require('fs');
const vm = require('vm');

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' -- ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- minimal DOM (same contract as run_view_scroll_tests.js) ----------
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
  el.scrollIntoView = () => {};
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

const sandbox = {
  console, setTimeout, clearTimeout, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise,
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
sandbox.window.scrollTo = () => {};
sandbox.window.scrollY = 0;
sandbox.window.matchMedia = () => ({ matches: false });
sandbox.window.location = { reload() {} };
vm.createContext(sandbox);

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
const Ldd = sandbox.LddStore;
const listRows = () => $('list-content').querySelectorAll('.list-row');
const histRows = () => $('hist-content').querySelectorAll('.hist-row');
// Static source guard: bulk deletes must target single keys, never wipe storage.
const appSrc = fs.readFileSync('js/app.js', 'utf8');
t('no localStorage.clear() anywhere', appSrc.indexOf('localStorage.clear') < 0);

(async () => {
  const setA = sets[0].id, setB = sets[1].id;
  const qA1 = questionsBySet[setA][0], qA2 = questionsBySet[setA][1];
  const qB1 = questionsBySet[setB][0];
  // Seed: 2 wrong in A, 1 wrong in B; 1 star; a kept session.
  Ldd.setWrong([keyOf(qA1), keyOf(qA2), keyOf(qB1)]);
  Ldd.setStars([keyOf(qA1)]);
  Ldd.setSession({ v: 2, kind: 'study', setId: setA, keys: [keyOf(qA1)], idx: 0, answers: [-1] });
  const sessionBefore = JSON.stringify(Ldd.getSession());

  // ---- 1. Scoped wrong list renders rows with separate delete buttons ----
  sandbox.openList('wrong', setA);
  t('scoped wrong list shows 2 rows', listRows().length === 2, 'got ' + listRows().length);
  t('row has sibling open + delete (not nested)',
    listRows().every((r) => r.querySelectorAll('.list-open').length === 1 && r.querySelectorAll('.icon-del').length === 1));
  t('delete buttons expose accessible names',
    listRows().every((r) => (r.querySelector('.icon-del').getAttribute('aria-label') || '').indexOf('Xóa câu sai') === 0));

  // ---- 2. Delete one wrong key: only that key goes ----
  sandbox.deleteWrongKey(keyOf(qA1));
  const w1 = Ldd.getWrong();
  t('single delete removes exactly its key', w1.length === 2 && !w1.includes(keyOf(qA1)) && w1.includes(keyOf(qA2)) && w1.includes(keyOf(qB1)));
  t('list re-renders same scope (1 row left)', listRows().length === 1);
  t('source question untouched', !!Ldd.questionById(Ldd.getCache(), keyOf(qA1)));
  t('session slot untouched by wrong delete', JSON.stringify(Ldd.getSession()) === sessionBefore);
  t('stars untouched by wrong delete', JSON.stringify(Ldd.getStars()) === JSON.stringify([keyOf(qA1)]));

  // ---- 3. Scoped clear: cancel writes nothing, confirm keeps other set ----
  const wBeforeCancel = JSON.stringify(Ldd.getWrong());
  sandbox.confirmClearWrong(setA);
  t('clear dialog states scope + count', /1 câu sai/.test($('modal-msg').textContent), $('modal-msg').textContent);
  $('modal-cancel').onclick(); // Hủy
  t('cancel writes nothing', JSON.stringify(Ldd.getWrong()) === wBeforeCancel);
  sandbox.confirmClearWrong(setA);
  $('modal-danger').onclick(); // confirm
  const w2 = Ldd.getWrong();
  t('scoped clear keeps other set', JSON.stringify(w2) === JSON.stringify([keyOf(qB1)]), JSON.stringify(w2));
  t('dialog dismissed after confirm (no second dialog)', $('modal-overlay').hidden === true);
  t('empty scope renders empty state', listRows().length === 0 && $('list-content').innerHTML.indexOf('empty-state') >= 0);

  // ---- 4. Global clear ----
  Ldd.setWrong([keyOf(qA2), keyOf(qB1)]);
  sandbox.openList('wrong');
  sandbox.confirmClearWrong(null);
  t('global dialog states total count', /2 câu sai/.test($('modal-msg').textContent), $('modal-msg').textContent);
  $('modal-safe').onclick(); // Giữ lại
  t('safe choice writes nothing', Ldd.getWrong().length === 2);
  sandbox.confirmClearWrong(null);
  $('modal-danger').onclick();
  t('global clear empties wrong only', Ldd.getWrong().length === 0);

  // ---- 5. History: duplicate records, delete exactly one by position ----
  const dup = { type: 'Ôn tập', setId: setA, score: 5, total: 10, date: 1234567890 };
  Ldd.setHistory([]);
  Ldd.pushHistory(Object.assign({}, dup));
  Ldd.pushHistory(Object.assign({}, dup));
  t('two identical history records stored', Ldd.getHistory().length === 2);
  sandbox.show('history');
  t('history renders 2 rows with per-row delete', histRows().length === 2 &&
    histRows().every((r) => r.querySelectorAll('.icon-del').length === 1));
  const second = JSON.stringify(Ldd.getHistory()[1]);
  sandbox.deleteHistoryAt(0);
  const h1 = Ldd.getHistory();
  t('position delete removes exactly one duplicate', h1.length === 1 && JSON.stringify(h1[0]) === second);
  t('history rows re-render (1 left)', histRows().length === 1);

  // ---- 6. History clear: cancel keeps, confirm empties only history ----
  Ldd.pushHistory(Object.assign({}, dup));
  const hBefore = JSON.stringify(Ldd.getHistory());
  sandbox.show('history');
  sandbox.confirmClearHistory();
  t('history dialog states count', /2 bản ghi/.test($('modal-msg').textContent), $('modal-msg').textContent);
  $('modal-cancel').onclick();
  t('history cancel writes nothing', JSON.stringify(Ldd.getHistory()) === hBefore);
  sandbox.confirmClearHistory();
  $('modal-danger').onclick();
  t('history clear empties history only', Ldd.getHistory().length === 0);
  t('history empty state shown, actions hidden',
    $('hist-content').innerHTML.indexOf('empty-state') >= 0 && $('hist-actions').children.length === 0);
  t('wrong/stars/session survive history ops',
    Ldd.getWrong().length === 0 && Ldd.getStars().length === 1 && JSON.stringify(Ldd.getSession()) === sessionBefore);

  // ---- 7. Star list keeps its own behavior (no delete buttons) ----
  sandbox.openList('star');
  t('star list has no delete controls', $('list-content').querySelectorAll('.icon-del').length === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL: harness error ' + (e && e.stack)); process.exit(1); });
