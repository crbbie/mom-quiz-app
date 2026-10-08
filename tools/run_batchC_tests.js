// BATCH C regression: service-worker atomic-shell update consistency.
// Run: node tools/run_batchC_tests.js
// Verifies the Batch C root-cause fix: navigations must be cache-first so
// HTML+JS+CSS always load as one atomic per-version shell, never mixed.
const fs = require('fs');
const sw = fs.readFileSync('sw.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok: ' + name); } else { fail++; console.log('FAIL: ' + name); } }
function navBlock() {
  const i = sw.indexOf("event.request.mode === 'navigate'");
  if (i < 0) return '';
  // scope to the navigate branch only (ends at the first "return;" + close)
  const end = sw.indexOf('return;\n  }', i);
  return sw.slice(i, end >= 0 ? end : i + 900);
}
function installBlock() {
  const i = sw.indexOf("addEventListener('install'");
  if (i < 0) return '';
  return sw.slice(i, sw.indexOf('});', i) + 3);
}
const nav = navBlock();

t('navigate handler exists', nav.length > 0);
t('navigations served from cache first (atomic shell)', /caches\.match\(['"]\.\/index\.html['"]\)\.then\(function \(hit\) \{\s*if \(hit\) return hit;/.test(nav));
t('no network-first HTML (fetch-then-cache-fallback gone)', nav.indexOf('fetch(event.request).then(function (res)') < 0);
t('first visit still reaches network when nothing cached', nav.indexOf('return fetch(event.request)') >= 0);
t('shell cache versioned per APP_VERSION', sw.indexOf("SHELL_CACHE = 'onthi-shell-' + APP_VERSION") >= 0);
t('install has no auto skipWaiting call', installBlock().indexOf('skipWaiting()') < 0);
t('failed precache fails install (no catch-skip)', (() => {
  const b = installBlock();
  return b.indexOf('c.addAll(SHELL)') >= 0 && b.indexOf('.catch') < 0;
})());
t('activate deletes old shell caches', sw.indexOf("k.indexOf('onthi-shell-') === 0 && k !== SHELL_CACHE") >= 0);
t('activation only via explicit SKIP_WAITING message', sw.indexOf("type === 'SKIP_WAITING'") >= 0);
t('content data stays network-first (freshness unaffected)', sw.indexOf('isDataRequest(url)') >= 0 && sw.indexOf('c.put(dataKey(event.request), copy)') >= 0);
t('explicit Cap nhat path kept (applyAppUpdate)', app.indexOf('window.applyAppUpdate') >= 0);
t('update persists session before activating worker', bodyHas(app, 'window.applyAppUpdate', 'persistSession()'));
t('reload deferred during active session (no wipe)', bodyHas(app, 'controllerchange', 'sessionActive()'));

function bodyHas(src, marker, needle) {
  const i = src.indexOf(marker);
  if (i < 0) return false;
  return src.slice(i, i + 900).indexOf(needle) >= 0;
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
