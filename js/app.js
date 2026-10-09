/* Learner app: multi-set study + exam, offline-first.
 * Content is static: data/catalog.json + data/*.json ship with the deploy.
 * Personal progress is device-local, keyed by "setId:questionId" (never by
 * array position), so reorder/add/remove of questions cannot corrupt it. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var LETTERS = ['A', 'B', 'C', 'D'];

  var cache = LddStore.getCache();
  var activeSetId = null;

  var study = { list: [], idx: 0, answers: [], transient: false, origin: null };
  var exam = { list: [], idx: 0, answers: [], timeLeft: 0, totalTime: 0, endsAt: 0, timerId: null, submitted: false };
  // Batch E: read-only answer viewing. Fully separate from quiz state —
  // viewing never touches study/exam answers, wrong membership, history or
  // the unfinished-session slot. Only the per-set view position (its own
  // storage slot) plus explicit star taps may change.
  var view = { active: false, setId: null, list: [], idx: 0, origin: null, topic: 'all' };
  // Batch B §3: result context recorded at finish (study is cleared there),
  // so "Ôn lại" can retry the still-wrong scope instead of the full set.
  var lastResult = null;
  // Batch 3 §3.6: origin context for single-question reviews
  // { type:'wrong'|'star'|'search', query?:string } + scroll memory.
  var lastSearchQuery = '';
  var lastListScroll = 0;
  var lastSearchScroll = 0;
  // DOM-independent session tracking (B7): 'study' | 'exam' | null.
  // persistSession() uses this, never screen visibility, so start/answer/nav
  // always save even before show() runs.
  var activeKind = null;
  // Stitch Home §D: accordion state (UI-only, in-memory). Exactly one set
  // card expanded at a time; null = first set. Never persisted, never a
  // session — opening/closing changes no data.
  var openAccId = null;

  // Update-detection throttle: automatic checks (open / visible / focus /
  // online) run at most once per window; manual taps always bypass.
  // syncInProgress prevents overlapping fetches. pendingDataUpdate defers
  // the "new data" notice when an update lands mid-session so the learner
  // is told on return home instead of being interrupted mid-quiz.
  var SYNC_THROTTLE_MS = 5 * 60 * 1000;
  var lastSyncAt = 0;
  var syncInProgress = false;
  var pendingDataUpdate = false;

  /* ---------- helpers ---------- */
  function shuffle(a) {
    var arr = a.slice();
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  // Batch 4 §4.3: Vietnamese accent-insensitive normalization for SEARCH ONLY.
  // Unicode NFD → strip combining marks → đ/Đ → d/D → lowercase.
  // Displayed source text is never mutated.
  function normalizeVi(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();
  }
  window.normalizeVi = normalizeVi;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function fmtTime(s) {
    var m = Math.floor(s / 60), ss = s % 60;
    return m + 'p' + String(ss).padStart(2, '0') + 's';
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString('vi-VN') + ' · ' + d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
  }
  function setOf(id) {
    for (var i = 0; i < cache.sets.length; i++) if (cache.sets[i].id === id) return cache.sets[i];
    return null;
  }
  function setTitleOf(id) {
    var s = setOf(id);
    return s ? s.title : 'Bộ đề';
  }
  function sessionActive() {
    return ($('screen-study') && $('screen-study').classList.contains('active') && study.list.length > 0) ||
           ($('screen-exam') && $('screen-exam').classList.contains('active') && exam.list.length > 0);
  }
  // Batch B §1: never silently replace an unfinished session. Returns the
  // kept session when one with real content exists, else null.
  function keptSession() {
    try {
      var s = LddStore.getSession();
      var keys = sessionKeys(s);
      if (s && keys && keys.length) return s;
    } catch (e) {}
    return null;
  }
  function describeSession(s) {
    var keys = sessionKeys(s) || [];
    var total = keys.length;
    var pos = Math.min((s.idx || 0) + 1, total);
    var mode = s.kind === 'exam' ? 'Thi thử' : (s.isWrongReview ? 'Ôn câu sai' : 'Ôn tập');
    return setTitleOf(s.setId) + ' · ' + mode + ' · Câu ' + pos + ' / ' + total;
  }
  function sameStudySession(s, setId, isWrong, wrongScope) {
    if (!s || s.kind !== 'study') return false;
    if ((s.setId || null) !== (setId || null)) return false;
    if (!!s.isWrongReview !== !!isWrong) return false;
    if ((s.wrongSetId || null) !== (wrongScope || null)) return false;
    return true;
  }
  // Keep the existing session intact until a separate discard confirmation.
  function sameExamSession(s, setId) {
    return !!s && s.kind === 'exam' && s.setId === setId;
  }
  function confirmDiscardThenStart(desc, proceed) {
    showModal({
      title: 'Bỏ bài cũ và bắt đầu mới?',
      msg: 'Bài đang làm dở (' + desc + ') sẽ bị xóa. Bạn có chắc chắn muốn bỏ bài này?',
      progress: sessionProgress(keptSession()),
      safeLabel: 'Giữ lại bài cũ',
      dangerLabel: 'Bỏ bài cũ, bắt đầu mới',
      onSafe: function () {},
      onDanger: proceed
    });
  }
  function guardReplaceSession(kind, setId, isWrong, wrongScope, proceed) {
    var kept = keptSession();
    if (!kept) { proceed(); return; }
    var same = (kind === 'study' && sameStudySession(kept, setId, isWrong, wrongScope)) ||
               (kind === 'exam' && sameExamSession(kept, setId));
    showModal({
      title: same ? 'Bài này đang làm dở?' : 'Bài đang làm dở?',
      msg: 'Bạn đang làm dở: ' + describeSession(kept) +
        (same ? '. Bạn muốn tiếp tục hay làm lại từ đầu?' : '. Muốn làm bài mới, bạn cần bỏ bài này.'),
      progress: sessionProgress(kept),
      safeLabel: 'Tiếp tục bài đang làm',
      dangerLabel: same ? 'Làm lại từ đầu' : 'Bỏ bài cũ, bắt đầu mới',
      onSafe: function () { window.resumeSession(); },
      onDanger: function () { confirmDiscardThenStart(describeSession(kept), proceed); }
    });
  }
  // Display-only helper: real position/total of a kept session for the
  // Stitch-style progress card/modal. No session data is created or changed.
  function sessionProgress(s) {
    try {
      var keys = sessionKeys(s) || [];
      if (!keys.length) return null;
      var pos = Math.min((s.idx || 0) + 1, keys.length);
      return { pos: pos, total: keys.length, label: 'Câu ' + pos + ' / ' + keys.length };
    } catch (e) { return null; }
  }

  // ---- session snapshot helpers (B1): persist the EXACT displayed option
  // order/permutation so resume restores same text + same correct mapping.
  // Snapshots are plain JSON; old key-only sessions still restore via keys.
  function snapshotList(list) {
    return list.map(function (q) {
      return { id: q.id, setId: q.setId, q: q.q, o: q.o.slice(), c: q.c, e: q.e || '', category: q.category || null };
    });
  }
  function restoreList(snaps) {
    return snaps.map(function (s, i) {
      return { id: s.id, setId: s.setId, q: s.q, o: s.o.slice(), c: s.c, e: s.e || '', category: s.category || null, order: (i + 1) * 10 };
    });
  }
  function validSnapshot(s) {
    return s && typeof s.id === 'string' && typeof s.setId === 'string' &&
      typeof s.q === 'string' && Array.isArray(s.o) && s.o.length === 4 &&
      (s.c === 0 || s.c === 1 || s.c === 2 || s.c === 3);
  }

  // ---- study scoring (B2): one answer record per question, totals derived.
  function recountStudy() {
    var ok = 0, no = 0;
    for (var i = 0; i < study.list.length; i++) {
      var a = study.answers[i];
      if (a === undefined || a < 0) continue;
      if (a === study.list[i].c) ok++; else no++;
    }
    return { ok: ok, no: no };
  }

  // ---- exam timer (B6): absolute deadline; remaining always derived.
  function examRemaining() {
    if (exam.endsAt) return Math.max(0, Math.round((exam.endsAt - Date.now()) / 1000));
    return Math.max(0, exam.timeLeft | 0);
  }

  window.show = show;
  // Batch 2 §9: semantic switch — real <button role="switch"> with
  // programmatic state (aria-checked mirrors .on).
  window.toggleSwitch = function (el) {
    el.classList.toggle('on');
    el.setAttribute('aria-checked', el.classList.contains('on') ? 'true' : 'false');
  };

  // ---- text size (Batch 2 §2): exactly two modes, persisted in prefs.
  function applyTextSize() {
    var prefs = LddStore.getPrefs();
    var mode = (prefs && prefs.textSize === 'xlarge') ? 'xlarge' : 'large';
    document.documentElement.setAttribute('data-text-size', mode);
    [['ts-large', 'large'], ['ts-xlarge', 'xlarge']].forEach(function (pair) {
      var b = $(pair[0]);
      if (b) b.setAttribute('aria-pressed', pair[1] === mode ? 'true' : 'false');
    });
    return mode;
  }
  window.setTextSize = function (mode) {
    var m = mode === 'xlarge' ? 'xlarge' : 'large';
    var prefs = LddStore.getPrefs() || {};
    prefs.textSize = m;
    LddStore.setPrefs(prefs);
    applyTextSize();
    persistSession();
  };

  function show(screenId) {
    // Batch 3 §3.6/§3.11: preserve list/search scroll + query across returns.
    try {
      var cur = document.querySelector('.screen.active');
      if (cur && cur.id === 'screen-list') lastListScroll = window.scrollY || 0;
      if (cur && cur.id === 'screen-search') lastSearchScroll = window.scrollY || 0;
    } catch (e0) {}
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = $('screen-' + screenId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    if (screenId === 'home') renderHome();
    if (screenId === 'home' && pendingDataUpdate) {
      pendingDataUpdate = false;
      setTimeout(function () { toast('Đã cập nhật dữ liệu mới'); }, 350);
    }
    if (screenId === 'history') renderHistory();
    if (screenId === 'search') {
      var inp = $('search-input');
      if (inp && lastSearchQuery && !inp.value) inp.value = lastSearchQuery;
      doSearch();
      if (lastSearchScroll) { setTimeout(function () { window.scrollTo(0, lastSearchScroll); }, 50); }
    }
    if (screenId === 'list' && lastListScroll) {
      setTimeout(function () { window.scrollTo(0, lastListScroll); }, 50);
    }
  }

  /* ---------- modal confirm (Batch 3 §3.2/§3.9: explicit, safe-choice-first)
   * Stitch Screen 4 §7 visual: white card, optional real progress bar,
   * stacked actions — continue (primary), discard (soft warning), and an
   * explicit Close that only dismisses the dialog and changes nothing. */
  function showModal(opts) {
    // opts: { title, msg, progress?:{pos,total,label}, safeLabel, dangerLabel, onSafe, onDanger, hideDanger? }
    $('modal-title').textContent = opts.title || 'Xác nhận';
    $('modal-msg').textContent = opts.msg || '';
    var safe = $('modal-safe'), danger = $('modal-danger');
    safe.textContent = opts.safeLabel || 'Tiếp tục làm bài';
    danger.textContent = opts.dangerLabel || 'Nộp bài';
    danger.style.display = opts.hideDanger ? 'none' : '';
    safe.onclick = function () { hideModal(); if (opts.onSafe) opts.onSafe(); };
    danger.onclick = function () { hideModal(); if (opts.onDanger) opts.onDanger(); };
    var prog = $('modal-progress');
    if (prog) {
      if (opts.progress && opts.progress.total) {
        prog.hidden = false;
        $('modal-progress-label').textContent = opts.progress.label || '';
        var pct = Math.round(opts.progress.pos / opts.progress.total * 100);
        $('modal-progress-pct').textContent = pct + '%';
        $('modal-progress-fill').style.width = pct + '%';
      } else {
        prog.hidden = true;
      }
    }
    $('modal-overlay').hidden = false;
    setTimeout(function () { try { safe.focus(); } catch (e) {} }, 50);
  }
  function hideModal() { $('modal-overlay').hidden = true; }
  window.hideModal = hideModal;

  /* ---------- static content sync ---------- */
  function setSyncStatus(mode, text) {
    var dot = $('sync-dot');
    if (dot) dot.classList.toggle('off', mode === 'off');
    if ($('sync-text')) $('sync-text').textContent = text;
  }

  function questionsOf(setId) {
    return (cache.questionsBySet[setId] || []).slice().sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    });
  }

  // data/*.json file shape -> internal shape (validated; bad rows skipped).
  function toInternal(setId, sq, idx) {
    if (!sq || typeof sq.id !== 'string' || !sq.id) return null;
    if (typeof sq.question !== 'string' || !sq.question.trim()) return null;
    if (!Array.isArray(sq.options) || sq.options.length !== 4) return null;
    if (sq.correct !== 0 && sq.correct !== 1 && sq.correct !== 2 && sq.correct !== 3) return null;
    return {
      id: sq.id, setId: setId,
      category: (typeof sq.category === 'string' && sq.category.trim()) ? sq.category.trim() : null,
      q: sq.question, o: sq.options, c: sq.correct, e: sq.explanation || '',
      order: (idx + 1) * 10
    };
  }

  // Cache-busting, network-first fetch for content files (never rely on
  // HTTP/PWA cache for freshness — the query string changes every launch).
  function fetchFresh(path) {
    var sep = path.indexOf('?') >= 0 ? '&' : '?';
    return fetch(path + sep + 'v=' + Date.now(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    });
  }

  function publishedSets(catalog) {
    return (catalog.sets || []).filter(function (s) { return s.published !== false && s.id && s.file; });
  }

  async function initialLoad() {
    // Batch 2 §2: apply persisted text size before first paint.
    try { applyTextSize(); } catch (e) {}
    try { syncChips(); } catch (e2) {}
    try { updateExamStartBtn(); } catch (e3) {}
    // 1. Render whatever is cached immediately (offline-first).
    LddStore.migrateAll(cache, seedIdsOfFirstSet());
    LddStore.pruneStaleIds(cache);
    renderHome();
    if (!cache.sets.length) {
      setSyncStatus('off', 'Chưa có dữ liệu — cần mạng cho lần mở đầu tiên');
    }
    // 2. Check for new/updated content in the background.
    syncContent(false);
    // 3. Offer to resume an interrupted session.
    offerResume();
  }

  function seedIdsOfFirstSet() {
    var arr = cache.questionsBySet['kdbds-2023'] || [];
    return arr.map(function (q) { return q.id; });
  }

  // Compare remote catalog + per-set version metadata against the locally
  // installed version; download only what changed. Remote files are fetched
  // fresh (cache-busting query + no-store, never trusting HTTP/PWA cache).
  // Never interrupts an active study/exam session: the session keeps its
  // in-memory questions AND its stored snapshot; new content applies to
  // future sessions. This function never clears or rewrites the session
  // slot — stars/wrong are pruned by stable composite ID, history kept.
  async function syncContent(manual) {
    if (syncInProgress && !manual) return;
    if (!manual && lastSyncAt && (Date.now() - lastSyncAt) < SYNC_THROTTLE_MS) return;
    if (!navigator.onLine && !manual) {
      if (cache.sets.length) setSyncStatus('off', 'Ngoại tuyến — đang dùng bộ đề đã lưu (' + cache.sets.length + ' bộ)');
      return;
    }
    syncInProgress = true;
    lastSyncAt = Date.now();
    if (manual) setSyncStatus('on', 'Đang kiểm tra dữ liệu mới…');
    var catalog;
    try {
      catalog = await fetchFresh('data/catalog.json');
    } catch (e) {
      syncInProgress = false;
      lastSyncAt = 0; // error/offline: allow a prompt retry on next active event
      if (cache.sets.length) {
        setSyncStatus('off', 'Ngoại tuyến — đang dùng bộ đề đã lưu (' + cache.sets.length + ' bộ)');
        if (manual) toast('Không có mạng — vẫn dùng dữ liệu đã lưu');
      } else {
        setSyncStatus('off', 'Chưa tải được dữ liệu');
        renderHome();
      }
      return;
    }

    var sets = publishedSets(catalog);
    var oldById = {};
    cache.sets.forEach(function (s) { oldById[s.id] = s; });
    var changed = (catalog.version !== cache.catalogVersion) || sets.length !== cache.sets.length;
    var questionsBySet = {};
    var usableMeta = [];
    var failures = [];
    var ok = true;

    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      var old = oldById[s.id];
      if (old && old.version === s.version && old.file === s.file && cache.questionsBySet[s.id]) {
        questionsBySet[s.id] = cache.questionsBySet[s.id];
        usableMeta.push(old);
        continue; // unchanged — keep cached questions, no download
      }
      changed = true;
      try {
        var doc = await fetchFresh('data/' + s.file);
        if (!doc || doc.id !== s.id || !Array.isArray(doc.questions)) throw new Error('bad set file');
        var list = [];
        doc.questions.forEach(function (sq, idx) {
          var q = toInternal(s.id, sq, idx);
          if (q) list.push(q);
        });
        if (!list.length) throw new Error('empty set');
        questionsBySet[s.id] = list;
        usableMeta.push(s); // new version metadata ONLY after successful download
      } catch (e2) {
        if (old && cache.questionsBySet[s.id]) {
          // B4: keep OLD content AND OLD version metadata so the next sync
          // still sees a version mismatch and retries. Never mark old
          // content with the new version.
          questionsBySet[s.id] = cache.questionsBySet[s.id];
          usableMeta.push(old);
          failures.push(s.id);
        } else {
          failures.push(s.id); // brand-new set failed to download; skip it for now
          ok = false;
        }
      }
    }

    if (!ok && !Object.keys(questionsBySet).length && !cache.sets.length) {
      syncInProgress = false;
      lastSyncAt = 0; // nothing usable: retry soon, not after a full throttle window
      setSyncStatus('off', 'Chưa tải được dữ liệu — thử lại khi có mạng');
      return;
    }

    var active = sessionActive();
    // B4: on partial failure keep the OLD catalog version so the next sync
    // retries instead of treating stale content as current.
    var saveCatalogVersion = failures.length ? cache.catalogVersion : (catalog.version || 0);
    LddStore.setCache(saveCatalogVersion, usableMeta, questionsBySet);
    cache = LddStore.getCache();
    LddStore.migrateAll(cache, seedIdsOfFirstSet());
    LddStore.pruneStaleIds(cache);

    if (failures.length) {
      syncInProgress = false;
      lastSyncAt = 0; // partial failure: keep old versions AND retry promptly
      if (!active) renderHome();
      setSyncStatus('off', 'Cập nhật chưa hoàn tất — sẽ thử lại (' + failures.length + ' bộ)');
      toast('Cập nhật chưa hoàn tất — giữ dữ liệu cũ, sẽ thử lại');
      return;
    }

    syncInProgress = false;
    if (changed) {
      if (!active) renderHome();
      setSyncStatus('on', 'Đã cập nhật · ' + fmtDate(Date.now()));
      // In-app notice ONLY when an update actually landed. Never pop a
      // toast over an active study/exam session; defer it until home.
      if (!active || manual) toast('Đã cập nhật dữ liệu mới');
      else pendingDataUpdate = true;
    } else {
      if (!active) renderHome();
      setSyncStatus('on', 'Bộ đề đã mới nhất · ' + cache.sets.length + ' bộ');
      if (manual) toast('Dữ liệu đã mới nhất');
    }
  }

  window.manualSync = function () { syncContent(true); };
  // Real update detection: check on open (initialLoad) AND whenever the app
  // becomes active again (PWA reopen, Safari restart, tab foreground) plus
  // connectivity regain. Throttled; manual taps always run immediately.
  function maybeSyncOnActive() {
    try {
      if (document.visibilityState === 'hidden') return;
    } catch (e) {}
    syncContent(false);
  }
  window.addEventListener('online', function () { lastSyncAt = 0; syncContent(false); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') maybeSyncOnActive();
  });
  window.addEventListener('focus', function () { maybeSyncOnActive(); });
  window.addEventListener('pageshow', function () { maybeSyncOnActive(); });

  /* ---------- home (Batch 3 §3.1/§3.2 hierarchy) ----------
   * Order: 1. Resume (only when one exists) 2. Question Set/subject
   * 3. Large primary "Bắt đầu ôn tập" 4. Secondary "Thi thử"
   * 5. Prominent "Ôn câu sai · N câu" 6. "Câu đã lưu" 7. "Lịch sử"
   * 8. "Tìm kiếm" 9. Sync/offline info last. */
  function wrongCountFor(setId) {
    var all = LddStore.getWrong();
    var count = 0;
    for (var i = 0; i < all.length; i++) {
      var q = LddStore.questionById(cache, all[i]);
      if (q && (!setId || q.setId === setId)) count++;
    }
    return count;
  }
  function starCountFor(setId) {
    var all = LddStore.getStars();
    var count = 0;
    for (var j = 0; j < all.length; j++) {
      var s = LddStore.questionById(cache, all[j]);
      if (s && (!setId || s.setId === setId)) count++;
    }
    return count;
  }
  function renderHome() {
    cache = LddStore.getCache();
    var wrongTotal = wrongCountFor(null);
    var starTotal = starCountFor(null);

    // 1. Resume card (visible, contextual) — rendered first, only when one exists.
    var slot = $('resume-slot');
    slot.innerHTML = '';
    try {
      var kept = LddStore.getSession();
      var keptKeys = sessionKeys(kept);
      if (kept && keptKeys && keptKeys.length && !sessionActive()) {
        var total = keptKeys.length;
        var pos = Math.min((kept.idx || 0) + 1, total);
        var modeLabel = kept.kind === 'exam' ? 'Thi thử' : (kept.isWrongReview ? 'Ôn câu sai' : 'Ôn tập');
        var meta = setTitleOf(kept.setId) + ' · ' + modeLabel + ' · Câu ' + pos + ' / ' + total;
        if (kept.kind === 'exam') {
          var endsAt = kept.endsAt || 0;
          var left = endsAt ? Math.max(0, Math.round((endsAt - Date.now()) / 1000)) : (kept.timeLeft | 0);
          if (left > 0 && endsAt) {
            var mm = Math.floor(left / 60), ss = left % 60;
            meta += ' · còn ' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
          }
        }
        var rc = document.createElement('div');
        rc.className = 'set-card resume-card';
        rc.id = 'resume-card';
        var pct = total ? Math.round(pos / total * 100) : 0;
        rc.innerHTML =
          '<div class="resume-kicker"><span class="pulse" aria-hidden="true"></span><span>BÀI ĐANG LÀM DỞ</span></div>' +
          '<h2>Bài đang làm dở</h2>' +
          '<p class="resume-meta" id="resume-meta">' + escapeHtml(meta) + '</p>' +
          '<div class="resume-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + pos + '" aria-label="Tiến độ bài đang làm dở"><div style="width:' + pct + '%"></div></div>' +
          '<div class="set-actions">' +
          '<button class="btn primary study-primary" id="resume-continue" data-act="resume">Tiếp tục học</button>' +
          '<button class="btn ghost drop" id="resume-discard" data-act="drop">Bỏ bài</button>' +
          '</div>';
        rc.querySelector('[data-act="resume"]').onclick = function () { window.resumeSession(); };
        rc.querySelector('[data-act="drop"]').onclick = function () { window.discardSession(); };
        slot.appendChild(rc);
      }
    } catch (e2) {}

    // 2-6. Per-set accordion (Stitch Screen 5 §D): collapsed header shows
    // the real set title, real question count and a real status chip when
    // one exists; the whole header is one large tap target. Exactly one
    // panel open at a time. Actions inside are unchanged.
    var box = $('set-list');
    box.innerHTML = '';
    if (!cache.sets.length) {
      var online = navigator.onLine;
      box.innerHTML = '<div class="empty-state"><div class="big">📚</div><p>' +
        (online ? 'Chưa tải được bộ đề.<br>Nhấn “Cập nhật dữ liệu” để thử lại.'
                : 'Chưa có dữ liệu offline.<br>Vui lòng kết nối mạng rồi mở lại app để tải bộ đề lần đầu.') +
        '</p></div>';
      setSyncStatus('off', online ? 'Chưa có dữ liệu' : 'Ngoại tuyến — cần mạng cho lần đầu');
    }
    if (openAccId === null && cache.sets.length) openAccId = cache.sets[0].id;
    var keptForChip = null;
    try { keptForChip = keptSession(); } catch (eC) {}
    cache.sets.forEach(function (s) {
      var n = questionsOf(s.id).length;
      var nw = wrongCountFor(s.id);
      var ns = starCountFor(s.id);
      var upd = s.updated_at ? fmtDate(Date.parse(s.updated_at)) : '';
      // Real status only: "Đang học" when the unfinished session belongs to
      // this set. Nothing is invented (no fake completed/new states).
      var chip = (keptForChip && keptForChip.setId === s.id)
        ? '<span class="acc-status">Đang học</span>' : '';
      // Real study label: "Tiếp tục ôn tập" only when a plain unfinished
      // study session for this exact set exists (startStudy resumes it);
      // otherwise "Bắt đầu ôn tập".
      var studyLabel = (keptForChip && keptForChip.kind === 'study' &&
        keptForChip.setId === s.id && !keptForChip.isWrongReview)
        ? 'Tiếp tục ôn tập' : 'Bắt đầu ôn tập';
      // Batch E: small resume hint for answer viewing (never a large card).
      var viewHint = '';
      try {
        var vk = (LddStore.getViewPos() || {})[s.id];
        if (vk) {
          var vlist = questionsOf(s.id);
          for (var vi = 0; vi < vlist.length; vi++) {
            if (LddStore.key(vlist[vi].setId, vlist[vi].id) === vk && vi > 0) {
              viewHint = '<div class="view-resume-hint">👁️ Tiếp tục xem từ câu ' + (vi + 1) + '</div>';
              break;
            }
          }
        }
      } catch (eV) {}
      var open = openAccId === s.id;
      var card = document.createElement('div');
      card.className = 'set-card';
      card.setAttribute('role', 'listitem');
      card.innerHTML =
        '<button class="acc-head" aria-expanded="' + (open ? 'true' : 'false') + '" aria-controls="acc-panel-' + escapeHtml(s.id) + '">' +
        '<span class="acc-head-text"><span class="acc-title">' + escapeHtml(s.title) + '</span>' +
        '<span class="acc-head-meta"><span>' + n + ' câu hỏi</span>' + chip + '</span></span>' +
        '<span class="acc-chev" aria-hidden="true">⌄</span>' +
        '</button>' +
        '<div class="acc-panel" id="acc-panel-' + escapeHtml(s.id) + '"' + (open ? '' : ' hidden') + '>' +
        (s.description ? '<p class="set-desc">' + escapeHtml(s.description) + '</p>' : '') +
        (upd ? '<div class="set-meta">cập nhật ' + escapeHtml(upd) + '</div>' : '') +
        '<div class="set-actions">' +
        '<button class="btn primary study-primary" data-act="study">📖 ' + studyLabel + '</button>' +
        '<button class="btn ghost view-secondary" data-act="view">👁️ Xem đáp án</button>' +
        '<button class="btn ghost exam-secondary" data-act="exam">📝 Thi thử</button>' +
        viewHint +
        '<div class="set-sub-actions">' +
        '<button class="btn ghost" data-act="wrong">❌ Ôn câu sai · ' + nw + ' câu</button>' +
        '<button class="btn ghost" data-act="star">⭐ Câu đã lưu (' + ns + ')</button>' +
        '</div>' +
        '</div></div>';
      (function (setId, head) {
        head.onclick = function () {
          openAccId = (openAccId === setId) ? '__none__' : setId;
          var cards = box.querySelectorAll('.set-card');
          cards.forEach(function (c) {
            var h = c.querySelector('.acc-head');
            var p = c.querySelector('.acc-panel');
            if (!h || !p) return;
            var isOpen = h.getAttribute('aria-controls') === 'acc-panel-' + setId && openAccId === setId;
            h.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            p.hidden = !isOpen;
          });
        };
      })(s.id, card.querySelector('.acc-head'));
      card.querySelector('[data-act="study"]').onclick = function () { startStudy(s.id); };
      card.querySelector('[data-act="view"]').onclick = function () { startView(s.id); };
      card.querySelector('[data-act="exam"]').onclick = function () {
        activeSetId = s.id;
        $('exam-setup-title').textContent = 'Thi thử — ' + s.title;
        updateExamStartBtn();
        show('exam-setup');
      };
      card.querySelector('[data-act="wrong"]').onclick = function () { window.startWrongStudy(s.id); };
      card.querySelector('[data-act="star"]').onclick = function () { openList('star', s.id); };
      box.appendChild(card);
    });

    // 7-8. Study tools (Stitch §E): real counts only, 2-column cards that
    // collapse to one column on small screens / "Rất lớn" text via CSS.
    var nav = $('home-nav');
    nav.innerHTML = '';
    var hLabel = document.createElement('h3');
    hLabel.className = 'home-section-label';
    hLabel.textContent = 'Công cụ học tập';
    nav.appendChild(hLabel);
    var histTotal = 0;
    try { histTotal = LddStore.getHistory().length; } catch (eH) {}
    var grid = document.createElement('div');
    grid.className = 'grid2';
    grid.innerHTML =
      '<button class="tile" id="tile-history"><span class="ico">🕘</span><b>Lịch sử</b><small>' + histTotal + ' bài đã làm</small></button>' +
      '<button class="tile" id="tile-search"><span class="ico">🔍</span><b>Tìm kiếm</b><small>Tra cứu nhanh</small></button>';
    // Global review tiles (all sets) for older-learner clarity.
    var grid2 = document.createElement('div');
    grid2.className = 'grid2';
    grid2.innerHTML =
      '<button class="tile full" id="tile-wrong"><span class="ico">❌</span><b>Ôn câu sai · ' + wrongTotal + ' câu</b>' +
      '<span class="badge warn' + (wrongTotal ? '' : ' empty') + '" id="badge-wrong">' + wrongTotal + '</span></button>' +
      '<button class="tile" id="tile-star"><span class="ico">⭐</span><b>Câu đã lưu</b><small>' + starTotal + ' câu quan trọng</small>' +
      '<span class="badge star' + (starTotal ? '' : ' empty') + '" id="badge-star">' + starTotal + '</span></button>';
    nav.appendChild(grid2);
    nav.appendChild(grid);
    nav.querySelector('#tile-history').onclick = function () { show('history'); };
    nav.querySelector('#tile-search').onclick = function () { show('search'); };
    nav.querySelector('#tile-wrong').onclick = function () { window.startWrongStudy(null); };
    nav.querySelector('#tile-star').onclick = function () { openList('star'); };

    // Hide install hint when already installed as standalone PWA.
    try {
      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
        $('install-hint').style.display = 'none';
      }
    } catch (e) {}
  }

  /* ---------- study ---------- */
  function shuffleOptions(q) {
    var pairs = q.o.map(function (text, idx) { return { text: text, ok: idx === q.c }; });
    var sh = shuffle(pairs);
    var nc = 0;
    sh.forEach(function (p, i) { if (p.ok) nc = i; });
    var out = {};
    for (var k in q) out[k] = q[k];
    out.o = sh.map(function (p) { return p.text; });
    out.c = nc;
    return out;
  }

  window.startStudy = startStudy;
  function startStudy(setId) {
    var target = setId || activeSetId || (cache.sets[0] && cache.sets[0].id);
    guardReplaceSession('study', target, false, null, function () {
      startStudyNow(target);
    });
  }
  function startStudyNow(target) {
    var list = questionsOf(target);
    if (!list.length) { toast('Bộ đề này chưa có câu hỏi'); return; }
    activeSetId = target;
    var prefs = LddStore.getPrefs();
    if (prefs.shuffleQ) list = shuffle(list);
    if (prefs.shuffleA) list = list.map(shuffleOptions);
    study = { list: list, idx: 0, answers: list.map(function () { return -1; }), transient: false, origin: null, isWrongReview: false, wrongSetId: null };
    activeKind = 'study';
    persistSession();
    updateStudyHeader();
    show('study');
    renderStudy();
  }
  window.restartStudy = function () {
    // Batch B §3: after a wrong-session finish, "Ôn lại" retries the
    // still-wrong queue — never the full 80-question set. (study was cleared
    // at finish, so the scope comes from the recorded result, not live state.)
    if (lastResult && lastResult.wasWrongReview) { window.startWrongStudy(lastResult.wrongSetId); return; }
    startStudyNow(activeSetId || (cache.sets[0] && cache.sets[0].id));
  };

  /* ---------- wrong-question Study session (Batch 4 §4.1/§4.2) ----------
   * Starts a REAL Study session over a start-of-session snapshot of the
   * wrong-question queue (stable setId:questionId keys). Answering a
   * previously-wrong question correctly updates persistent wrong status
   * (via answerStudy) but never shrinks/reorders the active in-memory list.
   * Per-set review (setId given) covers only that set; global review covers
   * all sets with per-question subject context in the header. */
  window.startWrongStudy = function (setId) {
    var ids = LddStore.getWrong().filter(function (k) { return LddStore.questionById(cache, k); });
    if (setId) {
      ids = ids.filter(function (k) {
        var q = LddStore.questionById(cache, k);
        return q && q.setId === setId;
      });
    }
    if (!ids.length) { toast(setId ? 'Bộ đề này chưa có câu nào sai. Tuyệt vời!' : 'Chưa có câu nào sai. Tuyệt vời!'); return; }
    var probe = ids.map(function (k) { return LddStore.questionById(cache, k); });
    var target = setId || (probe[0] && probe[0].setId);
    guardReplaceSession('study', target, true, setId || null, function () {
      startWrongStudyNow(setId, ids);
    });
  };
  function startWrongStudyNow(setId, ids) {
    var list = ids.map(function (k) { return LddStore.questionById(cache, k); });
    activeSetId = setId || list[0].setId;
    study = {
      list: list.slice(), idx: 0,
      answers: list.map(function () { return -1; }),
      transient: false, origin: null,
      isWrongReview: true, wrongSetId: setId || null,
      wrongSnapshot: ids.slice()
    };
    activeKind = 'study';
    persistSession();
    updateStudyHeader();
    show('study');
    renderStudy();
  };
  window.retryStillWrong = function () {
    var scope = study.wrongSetId || null;
    // study was cleared at finish; re-derive scope from stored attr on button.
    var btn = $('sr-retry-wrong');
    var sid = (btn && btn.getAttribute('data-set')) || null;
    if (sid === '') sid = null;
    window.startWrongStudy(sid);
  };

  function qkey(q) { return LddStore.key(q.setId, q.id); }

  // Batch 3 §3.3: "Câu X / Y" is the clearest context; subject is secondary.
  function updateStudyHeader() {
    var total = study.list.length || 1;
    $('study-title').textContent = 'Câu ' + (study.idx + 1) + ' / ' + total;
    var mode = study.transient ? 'Ôn tập nhanh' : (study.isWrongReview ? 'Ôn câu sai' : 'Ôn tập');
    // Batch 4 §4.2: a global wrong review spans sets — keep visible subject
    // context per question so mixed queues never confuse the learner.
    var ctx = study.isWrongReview && study.list[study.idx]
      ? setTitleOf(study.list[study.idx].setId)
      : setTitleOf(activeSetId);
    $('study-sub').textContent = mode + ' · ' + ctx;
  }
  function returnLabel() {
    if (!study.origin) return 'Quay lại';
    if (study.origin.type === 'wrong') return 'Quay lại câu sai';
    if (study.origin.type === 'star') return 'Quay lại câu đã lưu';
    if (study.origin.type === 'search') return 'Quay lại tìm kiếm';
    if (study.origin.type === 'list') return 'Quay lại danh sách';
    return 'Quay lại';
  }

  function renderStudy() {
    var q = study.list[study.idx];
    if (!q) return;
    var total = study.list.length;
    var chosen = study.answers[study.idx];
    var answered = chosen !== undefined && chosen >= 0;
    var score = recountStudy();
    updateStudyHeader();
    $('study-pill').textContent = 'Câu ' + (study.idx + 1);
    $('study-counter').textContent = score.ok + ' đúng · ' + score.no + ' sai';
    $('study-progress').style.width = (study.idx / total * 100) + '%';
    $('study-q').textContent = q.q;
    var cat = $('study-cat');
    if (q.category) { cat.style.display = ''; cat.textContent = q.category; }
    else cat.style.display = 'none';
    var starOn = LddStore.getStars().indexOf(qkey(q)) >= 0;
    // Batch 2 §8: star keeps its glyph but always carries an accessible
    // name — "Đã lưu" / "Lưu câu" — plus pressed state.
    var starBtn = $('study-star');
    var starIco = $('study-star-ico');
    var starTxt = $('study-star-txt');
    if (starIco) starIco.textContent = starOn ? '★' : '☆';
    else starBtn.textContent = starOn ? '★' : '☆';
    if (starTxt) starTxt.textContent = starOn ? 'Đã lưu' : 'Lưu câu';
    starBtn.setAttribute('aria-pressed', starOn ? 'true' : 'false');
    starBtn.setAttribute('aria-label', starOn ? 'Đã lưu (bỏ lưu câu này)' : 'Lưu câu (đánh dấu câu này)');
    starBtn.classList.toggle('on', starOn);

    var opts = $('study-opts');
    opts.innerHTML = '';
    q.o.forEach(function (text, i) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.setAttribute('aria-pressed', (answered && chosen === i) ? 'true' : 'false');
      b.setAttribute('aria-label', 'Đáp án ' + LETTERS[i] + ': ' + text);
      b.innerHTML = '<span class="letter" aria-hidden="true">' + LETTERS[i] + '</span><span class="otext">' + escapeHtml(text) + '</span>';
      b.onclick = function () { answerStudy(i); };
      opts.appendChild(b);
    });
    $('study-feedback').innerHTML = '';
    $('study-next').disabled = !answered;
    // Batch D: picker only for real sessions, not single-question reviews.
    if ($('study-picker-btn')) $('study-picker-btn').style.display = study.transient ? 'none' : '';
    if (study.transient) {
      // Batch 3 §3.6: single-question review never starts all 80 questions.
      $('study-next').textContent = answered ? returnLabel() : returnLabel();
      $('study-next').disabled = false;
      $('study-prev').disabled = true;
      $('study-prev').style.display = 'none';
    } else {
      $('study-prev').style.display = '';
      $('study-next').textContent = answered
        ? (study.idx === total - 1 ? 'Hoàn thành ✓' : 'Tiếp theo ›')
        : 'Tiếp theo ›';
      $('study-prev').disabled = study.idx === 0;
    }
    if (answered) revealStudyAnswer(false);
  }

  // Batch A: only newly-answered questions scroll feedback into view.
  // Re-renders (star toggles, nav, resume) pass false so reading position
  // is never yanked unexpectedly.
  function revealStudyAnswer(scroll) {
    var q = study.list[study.idx];
    var chosen = study.answers[study.idx];
    var nodes = $('study-opts').querySelectorAll('.opt');
    nodes.forEach(function (el, i) {
      el.onclick = null;
      el.setAttribute('aria-pressed', chosen === i ? 'true' : 'false');
      el.setAttribute('aria-disabled', 'true');
      // Batch 2 §6: state = visual style AND text meaning. Non-selected
      // answers stay fully readable (no .dim fade).
      if (i === q.c) {
        el.classList.add('correct');
        el.insertAdjacentHTML('beforeend', '<span class="tag">✓ Đáp án đúng</span>');
      } else if (i === chosen) {
        el.classList.add('wrong');
        el.insertAdjacentHTML('beforeend', '<span class="tag">✕ Bạn chọn — chưa đúng</span>');
      }
    });
    var ok = chosen === q.c;
    var html = '<div class="feedback ' + (ok ? 'ok' : 'no') + '">' +
      '<div class="head">' + (ok ? '✓ Chính xác!' : '✗ Chưa đúng') + '</div>' +
      '<div class="exp"><b>Đáp án đúng: ' + LETTERS[q.c] + '.</b> ' + escapeHtml(q.o[q.c]) +
      (q.e ? '<br><br>💡 ' + escapeHtml(q.e) : '') + '</div>';
    if (study.transient) {
      html += '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">' +
        '<button class="btn ghost small" id="study-retry" style="flex:1 1 200px">🔁 Thử lại câu này</button></div>';
    }
    html += '</div>';
    $('study-feedback').innerHTML = html;
    var retry = $('study-retry');
    if (retry) retry.onclick = function () { retrySingleQuestion(); };
    // Batch 3 §3.4: bring feedback into view with a small scroll only.
    // Honor prefers-reduced-motion: no smooth animation then.
    // Batch A: only when this answer was just given (scroll !== false).
    if (scroll === false) return;
    try {
      var fb = $('study-feedback').querySelector('.feedback');
      if (fb) {
        var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (typeof fb.scrollIntoView === 'function') {
          fb.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        }
      }
    } catch (e) {}
  }

  window.answerStudy = answerStudy;
  function answerStudy(i) {
    // B2: one record per question — re-answering an answered question never
    // increments totals again.
    if (study.answers[study.idx] !== undefined && study.answers[study.idx] >= 0) return;
    var q = study.list[study.idx];
    study.answers[study.idx] = i;
    var score = recountStudy();
    var k = qkey(q);
    if (i === q.c) {
      LddStore.setWrong(LddStore.getWrong().filter(function (id) { return id !== k; }));
    } else {
      var w2 = LddStore.getWrong();
      if (w2.indexOf(k) < 0) { w2.push(k); LddStore.setWrong(w2); }
    }
    revealStudyAnswer(true);
    // Batch B §2: after answering the LAST question the button must read
    // "Hoàn thành" immediately (renderStudy is not re-run after answering,
    // so the label has to update here).
    if (!study.transient && study.idx === study.list.length - 1) {
      $('study-next').textContent = 'Hoàn thành ✓';
    } else if (!study.transient) {
      $('study-next').textContent = 'Tiếp theo ›';
    }
    $('study-next').disabled = false;
    $('study-counter').textContent = score.ok + ' đúng · ' + score.no + ' sai';
    persistSession();
  }

  window.studyNext = function () {
    // Batch 3 §3.6: transient single-question review returns to its origin.
    if (study.transient) { returnToOrigin(); return; }
    if (study.answers[study.idx] === undefined || study.answers[study.idx] < 0) return;
    // Batch D: reaching the final question never implies completion — there
    // may be unanswered questions elsewhere via picker jumps.
    if (study.idx === study.list.length - 1) { confirmFinishStudy(); return; }
    study.idx++;
    renderStudy();
    persistSession();
    window.scrollTo(0, 0);
  };
  // Batch D: finish via explicit confirmation when questions remain
  // unanswered; otherwise finish directly.
  function confirmFinishStudy() {
    var missing = [];
    for (var i = 0; i < study.list.length; i++) {
      if (study.answers[i] === undefined || study.answers[i] < 0) missing.push(i);
    }
    if (!missing.length) { finishStudy(); return; }
    showModal({
      title: 'Còn câu chưa trả lời?',
      msg: 'Còn ' + missing.length + ' câu chưa trả lời. Bạn có thể quay lại làm tiếp, hoặc xem kết quả luôn.',
      safeLabel: 'Quay lại làm tiếp',
      dangerLabel: 'Xem kết quả',
      onSafe: function () {
        study.idx = missing[0];
        renderStudy();
        persistSession();
        window.scrollTo(0, 0);
      },
      onDanger: function () { finishStudy(); }
    });
  }
  window.studyPrev = function () {
    if (study.transient) return;
    if (study.idx === 0) return;
    study.idx--;
    renderStudy();
    persistSession();
    window.scrollTo(0, 0);
  };
  function retrySingleQuestion() {
    if (!study.transient) return;
    study.answers[study.idx] = -1;
    renderStudy();
    window.scrollTo(0, 0);
  }
  window.retrySingleQuestion = retrySingleQuestion;
  function returnToOrigin() {
    var origin = study.origin;
    study = { list: [], idx: 0, answers: [], transient: false, origin: null, isWrongReview: false, wrongSetId: null, wrongSnapshot: null };
    activeKind = null;
    // Never touch the kept session: transient reviews persist nothing.
    if (origin && origin.type === 'search') {
      lastSearchQuery = origin.query || lastSearchQuery;
      var inp = $('search-input');
      if (inp) inp.value = lastSearchQuery;
      show('search');
    } else if (origin && (origin.type === 'wrong' || origin.type === 'star')) {
      openList(origin.type === 'wrong' ? 'wrong' : 'star', origin.setId, true);
    } else {
      show('home');
    }
  }
  window.returnToOrigin = returnToOrigin;
  window.toggleStarCurrent = function () {
    var q = study.list[study.idx];
    if (!q) return;
    var s = LddStore.getStars();
    var k = qkey(q);
    var pos = s.indexOf(k);
    if (pos >= 0) { s.splice(pos, 1); toast('Đã bỏ đánh dấu'); }
    else { s.push(k); toast('⭐ Đã đánh dấu câu này'); }
    LddStore.setStars(s);
    renderStudy();
  };
  window.exitStudy = function () {
    // Batch 3 §3.6/§3.11: transient review exits back to its origin list.
    if (study.transient) { returnToOrigin(); return; }
    // B3: normal exit = "Lưu và về trang chủ" — KEEP the unfinished session.
    // Only explicit discard (Bỏ bài on the home resume card), finish, or a
    // fresh restart may replace it. Transient single-question reviews persist
    // nothing and destroy nothing.
    if (!study.transient && study.list.length) {
      persistSession();
    }
    activeKind = null;
    show('home');
  };
  // Explicit discard for a kept Study session (used by the home resume card).
  window.discardStudy = function () {
    LddStore.clearSession();
    activeKind = null;
    study = { list: [], idx: 0, answers: [], transient: false, origin: null, isWrongReview: false, wrongSetId: null, wrongSnapshot: null };
    renderHome();
  };

  function finishStudy() {
    var total = study.list.length;
    var score = recountStudy();
    var unans = total - score.ok - score.no;
    var pct = total ? Math.round(score.ok / total * 100) : 0;
    $('sr-num').textContent = score.ok;
    $('sr-den').textContent = '/ ' + total;
    $('sr-ok').textContent = score.ok;
    $('sr-no').textContent = score.no;
    $('sr-pct').textContent = pct + '%';
    $('sr-circle').style.setProperty('--deg', (pct * 3.6) + 'deg');
    $('sr-msg').textContent = pct >= 80 ? 'Xuất sắc! 🎉' : pct >= 60 ? 'Khá tốt! 👍' : 'Cần ôn thêm 💪';
    $('sr-sub').textContent = 'Bạn trả lời đúng ' + score.ok + ' trên ' + total + ' câu' +
      (unans > 0 ? ' · ' + unans + ' câu chưa trả lời' : '');
    // Batch 4 §4.1: simple result + optional re-review of still-wrong only.
    var wasWrongReview = !!study.isWrongReview;
    var wrongScope = study.wrongSetId || null;
    LddStore.pushHistory({ type: wasWrongReview ? 'Ôn câu sai' : 'Ôn tập', setId: activeSetId, score: score.ok, total: total, date: Date.now() });
    LddStore.clearSession();
    var stillWrong = 0;
    if (wasWrongReview) {
      var all = LddStore.getWrong().filter(function (k) { return LddStore.questionById(cache, k); });
      if (wrongScope) all = all.filter(function (k) { var q = LddStore.questionById(cache, k); return q && q.setId === wrongScope; });
      stillWrong = all.length;
    }
    var rw = $('sr-retry-wrong');
    if (rw) {
      if (wasWrongReview && stillWrong > 0) {
        rw.style.display = '';
        rw.textContent = 'Ôn lại các câu vẫn sai (' + stillWrong + ' câu)';
        rw.setAttribute('data-set', wrongScope || '');
      } else { rw.style.display = 'none'; rw.setAttribute('data-set', ''); }
    }
    study = { list: [], idx: 0, answers: [], transient: false, origin: null, isWrongReview: false, wrongSetId: null, wrongSnapshot: null };
    activeKind = null;
    lastResult = { wasWrongReview: wasWrongReview, wrongSetId: wrongScope };
    show('study-result');
  }

  /* ---------- exam ---------- */
  // Batch 3 §3.7: default path obvious — button echoes current selection.
  function updateExamStartBtn() {
    try {
      var c = document.querySelector('#exam-count-chips .chip.on');
      var t = document.querySelector('#exam-time-chips .chip.on');
      var n = c ? c.textContent.trim() : '20 câu';
      var m = t ? t.textContent.trim() : '20 phút';
      var b = $('exam-start-btn');
      if (b) b.textContent = 'Bắt đầu thi · ' + n + ' · ' + m;
      var hint = $('exam-default-hint');
      if (hint) hint.textContent = 'Mặc định: 20 câu · 20 phút — nhấn Bắt đầu thi là làm ngay. Đang chọn: ' + n + ' · ' + m + '.';
    } catch (e) {}
  }
  window.updateExamStartBtn = updateExamStartBtn;
  // Batch 2 §9: chips expose selection programmatically.
  function syncChips() {
    document.querySelectorAll('.chips .chip').forEach(function (x) {
      x.setAttribute('aria-pressed', x.classList.contains('on') ? 'true' : 'false');
    });
  }
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('#exam-count-chips .chip');
    if (c) {
      document.querySelectorAll('#exam-count-chips .chip').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      c.classList.add('on');
      c.setAttribute('aria-pressed', 'true');
      updateExamStartBtn();
    }
    var t = e.target.closest && e.target.closest('#exam-time-chips .chip');
    if (t) {
      document.querySelectorAll('#exam-time-chips .chip').forEach(function (x) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); });
      t.classList.add('on');
      t.setAttribute('aria-pressed', 'true');
      updateExamStartBtn();
    }
  });

  window.startExam = function () {
    guardReplaceSession('exam', activeSetId, false, null, function () {
      startExamNow();
    });
  };
  function startExamNow() {
    var count = parseInt(document.querySelector('#exam-count-chips .chip.on').dataset.v, 10);
    var minutes = parseInt(document.querySelector('#exam-time-chips .chip.on').dataset.v, 10);
    var shuffleQ = $('sw-shuffle-q').classList.contains('on');
    var shuffleA = $('sw-shuffle-a').classList.contains('on');
    var pool = questionsOf(activeSetId);
    if (!pool.length) { toast('Bộ đề này chưa có câu hỏi'); return; }
    if (shuffleQ) pool = shuffle(pool);
    var n = count === 0 ? pool.length : Math.min(count, pool.length);
    var list = pool.slice(0, n);
    if (shuffleA) list = list.map(shuffleOptions);
    var total = minutes * 60;
    exam = { list: list, idx: 0, answers: new Array(list.length).fill(-1), totalTime: total, timeLeft: total, endsAt: Date.now() + total * 1000, timerId: null, submitted: false };
    activeKind = 'exam';
    persistSession();
    show('exam');
    renderExam();
    startExamTimer();
  };

  function startExamTimer() {
    clearInterval(exam.timerId);
    // B6: remaining time is ALWAYS derived from the absolute deadline so
    // iOS background/suspend time counts toward the exam.
    if (!exam.endsAt) exam.endsAt = Date.now() + examRemaining() * 1000;
    updateTimerDisplay(examRemaining());
    exam.timerId = setInterval(function () {
      var left = examRemaining();
      if (left <= 0) {
        clearInterval(exam.timerId);
        updateTimerDisplay(0);
        // No blocking alert: it would extend time while waiting for dismissal.
        submitExam();
        return;
      }
      updateTimerDisplay(left);
      if (left % 10 === 0) persistSession();
    }, 1000);
  }
  function updateTimerDisplay(left) {
    if (left === undefined) left = examRemaining();
    var m = Math.floor(left / 60), s = left % 60;
    var el = $('exam-timer');
    el.textContent = '⏱ ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    el.classList.toggle('warn', left <= 60);
  }

  function renderExam() {
    var q = exam.list[exam.idx];
    if (!q) return;
    var total = exam.list.length;
    $('exam-sub').textContent = 'Câu ' + (exam.idx + 1) + ' / ' + total;
    $('exam-pill').textContent = 'Câu ' + (exam.idx + 1);
    var answeredCount = exam.answers.filter(function (a) { return a >= 0; }).length;
    $('exam-counter').textContent = 'Đã trả lời ' + answeredCount + ' / ' + total;
    $('exam-progress').style.width = (exam.idx / total * 100) + '%';
    $('exam-q').textContent = q.q;
    var cat = $('exam-cat');
    if (q.category) { cat.style.display = ''; cat.textContent = q.category; }
    else cat.style.display = 'none';
    var opts = $('exam-opts');
    opts.innerHTML = '';
    q.o.forEach(function (text, i) {
      var picked = exam.answers[exam.idx] === i;
      var b = document.createElement('button');
      b.className = 'opt' + (picked ? ' chosen' : '');
      b.setAttribute('aria-pressed', picked ? 'true' : 'false');
      b.setAttribute('aria-label', 'Đáp án ' + LETTERS[i] + ': ' + text + (picked ? ' (đã chọn)' : ''));
      b.innerHTML = '<span class="letter" aria-hidden="true">' + LETTERS[i] + '</span><span class="otext">' + escapeHtml(text) +
        (picked ? '</span><span class="tag">✓ Đã chọn</span>' : '</span>');
      b.onclick = function () { selectExam(i); };
      opts.appendChild(b);
    });
    var nav = $('exam-nav');
    nav.innerHTML = '';
    exam.list.forEach(function (_, i) {
      var cell = document.createElement('button');
      cell.className = 'nav-cell' + (exam.answers[i] >= 0 ? ' done' : '') + (i === exam.idx ? ' cur' : '');
      cell.textContent = i + 1;
      cell.setAttribute('aria-label', 'Câu ' + (i + 1) + (exam.answers[i] >= 0 ? ' (đã trả lời)' : ' (chưa trả lời)'));
      if (i === exam.idx) cell.setAttribute('aria-current', 'true');
      cell.onclick = function () { exam.idx = i; renderExam(); persistSession(); window.scrollTo(0, 0); };
      nav.appendChild(cell);
    });
    $('exam-next-btn').textContent = exam.idx === total - 1 ? 'Nộp bài' : 'Sau ›';
  }

  window.selectExam = function (i) {
    exam.answers[exam.idx] = i;
    renderExam();
    persistSession();
  };
  window.examNext = function () {
    if (exam.idx === exam.list.length - 1) { confirmSubmitExam(); return; }
    exam.idx++;
    renderExam();
    persistSession();
    window.scrollTo(0, 0);
  };
  window.examPrev = function () {
    if (exam.idx === 0) return;
    exam.idx--;
    renderExam();
    persistSession();
    window.scrollTo(0, 0);
  };
  window.confirmExitExam = function () {
    showModal({
      title: 'Thoát bài thi?',
      msg: 'Bài thi chưa nộp sẽ không được chấm. Bài làm dở vẫn được giữ để tiếp tục.',
      safeLabel: 'Ở lại làm bài',
      dangerLabel: 'Thoát (giữ bài dở)',
      onSafe: function () {},
      onDanger: function () {
        clearInterval(exam.timerId);
        // Keep the session so Home offers Tiếp tục; do not delete progress.
        try { persistSession(); } catch (e) {}
        activeKind = null;
        show('home');
      }
    });
  };
  window.confirmSubmitExam = function () {
    // Batch B §5: after a timeout auto-submit, the submit dialog is gone and
    // further taps must be ignored — one exam yields one history entry.
    if (exam.submitted || !exam.list.length) return;
    var blank = exam.answers.filter(function (a) { return a < 0; }).length;
    showModal({
      title: 'Nộp bài thi?',
      msg: blank > 0
        ? 'Còn ' + blank + ' câu chưa trả lời. Bạn có thể quay lại kiểm tra trước khi nộp.'
        : 'Bạn đã trả lời hết. Nộp bài để xem kết quả?',
      safeLabel: 'Tiếp tục làm bài',
      dangerLabel: 'Nộp bài',
      onSafe: function () {},
      onDanger: function () { submitExam(); }
    });
  };

  function submitExam() {
    // Batch B §5: single-submission guard. Timeout auto-submit and a stale
    // open submit/exit dialog can race — the first call wins, later calls
    // (repeated taps, stale dialog actions) are ignored so history is
    // recorded exactly once.
    if (exam.submitted) return;
    exam.submitted = true;
    hideModal();
    clearInterval(exam.timerId);
    var correct = 0;
    var details = [];
    var w = LddStore.getWrong();
    exam.list.forEach(function (q, i) {
      var a = exam.answers[i];
      var ok = a === q.c;
      if (ok) correct++;
      else {
        var k = qkey(q);
        if (w.indexOf(k) < 0) w.push(k);
      }
      details.push({ q: q, chosen: a, ok: ok });
    });
    LddStore.setWrong(w);
    var total = exam.list.length;
    var pct = total ? Math.round(correct / total * 100) : 0;
    var usedTime = exam.totalTime - examRemaining();
    if (usedTime < 0) usedTime = 0;
    if (usedTime > exam.totalTime) usedTime = exam.totalTime;
    $('er-num').textContent = correct;
    $('er-den').textContent = '/ ' + total;
    $('er-ok').textContent = correct;
    $('er-no').textContent = total - correct;
    $('er-pct').textContent = pct + '%';
    $('er-circle').style.setProperty('--deg', (pct * 3.6) + 'deg');
    $('er-msg').textContent = pct >= 80 ? 'Xuất sắc! 🎉' : pct >= 60 ? 'Đạt yêu cầu 👍' : pct >= 50 ? 'Cần cố gắng thêm' : 'Cần ôn lại nhiều 💪';
    $('er-sub').textContent = 'Thời gian: ' + fmtTime(usedTime) + ' · ' + correct + '/' + total + ' câu đúng';
    var rev = $('er-review');
    rev.innerHTML = '';
    details.forEach(function (d, i) {
      var div = document.createElement('div');
      div.className = 'review-item' + (d.ok ? ' ok' : '');
      var chosenText = d.chosen >= 0 ? LETTERS[d.chosen] + '. ' + escapeHtml(d.q.o[d.chosen]) : '(chưa trả lời)';
      div.innerHTML = '<div class="rq">Câu ' + (i + 1) + ': ' + escapeHtml(d.q.q) + '</div>' +
        '<div class="ra">Đáp án đúng: <b>' + LETTERS[d.q.c] + '. ' + escapeHtml(d.q.o[d.q.c]) + '</b><br>' +
        (d.ok ? '✓ Bạn chọn đúng' : (d.chosen >= 0 ? '✗ Bạn chọn: <span class="wrong-ans">' + chosenText + '</span>' : '✗ Bạn chưa trả lời')) +
        (d.q.e ? '<br><br>💡 ' + escapeHtml(d.q.e) : '') + '</div>';
      rev.appendChild(div);
    });
    LddStore.pushHistory({ type: 'Thi thử', setId: activeSetId, score: correct, total: total, date: Date.now(), time: usedTime });
    LddStore.clearSession();
    activeKind = null;
    show('exam-result');
  }

  /* ---------- shared "Danh sách câu" picker (Batch D) ----------
   * Full-screen question grid used by Study, Exam and (Batch E) View Answer.
   * 4 columns, ~64px targets, text+style states (never color alone), full
   * accessible labels. Jump preserves answers/score/shuffled mapping: only
   * the position index changes, then the normal render + persist path runs.
   * Cancelling changes nothing, so the reading position is preserved.
   * Reopening scrolls the current question into view. */
  var pickerCtx = null;
  window.openQuestionPicker = function () {
    if ($('screen-exam') && $('screen-exam').classList.contains('active') && exam.list.length && !exam.submitted) { openExamPicker(); return; }
    if (typeof view !== 'undefined' && view && view.active) { openViewPicker(); return; }
    openStudyPicker();
  };
  window.closeQuestionPicker = function () {
    if ($('picker-overlay')) $('picker-overlay').hidden = true;
    pickerCtx = null;
  };
  function renderPicker(opts) {
    // opts: { sub, legend, total, cur, cls(i), mark(i), label(i), pick(i) }
    pickerCtx = opts;
    $('picker-title').textContent = 'Danh sách câu';
    $('picker-sub').textContent = opts.sub || '';
    $('picker-legend').innerHTML = opts.legend || '';
    var g = $('picker-grid');
    g.innerHTML = '';
    for (var i = 0; i < opts.total; i++) {
      (function (i) {
        var c = document.createElement('button');
        c.className = 'picker-cell ' + (opts.cls(i) || '');
        c.setAttribute('aria-label', opts.label(i));
        if (i === opts.cur) c.setAttribute('aria-current', 'true');
        c.innerHTML = '<span class="pn" aria-hidden="true">' + (i + 1) + '</span>' + (opts.mark(i) || '');
        c.onclick = function () {
          window.closeQuestionPicker();
          opts.pick(i);
        };
        g.appendChild(c);
      })(i);
    }
    $('picker-overlay').hidden = false;
    var cur = g.querySelector('.picker-cell.cur');
    if (cur && typeof cur.scrollIntoView === 'function') {
      setTimeout(function () { try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {} }, 50);
    }
  }
  function studyCellState(i) {
    var a = study.answers[i];
    if (a === undefined || a < 0) return '';
    return a === study.list[i].c ? 'ok' : 'bad';
  }
  function openStudyPicker() {
    if (!study.list.length || study.transient) return;
    var wrongMode = !!study.isWrongReview;
    var sub = wrongMode
      ? 'Ôn câu sai · vị trí trong buổi ôn này (' + study.list.length + ' câu)'
      : 'Ôn tập · ' + setTitleOf(activeSetId);
    renderPicker({
      sub: sub,
      legend: '<span>◉ Đang làm</span><span>✓ Đã trả lời</span><span>✕ Trả lời sai</span><span>○ Chưa trả lời</span>',
      total: study.list.length,
      cur: study.idx,
      cls: function (i) {
        var s = (i === study.idx ? 'cur' : '') + (studyCellState(i) ? ' ' + studyCellState(i) : '');
        return s.trim();
      },
      mark: function (i) {
        var st = studyCellState(i);
        if (st === 'ok') return '<span class="ps" aria-hidden="true">✓</span>';
        if (st === 'bad') return '<span class="ps" aria-hidden="true">✕</span>';
        return '';
      },
      label: function (i) {
        var st = studyCellState(i);
        return 'Câu ' + (i + 1) + ', ' + (i === study.idx ? 'đang làm, ' : '') +
          (st === '' ? 'chưa trả lời' : (st === 'ok' ? 'đã trả lời đúng' : 'đã trả lời sai'));
      },
      pick: function (i) {
        study.idx = i;
        renderStudy();
        persistSession();
        window.scrollTo(0, 0);
      }
    });
  }
  function openExamPicker() {
    if (!exam.list.length || exam.submitted) return;
    renderPicker({
      sub: 'Thi thử · ' + setTitleOf(activeSetId),
      legend: '<span>◉ Đang làm</span><span>✓ Đã trả lời</span><span>○ Chưa trả lời</span>',
      total: exam.list.length,
      cur: exam.idx,
      cls: function (i) {
        var s = i === exam.idx ? 'cur' : '';
        if (exam.answers[i] >= 0) s += ' ok';
        return s.trim();
      },
      mark: function (i) {
        return exam.answers[i] >= 0 ? '<span class="ps" aria-hidden="true">✓</span>' : '';
      },
      label: function (i) {
        return 'Câu ' + (i + 1) + ', ' + (i === exam.idx ? 'đang làm, ' : '') +
          (exam.answers[i] >= 0 ? 'đã trả lời' : 'chưa trả lời');
      },
      pick: function (i) {
        exam.idx = i;
        renderExam();
        persistSession();
        window.scrollTo(0, 0);
      }
    });
  }

  /* ---------- "Xem đáp án" read-only mode (Batch E) ----------
   * Separate learner mode: read study material without answering a quiz.
   * NOT Study, NOT Exam. Isolation is structural: this section never calls
   * answerStudy/selectExam/submitExam, never writes wrong membership, exam
   * scores, history or the unfinished-session slot, and never starts quiz
   * sessions. The displayed correct answer comes DIRECTLY from the course
   * data (q.o[q.c]) — never inferred or recalculated. Only an explicit star
   * tap may change Starred; the per-set view position uses its own slot. */
  function viewResumeIndex(setId, list) {
    try {
      var k = (LddStore.getViewPos() || {})[setId];
      if (k) {
        for (var i = 0; i < list.length; i++) {
          if (LddStore.key(list[i].setId, list[i].id) === k) return i;
        }
      }
    } catch (e) {}
    return 0;
  }
  window.startView = function (setId) {
    var list = questionsOf(setId || activeSetId);
    if (!list.length) { toast('Bộ đề này chưa có câu hỏi'); return; }
    var idx = viewResumeIndex(setId || activeSetId, list);
    openViewAt(list[idx].setId, list[idx].id, { type: 'home', setId: list[idx].setId });
  };
  function openViewAt(setId, qid, origin) {
    var list = questionsOf(setId);
    if (!list.length) { toast('Bộ đề này chưa có câu hỏi'); return; }
    var idx = 0;
    for (var i = 0; i < list.length; i++) if (list[i].id === qid) { idx = i; break; }
    activeSetId = setId;
    view = { active: true, setId: setId, list: list, idx: idx, origin: origin || { type: 'home', setId: setId }, topic: 'all' };
    // Isolation: deliberately no persistSession() — viewing must never
    // overwrite an unfinished Study/Exam session.
    show('view');
    renderView();
  }
  window.openViewAt = openViewAt;
  // Topic filter applies ONLY to home-origin answer viewing of the combined set.
  // All questions preserve original IDs; study/exam sessions never use this list.
  var REVIEW_TOPICS = [
    { id: '7', label: 'Chuyên đề 7' },
    { id: '4', label: 'Chuyên đề 4' },
    { id: '9', label: 'Chuyên đề 9' },
    { id: '10', label: 'Chuyên đề 10' }
  ];
  function reviewTopicId(q) {
    var m = /^Chuyên đề (4|7|9|10)(?: ·|$)/.exec(q && q.category || '');
    return m ? m[1] : '';
  }
  function canFilterReview() {
    return view.active && view.setId === 'chuyen-de-4-7-9-10' &&
      (!view.origin || view.origin.type === 'home');
  }
  function updateReviewTopicPicker() {
    var wrapper = $('view-topic-filter'), select = $('view-topic-select');
    if (!wrapper || !select) return;
    wrapper.hidden = !canFilterReview();
    if (wrapper.hidden) return;
    var all = questionsOf(view.setId);
    select.innerHTML = '';
    [{ id: 'all', label: 'Tất cả chuyên đề' }].concat(REVIEW_TOPICS).forEach(function (topic) {
      var count = topic.id === 'all' ? all.length : all.filter(function (q) {
        return reviewTopicId(q) === topic.id;
      }).length;
      var opt = document.createElement('option');
      opt.value = topic.id;
      opt.textContent = topic.label + ' (' + count + ' câu)';
      select.appendChild(opt);
    });
    select.value = view.topic || 'all';
  }
  window.changeViewTopic = function (topic) {
    if (!canFilterReview()) return;
    var allowed = topic === 'all' || REVIEW_TOPICS.some(function (t) { return t.id === topic; });
    if (!allowed) return;
    var current = view.list[view.idx];
    var all = questionsOf(view.setId);
    var next = topic === 'all' ? all : all.filter(function (q) { return reviewTopicId(q) === topic; });
    if (!next.length) { toast('Chuyên đề này chưa có câu hỏi'); updateReviewTopicPicker(); return; }
    view.topic = topic;
    view.list = next;
    var same = current && next.findIndex(function (q) { return q.id === current.id; });
    view.idx = same >= 0 ? same : 0;
    renderView();
    window.scrollTo(0, 0);
  };

  function renderView() {
    var q = view.list[view.idx];
    if (!q) return;
    var total = view.list.length;
    updateReviewTopicPicker();
    $('view-title').textContent = 'Câu ' + (view.idx + 1) + ' / ' + total;
    $('view-sub').textContent = 'Xem đáp án · ' + setTitleOf(view.setId) + (view.topic && view.topic !== 'all' ? ' · Chuyên đề ' + view.topic : '');
    var org = view.origin || {};
    $('view-back').setAttribute('aria-label',
      org.type === 'search' ? 'Quay lại tìm kiếm' : (org.type === 'star' ? 'Quay lại câu đã lưu' : 'Quay lại'));
    var cat = $('view-cat');
    if (q.category) { cat.style.display = ''; cat.textContent = q.category; }
    else cat.style.display = 'none';
    $('view-q').textContent = q.q;
    // Correct answer DIRECTLY from course data — never inferred.
    var ans = $('view-ans');
    ans.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'opt correct';
    d.setAttribute('role', 'note');
    d.setAttribute('aria-label', 'Đáp án đúng ' + LETTERS[q.c] + ': ' + q.o[q.c]);
    d.innerHTML = '<span class="letter" aria-hidden="true">' + LETTERS[q.c] + '</span><span class="otext">' +
      escapeHtml(q.o[q.c]) + '</span><span class="tag">✓ Đáp án đúng</span>';
    ans.appendChild(d);
    // ONLY the existing explanation from data, when present.
    var exp = $('view-exp');
    if (q.e) {
      exp.innerHTML = '<div class="feedback ok"><div class="head">Giải thích</div><div class="exp">' +
        escapeHtml(q.e) + '</div></div>';
    } else {
      exp.innerHTML = '';
    }
    var on = LddStore.getStars().indexOf(qkey(q)) >= 0;
    var starBtn = $('view-star');
    var starIco = $('view-star-ico');
    var starTxt = $('view-star-txt');
    if (starIco) starIco.textContent = on ? '★' : '☆';
    if (starTxt) starTxt.textContent = on ? 'Đã lưu' : 'Lưu câu';
    starBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    starBtn.setAttribute('aria-label', on ? 'Đã lưu (bỏ lưu câu này)' : 'Lưu câu (đánh dấu câu này)');
    starBtn.classList.toggle('on', on);
    $('view-prev').disabled = view.idx === 0;
    $('view-next').disabled = view.idx === total - 1;
    // Simple completion state at the last question — no score/results.
    var done = $('view-done');
    if (view.idx === total - 1) {
      done.hidden = false;
      $('view-done-n').textContent = total;
    } else {
      done.hidden = true;
    }
    // Separate per-set position slot — never the quiz-session slot.
    try {
      var m = LddStore.getViewPos() || {};
      m[view.setId] = LddStore.key(q.setId, q.id);
      LddStore.setViewPos(m);
    } catch (e2) {}
  }
  window.viewPrev = function () {
    if (!view.active || view.idx === 0) return;
    view.idx--;
    renderView();
    window.scrollTo(0, 0);
  };
  window.viewNext = function () {
    if (!view.active || view.idx === view.list.length - 1) return;
    view.idx++;
    renderView();
    window.scrollTo(0, 0);
  };
  // Explicit star taps are the ONLY quiz-adjacent write allowed in viewing.
  window.toggleViewStar = function () {
    var q = view.list[view.idx];
    if (!q) return;
    var s = LddStore.getStars();
    var k = qkey(q);
    var pos = s.indexOf(k);
    if (pos >= 0) { s.splice(pos, 1); toast('Đã bỏ đánh dấu'); }
    else { s.push(k); toast('⭐ Đã đánh dấu câu này'); }
    LddStore.setStars(s);
    renderView();
  };
  window.exitView = function () {
    var o = (view && view.origin) || { type: 'home' };
    view = { active: false, setId: null, list: [], idx: 0, origin: null };
    if (o.type === 'search') {
      lastSearchQuery = o.query || lastSearchQuery;
      lastSearchScroll = o.scroll || 0;
      var inp = $('search-input');
      if (inp) inp.value = lastSearchQuery;
      show('search');
    } else if (o.type === 'star') {
      lastListScroll = o.scroll || 0;
      openList('star', o.setId || undefined, true);
    } else {
      show('home');
    }
  };
  window.exitViewToHome = function () {
    view = { active: false, setId: null, list: [], idx: 0, origin: null };
    show('home');
  };
  function openViewPicker() {
    if (!view || !view.active || !view.list.length) return;
    renderPicker({
      sub: 'Xem đáp án · ' + setTitleOf(view.setId),
      legend: '<span>◉ Đang xem</span>',
      total: view.list.length,
      cur: view.idx,
      cls: function (i) { return i === view.idx ? 'cur' : ''; },
      mark: function () { return ''; },
      label: function (i) { return 'Câu ' + (i + 1) + (i === view.idx ? ', đang xem' : ''); },
      pick: function (i) {
        view.idx = i;
        renderView();
        window.scrollTo(0, 0);
      }
    });
  }

  /* ---------- wrong / star / history / search (composite keys) ---------- */
  window.openList = function (type, setId, keepScroll) {
    if (!keepScroll) lastListScroll = 0;
    var ids = type === 'wrong' ? LddStore.getWrong() : LddStore.getStars();
    if (setId) {
      ids = ids.filter(function (k) {
        var q = LddStore.questionById(cache, k);
        return q && q.setId === setId;
      });
    }
    // ignore stale keys whose questions were removed from newer content
    ids = ids.filter(function (k) { return LddStore.questionById(cache, k); });
    var scope = setId ? ' · ' + setTitleOf(setId) : '';
    $('list-title').textContent = type === 'wrong' ? '❌ Câu đã sai' : '⭐ Câu đã đánh dấu';
    // Batch E: starred taps open answer VIEWING — say so. Wrong taps stay
    // PRACTICE (transient quiz), unchanged.
    $('list-sub').textContent = ids.length + ' câu' + (type === 'star' ? ' · chạm để xem đáp án' : '') + scope;
    var cont = $('list-content');
    cont.innerHTML = '';
    if (!ids.length) {
      cont.innerHTML = '<div class="empty-state"><div class="big">' + (type === 'wrong' ? '🎉' : '☆') +
        '</div><p>' + (type === 'wrong' ? 'Chưa có câu nào sai. Tuyệt vời!' : 'Chưa có câu nào được đánh dấu.') + '</p></div>';
      show('list');
      return;
    }
    ids.forEach(function (k) {
      var q = LddStore.questionById(cache, k);
      if (!q) return;
      var b = document.createElement('button');
      b.className = 'list-item';
      b.setAttribute('aria-label', escapeHtml(q.q));
      b.innerHTML = '<span class="ltxt"><b>' + escapeHtml(setTitleOf(q.setId)) + '</b><br>' + escapeHtml(q.q) + '</span>';
      b.onclick = function () {
        lastListScroll = window.scrollY || 0;
        if (type === 'star') {
          // Batch E: saved questions open in read-only answer viewing.
          openViewAt(q.setId, q.id, { type: type, setId: setId || null, scroll: window.scrollY || 0 });
        } else {
          // Wrong-question taps stay PRACTICE (transient single-question quiz).
          openSingleQuestion(k, { type: type, setId: setId || null });
        }
      };
      cont.appendChild(b);
    });
    show('list');
  };

  function openSingleQuestion(k, origin) {
    var q = LddStore.questionById(cache, k);
    if (!q) { toast('Câu này đã bị gỡ khỏi bộ đề'); return; }
    activeSetId = q.setId;
    // Transient review: in-memory only, never overwrites a kept session.
    study = { list: [q], idx: 0, answers: [-1], transient: true, origin: origin || { type: 'list' } };
    activeKind = 'study';
    updateStudyHeader();
    show('study');
    renderStudy();
  }
  window.openSingleQuestion = openSingleQuestion;

  function renderHistory() {
    var cont = $('hist-content');
    var h = LddStore.getHistory();
    $('hist-sub').textContent = h.length + ' bài';
    cont.innerHTML = '';
    if (!h.length) {
      cont.innerHTML = '<div class="empty-state"><div class="big">🕘</div><p>Chưa có lịch sử làm bài.</p></div>';
      return;
    }
    h.forEach(function (e) {
      var pct = e.total ? Math.round(e.score / e.total * 100) : 0;
      var div = document.createElement('div');
      div.className = 'hist-item';
      div.innerHTML = '<div class="h-left"><b>' + escapeHtml(e.type) +
        (e.setId ? ' · ' + escapeHtml(setTitleOf(e.setId)) : '') +
        (e.time ? ' · ' + fmtTime(e.time) : '') + '</b><small>' + fmtDate(e.date) + '</small></div>' +
        '<div class="h-score ' + (pct >= 80 ? 'high' : pct < 50 ? 'low' : '') + '">' + e.score + '/' + e.total + '</div>';
      cont.appendChild(div);
    });
  }

  window.doSearch = function () {
    var raw = ($('search-input').value || '');
    lastSearchQuery = raw.trim();
    var kw = normalizeVi(lastSearchQuery);
    var cont = $('search-results');
    cont.innerHTML = '';
    var countEl = document.createElement('p');
    countEl.className = 'set-meta';
    countEl.id = 'search-count';
    if (!kw) {
      cont.innerHTML = '<div class="empty-state"><div class="big">🔍</div><p>Nhập từ khóa để tìm câu hỏi</p></div>';
      return;
    }
    var results = [];
    LddStore.allQuestions(cache).forEach(function (q) {
      // Batch 4 §4.3: accent-insensitive match over question + options.
      // Displayed source text is never mutated — only the compared form.
      if (normalizeVi(q.q).indexOf(kw) >= 0 || q.o.some(function (o) { return normalizeVi(o).indexOf(kw) >= 0; })) {
        results.push(q);
      }
    });
    results = results.slice(0, 100);
    if (!results.length) {
      cont.innerHTML = '<div class="empty-state"><div class="big">😕</div><p>Không tìm thấy câu hỏi nào cho “' + escapeHtml(lastSearchQuery) + '”</p></div>';
      return;
    }
    var info = document.createElement('p');
    info.className = 'set-meta';
    info.id = 'search-count';
    info.textContent = 'Tìm thấy ' + results.length + ' câu cho “' + lastSearchQuery + '”';
    cont.appendChild(info);
    results.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'list-item';
      b.innerHTML = '<span class="ltxt"><b>' + escapeHtml(setTitleOf(q.setId)) + '</b><br>' + escapeHtml(q.q) + '</span>';
      b.onclick = function () {
        lastSearchScroll = window.scrollY || 0;
        // Batch E: search results open directly in read-only answer viewing.
        // Back restores query + result list + scroll via exitView.
        openViewAt(q.setId, q.id, { type: 'search', query: lastSearchQuery, scroll: window.scrollY || 0 });
      };
      cont.appendChild(b);
    });
  };

  /* ---------- interrupted session restore (B1/B2/B6/B7) ----------
   * v2 format persists the EXACT displayed snapshots (question + option order
   * + correct mapping) plus per-question answers. v1 key-only sessions
   * (keys/ids + study ok/no or exam answers/timeLeft) still restore. */
  function persistSession() {
    try {
      // B7: DOM-independent — driven by activeKind, never by screen classes.
      if (activeKind === 'study' && study.list.length && !study.transient) {
        LddStore.setSession({
          v: 2, kind: 'study', setId: activeSetId,
          keys: study.list.map(function (q) { return LddStore.key(q.setId, q.id); }),
          idx: study.idx, answers: study.answers.slice(), list: snapshotList(study.list),
          isWrongReview: !!study.isWrongReview, wrongSetId: study.wrongSetId || null
        });
      } else if (activeKind === 'exam' && exam.list.length) {
        LddStore.setSession({
          v: 2, kind: 'exam', setId: activeSetId,
          keys: exam.list.map(function (q) { return LddStore.key(q.setId, q.id); }),
          idx: exam.idx, answers: exam.answers.slice(), list: snapshotList(exam.list),
          timeLeft: examRemaining(), totalTime: exam.totalTime, endsAt: exam.endsAt || 0
        });
      }
    } catch (e) {}
  }
  // Persist on every visibility/pagehide transition (B7). Never beforeunload-only.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') persistSession();
    else if (activeKind === 'exam' && exam.list.length) { updateTimerDisplay(examRemaining()); }
  });
  window.addEventListener('pagehide', function () { persistSession(); });

  function sessionKeys(s) {
    // tolerate previous-era sessions that stored bare `ids`
    return s && (s.keys || (s.ids || []).map(function (id) {
      var q = LddStore.questionById(cache, id);
      return q ? LddStore.key(q.setId, q.id) : null;
    }));
  }

  function restoreSessionNow(s) {
    var keys = sessionKeys(s);
    if (!s || !keys || !keys.length) return false;
    var list = null;
    // B1: prefer exact snapshots when present and valid.
    if (Array.isArray(s.list) && s.list.length === keys.length && s.list.every(validSnapshot)) {
      list = restoreList(s.list);
    } else {
      list = keys.map(function (k) { return LddStore.questionById(cache, k); });
      if (list.some(function (q) { return !q; })) { LddStore.clearSession(); return false; }
    }
    activeSetId = s.setId;
    if (s.kind === 'study') {
      var answers = Array.isArray(s.answers) && s.answers.length === list.length
        ? s.answers.map(function (a) { return (a === 0 || a === 1 || a === 2 || a === 3) ? a : -1; })
        : list.map(function () { return -1; });
      study = { list: list, idx: Math.min(s.idx || 0, list.length - 1), answers: answers, transient: false, origin: null, isWrongReview: !!s.isWrongReview, wrongSetId: s.wrongSetId || null, wrongSnapshot: null };
      activeKind = 'study';
      $('study-title').textContent = 'Câu ' + (study.idx + 1) + ' / ' + list.length;
      $('study-sub').textContent = 'Ôn tập · ' + setTitleOf(activeSetId);
      show('study');
      renderStudy();
      return true;
    }
    // exam: absolute deadline survives reload/background (B6)
    var endsAt = s.endsAt || 0;
    var total = s.totalTime || 600;
    if (!endsAt && (s.timeLeft || 0) > 0) endsAt = Date.now() + (s.timeLeft | 0) * 1000;
    if (endsAt && endsAt <= Date.now()) {
      // Deadline already passed while away: finalize immediately, no extension.
      exam = {
        list: list, idx: Math.min(s.idx || 0, list.length - 1),
        answers: (Array.isArray(s.answers) && s.answers.length === list.length) ? s.answers : new Array(list.length).fill(-1),
        totalTime: total, timeLeft: 0, endsAt: endsAt, timerId: null, submitted: false
      };
      activeKind = 'exam';
      show('exam');
      renderExam();
      submitExam();
      toast('⏰ Hết giờ — bài đã được nộp tự động');
      return true;
    }
    exam = {
      list: list, idx: Math.min(s.idx || 0, list.length - 1),
      answers: (Array.isArray(s.answers) && s.answers.length === list.length) ? s.answers : new Array(list.length).fill(-1),
      totalTime: total, timeLeft: 0, endsAt: endsAt || (Date.now() + total * 1000), timerId: null, submitted: false
    };
    exam.timeLeft = examRemaining();
    activeKind = 'exam';
    show('exam');
    renderExam();
    startExamTimer();
    return true;
  }

  window.resumeSession = function () {
    var s = LddStore.getSession();
    if (s) restoreSessionNow(s);
    else renderHome();
  };

  window.discardSession = function () {
    var kept = null;
    try { kept = keptSession(); } catch (eK) {}
    showModal({
      title: 'Bỏ bài đang làm dở?',
      msg: 'Bài làm dở sẽ bị xóa khỏi máy. Chỉ bỏ khi bạn chắc chắn muốn làm lại từ đầu.',
      progress: kept ? sessionProgress(kept) : null,
      safeLabel: 'Giữ lại bài',
      dangerLabel: 'Bỏ bài',
      onSafe: function () {},
      onDanger: function () {
        LddStore.clearSession();
        activeKind = null;
        renderHome();
      }
    });
  };

  function offerResume() {
    // Batch 3 §3.2: no vague browser confirm. The Home resume card
    // (renderHome) is the visible resume affordance with full context.
    // Only drop silently-vanished sessions here.
    var s = LddStore.getSession();
    var keys = sessionKeys(s);
    if (!s || !keys || !keys.length) return;
    var probe = Array.isArray(s.list) && s.list.length === keys.length
      ? s.list.every(validSnapshot)
      : keys.every(function (k) { return LddStore.questionById(cache, k); });
    if (!probe) { LddStore.clearSession(); renderHome(); return; }
    renderHome();
  }

  /* ---------- service worker: APP VERSION update flow ----------
   * Content updates arrive via syncContent() above and never need this
   * button. This banner is only for new HTML/CSS/JS deployments. */
  var swReg = null;
  var swReloadDeferred = false;
  window.applyAppUpdate = function () {
    // B5: persist the learner session BEFORE activating the new worker so an
    // approved update never loses position/answers.
    try { persistSession(); } catch (e) {}
    if (swReg && swReg.waiting) swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  };
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        swReg = reg;
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              $('update-banner').classList.add('show');
            }
          });
        });
      }).catch(function () {});
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        // B5: never auto-reload an active Study/Exam session — it would wipe
        // in-memory state. Keep the banner so the learner updates at a safe
        // point (session was already persisted by applyAppUpdate).
        if (sessionActive()) {
          swReloadDeferred = true;
          var b = $('update-banner');
          if (b) b.classList.add('show');
          toast('Sẽ cập nhật sau khi bạn xong bài hiện tại');
          return;
        }
        window.location.reload();
      });
    });
  }

  initialLoad();
})();
