// P0 transition regression tests: Home -> Xem đáp án must land cleanly with
// NO swipe/scroll. Captures T0 (pre-open) .. T4 (+500ms) around show('view')
// and renderView, asserting single-active-screen lifecycle, in-viewport
// rects, no horizontal offset, and first-card A/B/C/D integrity.
// The T1 seam (post-show, pre-render) is captured by wrapping window.scrollTo,
// which show() calls immediately before openViewAt() runs renderView().
// Run: node tools/run_transition_tests.js
// Needs headless Chromium (Chrome/Edge); otherwise SKIP (NOT TESTED).
// Exit codes: 0 = all PASS (or SKIP), 1 = at least one FAIL.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8237 + (process.pid % 100);
const CDP_PORT = 19322 + (process.pid % 100);

let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' -- ' + extra : '')); }
}
function skip(msg) { console.log('SKIP (NOT TESTED): ' + msg); }

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let url = decodeURIComponent(req.url.split('?')[0]);
      if (url === '/') url = '/index.html';
      const fp = path.normalize(path.join(ROOT, url));
      if (!fp.startsWith(ROOT) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end('no'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      fs.createReadStream(fp).pipe(res);
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

function cdpSend(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeEventListener('message', onmsg); reject(new Error('cdp timeout ' + method)); }, 20000);
    const onmsg = (evt) => {
      try {
        const m = JSON.parse(String(evt.data));
        if (m.id === id) { clearTimeout(timer); ws.removeEventListener('message', onmsg); resolve(m); }
      } catch (e) {}
    };
    ws.addEventListener('message', onmsg);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
}
let msgId = 0;
async function ev(ws, expr, awaitPromise) {
  const r = await cdpSend(ws, ++msgId, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: !!awaitPromise });
  if (r.result && r.result.result && r.result.result.type === 'object' && r.result.result.subtype === 'error') {
    return { __threw: String(r.result.result.description || 'error').slice(0, 300) };
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read-only transition snapshot (page context). T0..T4 milestones.
const SNAP_SRC = `
function reviewTransitionSnapshot(label) {
  var rect = function (el) { return el ? el.getBoundingClientRect().toJSON() : null; };
  var css = function (el) {
    if (!el) return null;
    var s = getComputedStyle(el);
    return { display: s.display, visibility: s.visibility, position: s.position,
      left: s.left, right: s.right, width: s.width, minWidth: s.minWidth,
      maxWidth: s.maxWidth, marginLeft: s.marginLeft, marginRight: s.marginRight,
      overflowX: s.overflowX, transform: s.transform, translate: s.translate,
      transition: s.transition, animation: s.animation, zIndex: s.zIndex };
  };
  var item = function (el) {
    return el && ({ id: el.id || null,
      className: (typeof el.className === 'string') ? el.className : null,
      rect: rect(el), clientWidth: el.clientWidth, scrollWidth: el.scrollWidth,
      scrollLeft: el.scrollLeft, css: css(el) });
  };
  var ancestors = function (el) {
    var result = [];
    for (var p = el ? el.parentElement : null; p; p = p.parentElement) result.push(item(p));
    return result;
  };
  var app = document.querySelector('#app');
  var home = document.querySelector('#screen-home');
  var view = document.querySelector('#screen-view');
  var list = document.querySelector('#view-list');
  var topbar = view ? view.querySelector('.topbar') : null;
  var firstCard = list ? list.querySelector('.view-card') : null;
  var probe = (function () {
    var x = Math.round(window.innerWidth / 2), y = 100;
    var el = document.elementFromPoint(x, y);
    return { x: x, y: y,
      inView: !!(el && el.closest && el.closest('#screen-view')),
      inHome: !!(el && el.closest && el.closest('#screen-home')),
      tag: el ? (el.id ? '#' + el.id : el.tagName.toLowerCase()) : null };
  })();
  var cards = list ? list.querySelectorAll('.view-card') : [];
  var firstOpts = firstCard ? firstCard.querySelectorAll('.opt').length : 0;
  var firstCorrect = firstCard ? firstCard.querySelectorAll('.opt.correct').length : 0;
  return { label: label, at: Math.round(performance.now()),
    innerWidth: window.innerWidth, innerHeight: window.innerHeight,
    scrollX: window.scrollX, scrollY: window.scrollY,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyClientWidth: document.body.clientWidth, bodyScrollWidth: document.body.scrollWidth,
    activeScreenIds: Array.prototype.map.call(document.querySelectorAll('.screen.active'), function (el) { return el.id; }),
    app: item(app), home: item(home), view: item(view), list: item(list),
    topbar: item(topbar), firstCard: item(firstCard),
    viewAncestors: ancestors(view), listAncestors: ancestors(list),
    renderedCards: cards.length, firstOpts: firstOpts, firstCorrect: firstCorrect, probe: probe };
}`;

async function main() {
  const chrome = findChrome();
  if (!chrome) { skip('no Chromium executable found'); process.exit(0); }
  const srv = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'transition-test-'));
  const proc = cp.spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', '--no-sandbox', '--disable-features=OverscrollHistoryNavigation',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', 'about:blank',
  ], { stdio: 'ignore' });
  const errors = [];
  let ws = null;
  try {
    let tabs = null;
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      try {
        const res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json');
        const list = await res.json();
        tabs = list.filter((x) => x.type === 'page');
        if (tabs.length) break;
      } catch (e) {}
    }
    if (!tabs || !tabs.length) { skip('CDP endpoint unreachable'); process.exit(0); }
    ws = new WebSocket(tabs[0].webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    ws.addEventListener('message', (evt) => {
      try {
        const m = JSON.parse(String(evt.data));
        if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
          errors.push('console.error: ' + JSON.stringify(m.params.args).slice(0, 200));
        }
        if (m.method === 'Runtime.exceptionThrown') {
          errors.push('exception: ' + String((m.params.exceptionDetails && m.params.exceptionDetails.text) || '?').slice(0, 200));
        }
      } catch (e) {}
    });
    await cdpSend(ws, ++msgId, 'Runtime.enable');

    async function setViewport(w, h) {
      await cdpSend(ws, ++msgId, 'Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    }
    async function gotoHome() {
      await cdpSend(ws, ++msgId, 'Page.enable');
      await cdpSend(ws, ++msgId, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
      for (let i = 0; i < 75; i++) {
        await sleep(200);
        const n = await ev(ws, `(function(){var s=document.getElementById('home-set-select');return s&&s.options?s.options.length:0})()`);
        if (n >= 2) break;
      }
    }
    // (Re-)defines reviewTransitionSnapshot: emulation switches can reset page context.
    async function snap(label, useRaf) {
      await ev(ws, SNAP_SRC);
      if (useRaf) {
        return ev(ws, `(new Promise(function (res) { requestAnimationFrame(function () { res(reviewTransitionSnapshot(${JSON.stringify(label)})); }); }))`, true);
      }
      return ev(ws, `reviewTransitionSnapshot(${JSON.stringify(label)})`);
    }
    function isSnap(s) { return !!(s && !s.__threw && s.label && Array.isArray(s.activeScreenIds)); }
    function checkSnap(s, tag, needCards) {
      const iw = s.innerWidth;
      const single = s.activeScreenIds.length === 1 && s.activeScreenIds[0] === 'screen-view';
      t(`${tag}: only #screen-view active`, single, JSON.stringify(s.activeScreenIds));
      t(`${tag}: home display:none`, s.home && s.home.css && s.home.css.display === 'none', s.home && s.home.css && s.home.css.display);
      const appOk = s.app && s.app.rect && s.app.rect.left >= -1 && s.app.rect.right <= iw + 1;
      t(`${tag}: #app rect fits viewport (L${Math.round(s.app.rect.left)} R${Math.round(s.app.rect.right)} iw${iw})`, appOk);
      const viewOk = s.view && s.view.rect && s.view.rect.left >= -1 && s.view.rect.right <= iw + 1;
      t(`${tag}: #screen-view rect fits viewport`, viewOk, s.view && s.view.rect && ('L' + Math.round(s.view.rect.left) + ' R' + Math.round(s.view.rect.right)));
      t(`${tag}: no document horizontal overflow`, s.documentScrollWidth <= s.documentClientWidth + 1, `sw${s.documentScrollWidth} cw${s.documentClientWidth}`);
      t(`${tag}: scrollX~=0`, Math.abs(s.scrollX) <= 1, 'scrollX=' + s.scrollX);
      t(`${tag}: header probe hits view, not home`, s.probe && s.probe.inView && !s.probe.inHome, JSON.stringify(s.probe));
      if (needCards) {
        t(`${tag}: first batch rendered`, s.renderedCards >= 20, 'cards=' + s.renderedCards);
        const fc = s.firstCard && s.firstCard.rect;
        const fcOk = fc && fc.left >= -1 && fc.right <= iw + 1;
        t(`${tag}: first card fits viewport horizontally`, fcOk, fc && ('L' + Math.round(fc.left) + ' R' + Math.round(fc.right)));
        t(`${tag}: first card shows 4 options, exactly 1 correct`, s.firstOpts === 4 && s.firstCorrect === 1, `opts=${s.firstOpts} correct=${s.firstCorrect}`);
      }
    }

    async function runFlow(tag, font, withSession) {
      await gotoHome();
      await setViewport(390, 844);
      await sleep(500);
      await ev(ws, `setTextSize(${JSON.stringify(font)})`);
      await sleep(200);
      if (withSession) {
        // A stale session from an earlier flow would raise the one-step
        // start-new modal (by design it blocks touch UI). Mirror the user
        // path: discard it via the resume-card action, then plant fresh.
        await ev(ws, `if(typeof discardStudy==='function'){try{discardStudy();}catch(e){}}`);
        await sleep(300);
        await ev(ws, `if(!document.getElementById('modal-overlay').hidden && typeof hideModal==='function'){hideModal();}`);
        await ev(ws, `(function(){var s=document.getElementById('home-set-select');s.value='kdbds-2023';s.dispatchEvent(new Event('change'));})()`);
        await sleep(300);
        await ev(ws, `startSelectedStudy()`);
        await sleep(800);
        const answered = await ev(ws, `(function(){
          var o=document.querySelector('#study-opts .opt'); if(!o) return 'no-opts';
          o.click(); return 'clicked';
        })()`);
        await sleep(500);
        const fb = await ev(ws, `!!document.querySelector('#study-feedback .feedback')`);
        t(`${tag}: planted unfinished study (answered=${answered}, feedback=${fb})`, answered === 'clicked' && fb === true);
        await ev(ws, `exitStudy()`);
        await sleep(500);
        const sess = await ev(ws, `!!localStorage.getItem('ldd_session_v1')`);
        t(`${tag}: session kept after exitStudy`, sess === true);
      }
      // Select the 111-question set, then open Xem đáp án with NO swipe/scroll.
      // A blocking modal (if any) is dismissed first, mirroring touch reality
      // where the overlay intercepts every tap until the user chooses.
      await ev(ws, `if(!document.getElementById('modal-overlay').hidden && typeof hideModal==='function'){hideModal();}`);
      await sleep(200);
      await ev(ws, `(function(){var s=document.getElementById('home-set-select');s.value='chuyen-de-4-7-9-10';s.dispatchEvent(new Event('change'));if(typeof selectHomeSet==='function'){try{selectHomeSet('chuyen-de-4-7-9-10');}catch(e){}}})()`);
      await sleep(300);
      const modalShut = await ev(ws, `!!document.getElementById('modal-overlay').hidden`);
      t(`${tag}: no modal overlay at open`, modalShut === true);
      const T0 = await snap('T0');
      t(`${tag}: T0 snapshot captured`, isSnap(T0), JSON.stringify(T0).slice(0, 160));
      if (isSnap(T0)) t(`${tag}: T0 starts on home`, T0.activeScreenIds.length === 1 && T0.activeScreenIds[0] === 'screen-home', JSON.stringify(T0.activeScreenIds));
      else t(`${tag}: T0 starts on home`, false, 'no snapshot');
      // Install the T1 seam, then open.
      await ev(ws, SNAP_SRC);
      await ev(ws, `(function(){
        window.__T = {};
        window.__scrollOrig = window.scrollTo.bind(window);
        var n = 0;
        window.scrollTo = function () {
          var r = window.__scrollOrig.apply(null, arguments);
          if (n++ === 0) { try { window.__T.T1 = reviewTransitionSnapshot('T1'); } catch (e) { window.__T.T1err = String(e); } }
          return r;
        };
      })()`);
      await ev(ws, `startSelectedView()`);
      const T1 = await ev(ws, `window.__T.T1 || window.__T.T1err || null`);
      await ev(ws, `window.scrollTo = window.__scrollOrig;`);
      t(`${tag}: T1 captured post-show pre-render`, isSnap(T1), JSON.stringify(T1).slice(0, 160));
      if (isSnap(T1)) checkSnap(T1, `${tag} T1`, false);
      const T2 = await snap('T2');
      if (isSnap(T2)) checkSnap(T2, `${tag} T2`, true);
      else t(`${tag} T2: snapshot captured`, false, JSON.stringify(T2).slice(0, 160));
      const T3 = await snap('T3', true);
      if (isSnap(T3)) checkSnap(T3, `${tag} T3`, true);
      else t(`${tag} T3: snapshot captured`, false, JSON.stringify(T3).slice(0, 160));
      await sleep(600);
      const T4 = await snap('T4');
      if (isSnap(T4)) checkSnap(T4, `${tag} T4`, true);
      else t(`${tag} T4: snapshot captured`, false, JSON.stringify(T4).slice(0, 160));
      if (isSnap(T2) && isSnap(T4)) {
        t(`${tag}: stable T2->T4 (cards ${T2.renderedCards}->${T4.renderedCards}, y ${Math.round(T2.scrollY)}->${Math.round(T4.scrollY)})`,
          T4.renderedCards >= T2.renderedCards && Math.abs(T4.scrollY - T2.scrollY) < 4,
          `cards ${T2.renderedCards}->${T4.renderedCards} y ${T2.scrollY}->${T4.scrollY}`);
      } else {
        t(`${tag}: stable T2->T4`, false, 'missing snapshots');
      }
      const DUMP = process.env.LAYOUT_DUMP || null;
      if (DUMP) {
        try {
          fs.mkdirSync(DUMP, { recursive: true });
          [T0, T1, T2, T3, T4].forEach((s, i) => {
            if (s && s.label) fs.writeFileSync(path.join(DUMP, `${tag}-T${i}.json`), JSON.stringify(s));
          });
          console.log('dump: ' + tag);
        } catch (e) {}
      }
      await ev(ws, `exitViewToHome()`);
      await sleep(300);
    }

    await runFlow('large-clean', 'large', false);
    await runFlow('xlarge-clean', 'xlarge', false);
    await runFlow('large-session', 'large', true);
    await runFlow('xlarge-session', 'xlarge', true);

    t('no console/page errors during transition flows', errors.length === 0, errors.slice(0, 4).join(' || '));
    console.log(`\ntransition: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    srv.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch((e) => { console.error('transition harness error: ' + (e && e.message)); process.exit(1); });
