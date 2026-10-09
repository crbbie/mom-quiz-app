// Session-safety + update-detection regression tests.
// Run: node tools/run_session_safety_tests.js
// User-approved behavior: starting a new quiz replaces an unfinished quiz immediately;
// Resume still restores it, and explicit Home discard still confirms. Reload,
// review isolation, and content updates preserve their prior safeguards.
// updates are detected/announced safely without touching sessions.
const fs = require('fs');
const app = fs.readFileSync('js/app.js', 'utf8');
const storeSrc = fs.readFileSync('js/store.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name); }
}

function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  const start = src.indexOf('{', i);
  let depth = 0;
  for (let j = start; j < src.length; j++) {
    if (src[j] === '{') depth++;
    if (src[j] === '}') { depth--; if (!depth) return src.slice(start, j + 1); }
  }
  return '';
}

// ---------- 1. Exactly ONE interrupting dialog when an unfinished session exists ----------
{
  const guard = fnBody(app, 'function guardReplaceSession');
  t('guard checks saved session', guard.includes('keptSession()'));
  t('guard offers resume', guard.includes('window.resumeSession()'));
  t('guard offers cancel', (guard.match(/onCancel/g) || []).length >= 2);
  t('guard opens first dialog', guard.includes('showModal'));
  t('new session begins directly from first dialog choice', (guard.match(/onDanger: function \(\) \{ proceed\(\); \}/g) || []).length === 2);
  t('no second replacement confirmation', !guard.includes('confirmDiscardThenStart'));
  t('no stored session starts immediately', guard.includes('if (!kept) { proceed(); return; }'));
  t('resume card remains available', app.includes('data-act="resume"') && app.includes('window.resumeSession();'));
  t('home discard still confirms', app.slice(app.indexOf('window.discardSession = function'), app.indexOf('window.discardSession = function') + 700).includes('showModal'));
  t('no unrelated storage mutation from guard', !/(setStars|setWrong|pushHistory)/.test(guard));
}

// ---------- 5. reload / Safari restart / PWA reopen restores the EXACT session ----------
{
  // Eval the pure snapshot helpers straight from app.js (no DOM needed).
  const getFn = (name) => {
    const i = app.indexOf('function ' + name + '(');
    const start = app.indexOf('{', i);
    let depth = 0;
    for (let j = start; j < app.length; j++) {
      if (app[j] === '{') depth++;
      if (app[j] === '}') { depth--; if (!depth) return app.slice(i, j + 1); }
    }
    return '';
  };
  const sandbox = {};
  // eslint-disable-next-line no-new-func
  new Function(getFn('snapshotList') + ';' + getFn('restoreList') + ';' + getFn('validSnapshot') + ';return {snapshotList,restoreList,validSnapshot};')();
  const fns = new Function(getFn('snapshotList') + ';' + getFn('restoreList') + ';' + getFn('validSnapshot') + ';return {snapshotList:snapshotList,restoreList:restoreList,validSnapshot:validSnapshot};')();
  const displayed = [
    { id: 'q1', setId: 's', q: 'Q1?', o: ['d', 'c', 'b', 'a'], c: 3, e: 'exp1', category: null },
    { id: 'q2', setId: 's', q: 'Q2?', o: ['x', 'y', 'z', 'w'], c: 1, e: '', category: 'Cat' }
  ];
  const answers = [3, 0];
  const snap = fns.snapshotList(displayed);
  const restored = fns.restoreList(JSON.parse(JSON.stringify(snap)));
  t('snapshot preserves exact displayed option order', restored[0].o.join('|') === 'd|c|b|a');
  t('snapshot preserves correct mapping', restored[0].c === 3 && restored[1].c === 1);
  t('snapshot preserves explanation+category', restored[0].e === 'exp1' && restored[1].category === 'Cat');
  t('snapshots validate before restore', snap.every(fns.validSnapshot));
  const score = (a, l) => l.reduce((n, q, i) => n + (a[i] === q.c ? 1 : 0), 0);
  t('score identical after reload-restore', score(answers, displayed) === score(answers, restored));
  t('persist on visibility hidden + pagehide (restart-safe)', app.indexOf("visibilityState === 'hidden') persistSession") >= 0 || (app.indexOf('visibilitychange') >= 0 && app.indexOf("'pagehide'") >= 0));

  // Storage-level survival: write session, then read it back through a fresh
  // store over the SAME backing (models Safari restart / PWA reopen).
  const backing = {};
  const mkStore = () => {
    const ls = {
      getItem: k => (k in backing ? backing[k] : null),
      setItem: (k, v) => { backing[k] = String(v); },
      removeItem: k => { delete backing[k]; }
    };
    return new Function('window', 'localStorage', storeSrc + '; return window.LddStore;')({}, ls);
  };
  const S1 = mkStore();
  const session = { v: 2, kind: 'study', setId: 's', keys: ['s:q1', 's:q2'], idx: 1, answers: [3, -1], list: snap };
  S1.setSession(session);
  const S2 = mkStore(); // "after restart"
  const back = S2.getSession();
  t('stored session survives restart unchanged', JSON.stringify(back) === JSON.stringify(session));
  t('exam deadline is absolute (survives background)', app.indexOf('endsAt - Date.now()') >= 0);
}

// ---------- 6. answer review never modifies the active session ----------
{
  // Strip comments so the "deliberately no persistSession()" isolation note
  // does not count as a call.
  const viewBlock = app.slice(app.indexOf('function openViewAt'), app.indexOf('function openViewAt') + 900).replace(/\/\/[^\n]*/g, '');
  t('viewing never persists a session', viewBlock.indexOf('persistSession') < 0 && viewBlock.indexOf('setSession') < 0);
  t('viewing never clears a session', viewBlock.indexOf('clearSession') < 0);
  const ret = fnBody(app, 'function returnToOrigin');
  t('transient review return never clears stored session', ret.indexOf('clearSession') < 0);
  const p = fnBody(app, 'function persistSession');
  t('transient reviews persist nothing', p.indexOf('!study.transient') >= 0);
  t('stars/wrong/history semantics kept (composite keys)', app.indexOf("LddStore.key(q.setId, q.id)") >= 0 || app.indexOf('qkey(q)') >= 0);
}

// ---------- 7. real update detection ----------
{
  const f = fnBody(app, 'function fetchFresh');
  t('fresh fetch busts cache (query + no-store)', f.indexOf('?v=') >= 0 || f.indexOf("'v='") >= 0 || f.indexOf('"v="') >= 0 || f.indexOf('v=') >= 0);
  t('fresh fetch bypasses HTTP cache', f.indexOf('no-store') >= 0);
  t('remote catalog version compared to installed', app.indexOf('catalog.version !== cache.catalogVersion') >= 0);
  t('per-set versions compared (download only what changed)', app.indexOf('old.version === s.version') >= 0);
  t('update notice only when data actually changed', app.indexOf("Đã cập nhật dữ liệu mới") >= 0 && app.indexOf('if (changed)') >= 0);
  t('manual update path kept', app.indexOf('window.manualSync') >= 0);
  // Unchanged check: the only toast in the no-change branch is the manual
  // confirmation ("manual taps get feedback; automatic quiet checks stay quiet").
  const elseBlock = app.slice(app.indexOf('if (changed)'), app.indexOf('if (changed)') + 900).split('} else {')[1] || '';
  const bareToast = (elseBlock.replace(/if\s*\(\s*manual\s*\)\s*toast\(/g, '').match(/toast\(/g) || []).length;
  t('unchanged auto-check stays quiet (no toast)', elseBlock.indexOf("if (manual) toast('Dữ liệu đã mới nhất')") >= 0 && bareToast === 0);
  t('mid-session update defers notice to home', app.indexOf('pendingDataUpdate') >= 0);
  t('rechecks when app becomes active (visible)', app.indexOf("visibilityState === 'visible'") >= 0);
  t('rechecks on focus + pageshow + online', app.indexOf("'focus'") >= 0 && app.indexOf("'pageshow'") >= 0 && app.indexOf("'online'") >= 0);
  t('checks throttled, manual bypasses', app.indexOf('SYNC_THROTTLE_MS') >= 0 && app.indexOf('lastSyncAt') >= 0 && app.indexOf('syncInProgress') >= 0);
  t('errors/offline retry promptly (throttle reset)', app.indexOf('lastSyncAt = 0') >= 0);
}

// ---------- 8. updates never delete sessions; ID/order/content changes are safe ----------
{
  const s = fnBody(app, 'async function syncContent');
  t('content sync never clears the session slot', s.indexOf('clearSession') < 0);
  t('partial failure keeps old catalog version (retry)', s.indexOf('failures.length ? cache.catalogVersion') >= 0);
  t('partial failure keeps old content', s.indexOf('usableMeta.push(old)') >= 0);
  // Behavioral: prune drops only dead refs, history snapshots survive.
  const mem = {};
  const ls = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const S = new Function('window', 'localStorage', storeSrc + '; return window.LddStore;')({}, ls);
  S.setCache(1, [{ id: 's' }], { s: [{ id: 'q2', setId: 's' }] });
  S.setStars(['s:q1', 's:q2']);
  S.pushHistory({ type: 'Ôn tập', setId: 's', score: 1, total: 2, date: 1 });
  const before = JSON.stringify(S.getSession());
  S.pruneStaleIds(S.getCache());
  t('removed IDs pruned from stars, survivors kept', JSON.stringify(S.getStars()) === JSON.stringify(['s:q2']));
  t('history snapshots kept across content change', S.getHistory().length === 1);
  t('session slot untouched by prune', JSON.stringify(S.getSession()) === before);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
