// Browser layout regression tests for the continuous-scroll answer view.
// Run: node tools/run_layout_tests.js
// Drives a real headless Chromium (Chrome/Edge) over CDP: serves this repo
// over local HTTP, opens Xem đáp án on mobile viewports, scrolls through
// every progressive batch, switches topic filters + text sizes, performs
// horizontal touch swipes, and asserts no horizontal overflow.
// If no Chromium executable is found the suite prints SKIP (NOT TESTED).
// Exit codes: 0 = all PASS (or SKIP), 1 = at least one FAIL.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const cp = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8137 + (process.pid % 100);
const CDP_PORT = 19222 + (process.pid % 100);
const AUDIT_SRC = fs.readFileSync(path.join(ROOT, 'tools', 'audit_layout.js'), 'utf8');
const DUMP = process.env.LAYOUT_DUMP || null;

let pass = 0, fail = 0, skipped = false;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('ok: ' + name); }
  else { fail++; console.log('FAIL: ' + name + (extra ? ' -- ' + extra : '')); }
}
function skip(msg) { skipped = true; console.log('SKIP (NOT TESTED): ' + msg); }

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
  try {
    const w = cp.execSync('where chrome 2>NUL || where msedge 2>NUL', { encoding: 'utf8' });
    const first = w.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  } catch (e) {}
  return null;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
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
  const r = await cdpSend(ws, ++msgId, 'Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: !!awaitPromise,
  });
  if (r.result && r.result.result && r.result.result.type === 'object' && r.result.result.subtype === 'error') {
    return { __threw: String((r.result.result.description || 'error')).slice(0, 300) };
  }
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = findChrome();
  if (!chrome) { skip('no Chromium executable found'); process.exit(0); }
  const srv = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'layout-test-'));
  const proc = cp.spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', '--no-sandbox', '--disable-features=OverscrollHistoryNavigation',
    '--user-data-dir=' + profile,
    '--remote-debugging-port=' + CDP_PORT, '--remote-allow-origins=*', 'about:blank',
  ], { stdio: 'ignore' });
  const errors = [];
  let ws = null;
  try {
    // Wait for CDP endpoint.
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
    const onMsg = (evt) => {
      try {
        const m = JSON.parse(String(evt.data));
        if (m.method === 'Runtime.consoleAPICalled' && m.params && m.params.type === 'error') {
          errors.push('console.error: ' + JSON.stringify(m.params.args).slice(0, 200));
        }
        if (m.method === 'Runtime.exceptionThrown') {
          errors.push('exception: ' + String(m.params.exceptionDetails.text || m.params.exceptionDetails).slice(0, 200));
        }
        if (m.method === 'Log.entryAdded' && m.params && m.params.entry && m.params.entry.level === 'error') {
          errors.push('log.error: ' + String(m.params.entry.text).slice(0, 200));
        }
      } catch (e) {}
    };
    ws.addEventListener('message', onMsg);
    await cdpSend(ws, ++msgId, 'Runtime.enable');
    await cdpSend(ws, ++msgId, 'Log.enable');

    // Expected counts straight from the shipped data (never hardcoded key answers).
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/catalog.json'), 'utf8'));
    const setIds = catalog.sets.filter((s) => s.published !== false).map((s) => s.id);
    const counts = {};
    for (const s of catalog.sets) {
      if (s.published === false) continue;
      const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', s.file), 'utf8'));
      counts[s.id] = (d.questions || []).length;
    }

    const MEASURE = `function(label){
      const de=document.documentElement, b=document.body;
      const out={label, innerWidth:window.innerWidth, scrollX:Math.round(window.scrollX*10)/10,
        deSW:de.scrollWidth, bodySW:b.scrollWidth,
        cards:document.querySelectorAll('#view-list .view-card').length,
        pos:(document.getElementById('view-position')||{}).textContent||''};
      const bad=[];
      const sels=['#app','#screen-view','.body','#view-list','.view-card','.view-card-head','.qtext','.options','.opt','.otext','.feedback','.topbar','.bottom-actions'];
      sels.forEach(function(sel){
        document.querySelectorAll(sel).forEach(function(el){
          if(el.offsetParent===null && sel!=='.bottom-actions') return;
          const r=el.getBoundingClientRect();
          if(r.right>window.innerWidth+1||r.left<-1){
            bad.push(sel+' L'+Math.round(r.left)+' R'+Math.round(r.right)+' W'+Math.round(r.width));
            if(bad.length>12) return;
          }
        });
      });
      out.bad=bad;
      return out;
    }`;

    async function setViewport(w, h) {
      await cdpSend(ws, ++msgId, 'Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 2, mobile: true,
      });
    }
    async function goto() {
      await cdpSend(ws, ++msgId, 'Page.enable');
      await cdpSend(ws, ++msgId, 'Page.navigate', { url: 'http://127.0.0.1:' + PORT + '/index.html' });
      for (let i = 0; i < 75; i++) {
        await sleep(200);
        const n = await ev(ws, `(function(){var s=document.getElementById('home-set-select');return s&&s.options?s.options.length:0})()`);
        if (n >= 2) break;
      }
      await ev(ws, AUDIT_SRC); // defines window.auditLayout (read-only diagnostic)
    }
    async function dump(label) {
      if (!DUMP) return;
      try {
        await ev(ws, AUDIT_SRC); // re-define (emulation switches can reset page context)
        const data = await ev(ws, `auditLayout(${JSON.stringify(label)})`);
        fs.mkdirSync(DUMP, { recursive: true });
        fs.writeFileSync(path.join(DUMP, label + '.json'), JSON.stringify(data));
        const n = data && data.outside ? data.outside.length : '?';
        console.log(`dump: ${label} (outside suspects: ${n})`);
      } catch (e) { console.log('dump failed: ' + label); }
    }
    async function openSet(setId) {
      await ev(ws, `(function(){var s=document.getElementById('home-set-select');s.value='${setId}';s.dispatchEvent(new Event('change'));})()`);
      await sleep(300);
      // selectHomeSet is wired via inline onchange; call directly if change event did not fire it.
      await ev(ws, `(function(){try{if(typeof selectHomeSet==='function'&&window.__selSet!=='${setId}'){selectHomeSet('${setId}');}window.__selSet='${setId}';}catch(e){}})()`);
      await ev(ws, `startSelectedView()`);
      await sleep(800);
    }
    async function scrollAllBatches() {
      for (let i = 0; i < 30; i++) {
        const done = await ev(ws, `(function(){
          var cards=document.querySelectorAll('#view-list .view-card').length;
          var pos=(document.getElementById('view-position')||{textContent:''}).textContent;
          var m=/(\\d+)\\s*câu/.exec(pos); var total=m?parseInt(m[1],10):0;
          if(total&&cards>=total) return true;
          window.scrollBy(0,3000);
          try{if(typeof viewLoadMore==='function')viewLoadMore();}catch(e){}
          return false;
        })()`);
        await sleep(250);
        if (done) break;
      }
    }
    async function swipe(dx) {
      // Horizontal touch swipe at mid-screen via trusted CDP touch events.
      // Kept clear of the extreme edges so the OS/browser back gesture zone
      // is never triggered (history navigation is disabled too).
      const y = 400, x0 = dx < 0 ? 330 : 60, x1 = dx < 0 ? 60 : 330;
      await cdpSend(ws, ++msgId, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
      for (let i = 1; i <= 8; i++) {
        await cdpSend(ws, ++msgId, 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y }] });
        await sleep(15);
      }
      await cdpSend(ws, ++msgId, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(400);
    }

    for (const vp of [390, 320, 375, 430]) {
      await goto();
      await setViewport(vp, 844);
      await sleep(500);
      const vpCheck = await ev(ws, `({iw:window.innerWidth,ih:window.innerHeight,css:document.styleSheets.length})`);
      t(`vp${vp}: emulation active (${vp}x844)`, vpCheck && vpCheck.iw === vp && vpCheck.ih === 844, JSON.stringify(vpCheck));
      const setId = (vp === 390 || vp === 375) ? 'kdbds-2023' : 'chuyen-de-4-7-9-10';
      const total = counts[setId];
      if (vp === 390) await dump('S0-home-390');
      await openSet(setId);
      await dump(`S2-view-open-${vp}`);
      const m0 = await ev(ws, `(${MEASURE})('open ${vp}')`);
      t(`vp${vp}: no doc overflow on open (deSW ${m0.deSW} <= iw ${m0.innerWidth})`, m0.deSW <= m0.innerWidth, JSON.stringify(m0).slice(0, 300));
      t(`vp${vp}: no element rect outside viewport on open`, m0.bad.length === 0, m0.bad.slice(0, 3).join(' | '));
      await scrollAllBatches();
      await dump(`S4-full-${vp}`);
      const m1 = await ev(ws, `(${MEASURE})('full ${vp}')`);
      t(`vp${vp}: all ${total} cards rendered`, m1.cards === total, 'got ' + m1.cards);
      t(`vp${vp}: no doc overflow at end (deSW ${m1.deSW})`, m1.deSW <= m1.innerWidth, JSON.stringify(m1.bad.slice(0, 3)));
      t(`vp${vp}: no element rect outside viewport at end`, m1.bad.length === 0, m1.bad.slice(0, 3).join(' | '));
      await swipe(-290);
      const m2 = await ev(ws, `(${MEASURE})('swipeL ${vp}')`);
      t(`vp${vp}: still on answer view after swipe`, m2.cards === total && /Đã hiển thị/.test(m2.pos), JSON.stringify(m2).slice(0, 200));
      t(`vp${vp}: left-swipe leaves scrollX==0`, m2.scrollX === 0, 'scrollX=' + m2.scrollX);
      t(`vp${vp}: no overflow after left-swipe`, m2.deSW <= m2.innerWidth && m2.bad.length === 0, 'scrollX=' + m2.scrollX + ' bad=' + m2.bad.slice(0, 2).join('|'));
      await swipe(290);
      await dump(`S7-post-swipe-${vp}`);
      const m3 = await ev(ws, `(${MEASURE})('swipeR ${vp}')`);
      t(`vp${vp}: still on answer view after 2nd swipe`, m3.cards === total, JSON.stringify(m3).slice(0, 200));
      t(`vp${vp}: right-swipe leaves scrollX==0`, m3.scrollX === 0, 'scrollX=' + m3.scrollX);
      if (process.env.LAYOUT_DEBUG) {
        const dbg = await ev(ws, `(function(){
          var act=document.querySelector('.screen.active'); var card=document.querySelector('#view-list .view-card');
          var r=card?card.getBoundingClientRect():null;
          return {active:act&&act.id, cards:document.querySelectorAll('#view-list .view-card').length,
            cardRect:r?{t:Math.round(r.top),h:Math.round(r.height)}:null,
            cardDisplay:card?getComputedStyle(card).display:'?',
            vv:window.visualViewport?{w:window.visualViewport.width,h:window.visualViewport.height,s:window.visualViewport.scale}:null,
            dpr:window.devicePixelRatio, pos:(document.getElementById('view-position')||{}).textContent};
        })()`);
        console.log('DEBUG ' + vp + ': ' + JSON.stringify(dbg));
        const shot = await cdpSend(ws, ++msgId, 'Page.captureScreenshot', { format: 'png' });
        if (shot.result && shot.result.data) {
          fs.writeFileSync(process.env.LAYOUT_DEBUG + '-shot-' + vp + '.png', Buffer.from(shot.result.data, 'base64'));
        }
      }
      // Vertical scroll still works (allow the smooth animation to settle).
      await ev(ws, `window.scrollTo(0,0)`);
      await sleep(700);
      const yDbg = await ev(ws, `(async function(){window.scrollTo(0,0);await new Promise(function(r){setTimeout(r,700)});var y0=window.scrollY;var sh=document.documentElement.scrollHeight;var ih=window.innerHeight;window.scrollBy(0,500);await new Promise(function(r){setTimeout(r,700)});return {y0:y0,sh:sh,ih:ih,y1:window.scrollY}})()`, true);
      t(`vp${vp}: vertical scroll works`, yDbg && yDbg.y1 > yDbg.y0, JSON.stringify(yDbg));
    }

    // Text size Rất lớn + topic filter on the 111-question set at 390px.
    await setViewport(390, 844);
    await goto();
    await ev(ws, `setTextSize('xlarge')`);
    await sleep(300);
    await openSet('chuyen-de-4-7-9-10');
    await scrollAllBatches();
    const mx = await ev(ws, `(${MEASURE})('xlarge full')`);
    await dump('S6-xlarge-full');
    t(`xlarge: 111 cards rendered`, mx.cards === 111, 'got ' + mx.cards);
    t(`xlarge: no doc overflow`, mx.deSW <= mx.innerWidth, 'deSW=' + mx.deSW);
    t(`xlarge: no element rect outside viewport`, mx.bad.length === 0, mx.bad.slice(0, 3).join(' | '));
    await ev(ws, `changeViewTopic('4')`);
    await sleep(600);
    await scrollAllBatches();
    const mf = await ev(ws, `(${MEASURE})('filter4')`);
    const expect4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chuyen-de-4-7-9-10.json'), 'utf8')).questions.filter((q) => /^Chuyên đề 4(?: ·|$)/.test(q.category || '')).length;
    t(`filter Chuyên đề 4 renders ${expect4} cards`, mf.cards === expect4, 'got ' + mf.cards + ' pos=' + mf.pos);
    t(`filter: no overflow`, mf.deSW <= mf.innerWidth && mf.bad.length === 0, JSON.stringify(mf).slice(0, 250));
    // Star tap must not move scroll or rebuild the list.
    const star = await ev(ws, `(function(){
      var y0=window.scrollY, n0=document.querySelectorAll('#view-list .view-card').length;
      var b=document.querySelector('#view-list .view-star-btn'); if(b)b.click();
      return {dy:window.scrollY-y0, n:document.querySelectorAll('#view-list .view-card').length, n0:n0};
    })()`);
    await sleep(400);
    const star2 = await ev(ws, `({y:window.scrollY,n:document.querySelectorAll('#view-list .view-card').length})`);
    t('star tap keeps card count', star && star2.n === star.n0, JSON.stringify(star));
    t('star tap does not jump scroll', star && Math.abs(star.dy) < 2 && Math.abs(star2.y - (star.y0 || star2.y)) < 60, JSON.stringify(star));
    // Back returns home.
    await ev(ws, `exitView()`);
    await sleep(400);
    const home = await ev(ws, `!!document.getElementById('screen-home').classList.contains('active')`);
    t('exitView returns home', home === true);

    // ---------- UX-002: viewing must not touch session/wrong/history/prefs/cache ----------
    const snapKeys = ['ldd_session_v1', 'ldd_wrong_v2', 'ldd_history_v1', 'ldd_prefs_v1', 'ldd_cache_v2', 'ldd_stars_v2'];
    const snapExpr = `(function(){var o={};${JSON.stringify(snapKeys)}.forEach(function(k){o[k]=localStorage.getItem(k)});return o})()`;
    await goto();
    await setViewport(390, 844);
    await sleep(400);
    const snap0 = await ev(ws, snapExpr);
    await openSet('kdbds-2023');
    await scrollAllBatches();
    await ev(ws, `exitView()`);
    await sleep(600); // let the 400ms view-scroll debounce fire while view is inactive
    const snap1 = await ev(ws, snapExpr);
    const snapDiff = snapKeys.filter((k) => snap0[k] !== snap1[k]);
    t('view flow leaves session/wrong/history/prefs/cache/stars untouched', snapDiff.length === 0, snapDiff.join(','));

    // ---------- UX-003: topic filter keeps the reading card, or restarts cleanly ----------
    const cdData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chuyen-de-4-7-9-10.json'), 'utf8')).questions;
    const count7 = cdData.filter((q) => /^Chuyên đề 7(?: ·|$)/.test(q.category || '')).length;
    const count9 = cdData.filter((q) => /^Chuyên đề 9(?: ·|$)/.test(q.category || '')).length;
    await openSet('chuyen-de-4-7-9-10');
    await ev(ws, `(function(){
      var cache=LddStore.getCache();
      var cards=document.querySelectorAll('#view-list .view-card');
      var n=0;
      for(var i=0;i<cards.length;i++){
        var q=LddStore.questionById(cache,cards[i].getAttribute('data-key'));
        if(q&&/^Chuyên đề 7(?: ·|$)/.test(q.category||'')){ n++; if(n===3){cards[i].scrollIntoView();return;} }
      }
    })()`);
    await sleep(1000);
    await ev(ws, `changeViewTopic('7')`);
    await sleep(1200);
    const keep = await ev(ws, `(function(){
      var topTop=null,topCat=null;
      var cache=LddStore.getCache();
      document.querySelectorAll('#view-list .view-card').forEach(function(c){
        var r=c.getBoundingClientRect();
        if(r.top<=140){ topTop=Math.round(r.top); var q=LddStore.questionById(cache,c.getAttribute('data-key')); topCat=q&&q.category; }
      });
      return {pos:document.getElementById('view-position').textContent,cards:document.querySelectorAll('#view-list .view-card').length,y:window.scrollY,top:topTop,cat:topCat};
    })()`);
    t(`filter keeps topic-7 scope (${count7} cards)`, keep.cards === count7 && /Chuyên đề 7/.test(keep.pos), JSON.stringify(keep).slice(0, 250));
    t('filter keeps the card being read (no jump to top)', keep.y > 200 && /^Chuyên đề 7/.test(keep.cat || ''), JSON.stringify(keep).slice(0, 250));
    await ev(ws, `changeViewTopic('9')`);
    await sleep(1200);
    await scrollAllBatches(); // progressive rendering: first batch is 20 of 25
    await dump('S5-filter9');
    const drop = await ev(ws, `({pos:document.getElementById('view-position').textContent,cards:document.querySelectorAll('#view-list .view-card').length,y:window.scrollY})`);
    t(`filter restarts cleanly outside scope (${count9} cards)`, drop.cards === count9 && /Chuyên đề 9/.test(drop.pos), JSON.stringify(drop).slice(0, 200));
    const dropTop = await ev(ws, `(function(){var c=document.querySelector('#view-list .view-card');return c?Math.round(c.getBoundingClientRect().top):null})()`);
    t('filter restart lands near the top of the new scope', dropTop !== null && dropTop < 600, 'firstCardTop=' + dropTop);

    // ---------- UX-004: search origin lands on the chosen card; back is clean ----------
    const midQ = cdData[Math.floor(cdData.length / 2)].id;
    await ev(ws, `openViewAt('chuyen-de-4-7-9-10',${JSON.stringify(midQ)},{type:'search',query:'kinh doanh',scroll:200})`);
    await sleep(1400);
    const anch = await ev(ws, `(function(){var c=document.querySelector(${JSON.stringify('[data-key="chuyen-de-4-7-9-10:' + midQ + '"]')});if(!c)return null;return {top:Math.round(c.getBoundingClientRect().top)};})()`);
    t('search origin lands on the chosen card', anch && anch.top > -10 && anch.top < 600, JSON.stringify(anch));
    await ev(ws, `exitView()`);
    // show('search') restores the saved scroll while html{scroll-behavior:smooth}
    // animates it, so poll until scrollY settles before asserting anything.
    const settled = await ev(ws, `(async function(){
      var last=-1,stable=0,y=window.scrollY;
      for(var i=0;i<20;i++){ y=window.scrollY; if(y===last){stable++; if(stable>=3) break;} else {stable=0; last=y;} await new Promise(function(r){setTimeout(r,250)}); }
      return y;
    })()`, true);
    const back = await ev(ws, `({search:document.getElementById('screen-search').classList.contains('active'),q:document.getElementById('search-input').value,y:window.scrollY})`);
    t('back returns to search with query kept', back.search && /kinh doanh/.test(back.q), JSON.stringify(back));
    t('back restores the saved search scroll', Math.abs(settled - 200) < 60, 'settled=' + settled);
    await sleep(700);
    const backY = await ev(ws, `window.scrollY`);
    t('no stray timer scroll after back', Math.abs(backY - settled) < 2, settled + ' -> ' + backY);

    // ---------- UX-005: appending batches must not move the reading card ----------
    await ev(ws, `exitViewToHome()`);
    await sleep(300);
    await openSet('kdbds-2023');
    const stab = await ev(ws, `(function(){
      var cards=document.querySelectorAll('#view-list .view-card');
      if(cards.length<12) return null;
      var el=cards[10]; var r0=el.getBoundingClientRect().top; var y0=window.scrollY;
      viewLoadMore(); viewLoadMore();
      return {dr:Math.round(el.getBoundingClientRect().top-r0),dy:window.scrollY-y0,n:document.querySelectorAll('#view-list .view-card').length};
    })()`);
    t('appending batches does not move the reading card', stab && Math.abs(stab.dr) <= 2 && stab.dy === 0, JSON.stringify(stab));

    // ---------- UX-007: touch targets, landscape, desktop ----------
    await ev(ws, `exitViewToHome()`);
    await sleep(300);
    await ev(ws, `setTextSize('large')`);
    await sleep(200);
    const hitsHome = await ev(ws, `(function(){
      var out=[];
      document.querySelectorAll('.screen.active .btn,.screen.active .chip,.screen.active .switch,.screen.active .mode-row,.screen.active .tool-row,.screen.active .topbar .back,.screen.active .ts-btn').forEach(function(el){
        var r=el.getBoundingClientRect(); if(r.height<1) return;
        out.push(Math.round(r.height));
      });
      return out;
    })()`);
    t(`home touch targets >=44px (${hitsHome.length} controls)`, hitsHome.length > 5 && hitsHome.every((h) => h >= 44), String(Math.min.apply(null, hitsHome)));
    await ev(ws, `setTextSize('xlarge')`);
    await sleep(200);
    await openSet('kdbds-2023');
    const hitsView = await ev(ws, `(function(){
      var out=[];
      document.querySelectorAll('.screen.active .btn,.screen.active .topbar .back,.screen.active .view-star-btn').forEach(function(el){
        var r=el.getBoundingClientRect(); if(r.height<1) return;
        out.push(Math.round(r.height));
      });
      return out;
    })()`);
    t(`xlarge view touch targets >=44px (${hitsView.length} controls)`, hitsView.length > 5 && hitsView.every((h) => h >= 44), String(Math.min.apply(null, hitsView)));
    await ev(ws, `exitViewToHome()`);
    await setViewport(844, 390);
    await sleep(400);
    await openSet('kdbds-2023');
    await scrollAllBatches();
    const mland = await ev(ws, `(${MEASURE})('landscape')`);
    t('landscape 844x390: full list, no overflow', mland.cards === 80 && mland.deSW <= mland.innerWidth && mland.bad.length === 0, JSON.stringify(mland).slice(0, 250));
    await setViewport(1440, 900);
    await goto();
    await sleep(400);
    await openSet('chuyen-de-4-7-9-10');
    await scrollAllBatches();
    const mdesk = await ev(ws, `(${MEASURE})('desktop')`);
    await dump('S9-desktop-end');
    t('desktop 1440: full list, no overflow', mdesk.cards === 111 && mdesk.deSW <= mdesk.innerWidth, JSON.stringify(mdesk.bad.slice(0, 2)));
    await setViewport(768, 1024);
    await goto();
    await sleep(400);
    await openSet('kdbds-2023');
    await scrollAllBatches();
    const m768 = await ev(ws, `(${MEASURE})('tablet768')`);
    t('tablet 768: full list, no overflow', m768.cards === 80 && m768.deSW <= m768.innerWidth && m768.bad.length === 0, JSON.stringify(m768).slice(0, 250));

    t('no console/page errors during layout flow', errors.length === 0, errors.slice(0, 4).join(' || '));
    console.log(`\nlayout: ${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    srv.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
}
main().catch((e) => { console.error('layout harness error: ' + (e && e.message)); process.exit(1); });
