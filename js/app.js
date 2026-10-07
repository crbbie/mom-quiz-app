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

  var study = { list: [], idx: 0, answered: false, chosen: -1, ok: 0, no: 0 };
  var exam = { list: [], idx: 0, answers: [], timeLeft: 0, totalTime: 0, timerId: null };

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

  window.show = show;
  window.toggleSwitch = function (el) { el.classList.toggle('on'); };

  function show(screenId) {
    document.querySelectorAll('.screen').forEach(function (s) { s.classList.remove('active'); });
    var el = $('screen-' + screenId);
    if (el) el.classList.add('active');
    window.scrollTo(0, 0);
    if (screenId === 'home') renderHome();
    if (screenId === 'history') renderHistory();
    if (screenId === 'search') { setTimeout(function () { $('search-input').focus(); }, 100); doSearch(); }
  }

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

  // Compare catalog version + per-set versions; download only what changed.
  // Never interrupts an active study/exam session: the session keeps its
  // in-memory questions; new content applies to future sessions.
  async function syncContent(manual) {
    if (!navigator.onLine && !manual) {
      if (cache.sets.length) setSyncStatus('off', 'Ngoại tuyến — đang dùng bộ đề đã lưu (' + cache.sets.length + ' bộ)');
      return;
    }
    if (manual) setSyncStatus('on', 'Đang kiểm tra dữ liệu mới…');
    var catalog;
    try {
      catalog = await fetchFresh('data/catalog.json');
    } catch (e) {
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
    var ok = true;

    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      var old = oldById[s.id];
      if (old && old.version === s.version && old.file === s.file && cache.questionsBySet[s.id]) {
        questionsBySet[s.id] = cache.questionsBySet[s.id];
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
      } catch (e2) {
        if (cache.questionsBySet[s.id]) {
          questionsBySet[s.id] = cache.questionsBySet[s.id]; // keep old copy
        } else {
          ok = false; // brand-new set failed to download; skip it for now
        }
      }
    }

    if (!ok && !Object.keys(questionsBySet).length && !cache.sets.length) {
      setSyncStatus('off', 'Chưa tải được dữ liệu — thử lại khi có mạng');
      return;
    }

    var usableSets = sets.filter(function (s) { return questionsBySet[s.id]; });
    var active = sessionActive();
    LddStore.setCache(catalog.version || 0, usableSets, questionsBySet);
    cache = LddStore.getCache();
    LddStore.migrateAll(cache, seedIdsOfFirstSet());
    LddStore.pruneStaleIds(cache);

    if (changed) {
      if (!active) renderHome();
      setSyncStatus('on', 'Đã cập nhật · ' + fmtDate(Date.now()));
      // Never pop a toast over an active study/exam session; the new
      // content simply applies to future sessions.
      if (!active || manual) toast('Đã cập nhật dữ liệu mới');
    } else {
      if (!active) renderHome();
      setSyncStatus('on', 'Bộ đề đã mới nhất · ' + cache.sets.length + ' bộ');
      if (manual) toast('Dữ liệu đã mới nhất');
    }
  }

  window.manualSync = function () { syncContent(true); };
  window.addEventListener('online', function () { syncContent(false); });

  /* ---------- home ---------- */
  function renderHome() {
    cache = LddStore.getCache();
    var stars = LddStore.getStars(), wrong = LddStore.getWrong();
    var bw = $('badge-wrong');
    bw.textContent = wrong.length;
    bw.classList.toggle('empty', wrong.length === 0);
    var bs = $('badge-star');
    bs.textContent = stars.length;
    bs.classList.toggle('empty', stars.length === 0);

    var box = $('set-list');
    box.innerHTML = '';
    if (!cache.sets.length) {
      var online = navigator.onLine;
      box.innerHTML = '<div class="empty-state"><div class="big">📚</div><p>' +
        (online ? 'Chưa tải được bộ đề.<br>Nhấn “Cập nhật dữ liệu” để thử lại.'
                : 'Chưa có dữ liệu offline.<br>Vui lòng kết nối mạng rồi mở lại app để tải bộ đề lần đầu.') +
        '</p></div>';
      setSyncStatus('off', online ? 'Chưa có dữ liệu' : 'Ngoại tuyến — cần mạng cho lần đầu');
      return;
    }
    cache.sets.forEach(function (s) {
      var n = questionsOf(s.id).length;
      var upd = s.updated_at ? fmtDate(Date.parse(s.updated_at)) : '';
      var card = document.createElement('div');
      card.className = 'set-card';
      card.innerHTML =
        '<h2>' + escapeHtml(s.title) + '</h2>' +
        (s.description ? '<p class="set-desc">' + escapeHtml(s.description) + '</p>' : '') +
        '<div class="set-meta">' + n + ' câu' + (upd ? ' · cập nhật ' + escapeHtml(upd) : '') + '</div>' +
        '<div class="set-actions">' +
        '<button class="btn primary" data-act="study">📖 Ôn tập</button>' +
        '<button class="btn ghost" data-act="exam">📝 Thi thử</button>' +
        '</div>';
      card.querySelector('[data-act="study"]').onclick = function () { startStudy(s.id); };
      card.querySelector('[data-act="exam"]').onclick = function () {
        activeSetId = s.id;
        $('exam-setup-title').textContent = 'Thi thử — ' + s.title;
        show('exam-setup');
      };
      box.appendChild(card);
    });

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
    var list = questionsOf(setId || activeSetId);
    if (!setId && !activeSetId && cache.sets.length) {
      list = questionsOf(cache.sets[0].id);
    }
    if (!list.length) { toast('Bộ đề này chưa có câu hỏi'); return; }
    activeSetId = setId || activeSetId || (cache.sets[0] && cache.sets[0].id);
    var prefs = LddStore.getPrefs();
    if (prefs.shuffleQ) list = shuffle(list);
    if (prefs.shuffleA) list = list.map(shuffleOptions);
    study = { list: list, idx: 0, answered: false, chosen: -1, ok: 0, no: 0 };
    persistSession();
    $('study-title').textContent = 'Ôn tập — ' + setTitleOf(activeSetId);
    show('study');
    renderStudy();
  }
  window.restartStudy = function () { startStudy(activeSetId); };

  function qkey(q) { return LddStore.key(q.setId, q.id); }

  function renderStudy() {
    var q = study.list[study.idx];
    if (!q) return;
    var total = study.list.length;
    $('study-sub').textContent = 'Câu ' + (study.idx + 1) + ' / ' + total;
    $('study-pill').textContent = 'Câu ' + (study.idx + 1);
    $('study-counter').textContent = study.ok + ' đúng · ' + study.no + ' sai';
    $('study-progress').style.width = (study.idx / total * 100) + '%';
    $('study-q').textContent = q.q;
    var cat = $('study-cat');
    if (q.category) { cat.style.display = ''; cat.textContent = q.category; }
    else cat.style.display = 'none';
    var starOn = LddStore.getStars().indexOf(qkey(q)) >= 0;
    $('study-star').textContent = starOn ? '★' : '☆';
    $('study-star').classList.toggle('on', starOn);

    var opts = $('study-opts');
    opts.innerHTML = '';
    q.o.forEach(function (text, i) {
      var b = document.createElement('button');
      b.className = 'opt';
      b.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span class="otext">' + escapeHtml(text) + '</span>';
      b.onclick = function () { answerStudy(i); };
      opts.appendChild(b);
    });
    $('study-feedback').innerHTML = '';
    $('study-next').disabled = !study.answered;
    $('study-next').textContent = study.answered
      ? (study.idx === total - 1 ? 'Hoàn thành ✓' : 'Tiếp theo ›')
      : 'Tiếp theo ›';
    $('study-prev').disabled = study.idx === 0;
    if (study.answered) revealStudyAnswer();
  }

  function revealStudyAnswer() {
    var q = study.list[study.idx];
    var nodes = $('study-opts').querySelectorAll('.opt');
    nodes.forEach(function (el, i) {
      el.onclick = null;
      if (i === q.c) el.classList.add('correct');
      else if (i === study.chosen) el.classList.add('wrong');
      else el.classList.add('dim');
    });
    var ok = study.chosen === q.c;
    $('study-feedback').innerHTML =
      '<div class="feedback ' + (ok ? 'ok' : 'no') + '">' +
      '<div class="head">' + (ok ? '✓ Chính xác!' : '✗ Chưa đúng') + '</div>' +
      '<div class="exp"><b>Đáp án đúng: ' + LETTERS[q.c] + '.</b> ' + escapeHtml(q.o[q.c]) +
      (q.e ? '<br><br>💡 ' + escapeHtml(q.e) : '') + '</div></div>';
  }

  window.answerStudy = answerStudy;
  function answerStudy(i) {
    if (study.answered) return;
    var q = study.list[study.idx];
    study.answered = true;
    study.chosen = i;
    var k = qkey(q);
    if (i === q.c) {
      study.ok++;
      LddStore.setWrong(LddStore.getWrong().filter(function (id) { return id !== k; }));
    } else {
      study.no++;
      var w2 = LddStore.getWrong();
      if (w2.indexOf(k) < 0) { w2.push(k); LddStore.setWrong(w2); }
    }
    revealStudyAnswer();
    $('study-next').disabled = false;
    $('study-counter').textContent = study.ok + ' đúng · ' + study.no + ' sai';
    persistSession();
  }

  window.studyNext = function () {
    if (!study.answered) return;
    if (study.idx === study.list.length - 1) { finishStudy(); return; }
    study.idx++; study.answered = false; study.chosen = -1;
    renderStudy();
    persistSession();
    window.scrollTo(0, 0);
  };
  window.studyPrev = function () {
    if (study.idx === 0) return;
    study.idx--; study.answered = false; study.chosen = -1;
    renderStudy();
    window.scrollTo(0, 0);
  };
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
    if (study.idx > 0 && study.idx < study.list.length - 1) {
      if (!confirm('Thoát bài ôn tập? Bạn có thể tiếp tục lại sau.')) return;
    }
    LddStore.clearSession();
    show('home');
  };

  function finishStudy() {
    var total = study.list.length;
    var pct = total ? Math.round(study.ok / total * 100) : 0;
    $('sr-num').textContent = study.ok;
    $('sr-den').textContent = '/ ' + total;
    $('sr-ok').textContent = study.ok;
    $('sr-no').textContent = study.no;
    $('sr-pct').textContent = pct + '%';
    $('sr-circle').style.setProperty('--deg', (pct * 3.6) + 'deg');
    $('sr-msg').textContent = pct >= 80 ? 'Xuất sắc! 🎉' : pct >= 60 ? 'Khá tốt! 👍' : 'Cần ôn thêm 💪';
    $('sr-sub').textContent = 'Bạn trả lời đúng ' + study.ok + ' trên ' + total + ' câu';
    LddStore.pushHistory({ type: 'Ôn tập', setId: activeSetId, score: study.ok, total: total, date: Date.now() });
    LddStore.clearSession();
    show('study-result');
  }

  /* ---------- exam ---------- */
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('#exam-count-chips .chip');
    if (c) {
      document.querySelectorAll('#exam-count-chips .chip').forEach(function (x) { x.classList.remove('on'); });
      c.classList.add('on');
    }
    var t = e.target.closest && e.target.closest('#exam-time-chips .chip');
    if (t) {
      document.querySelectorAll('#exam-time-chips .chip').forEach(function (x) { x.classList.remove('on'); });
      t.classList.add('on');
    }
  });

  window.startExam = function () {
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
    exam = { list: list, idx: 0, answers: new Array(list.length).fill(-1), totalTime: minutes * 60, timeLeft: minutes * 60, timerId: null };
    persistSession();
    show('exam');
    renderExam();
    startExamTimer();
  };

  function startExamTimer() {
    clearInterval(exam.timerId);
    updateTimerDisplay();
    exam.timerId = setInterval(function () {
      exam.timeLeft--;
      if (exam.timeLeft <= 0) {
        exam.timeLeft = 0;
        updateTimerDisplay();
        clearInterval(exam.timerId);
        alert('⏰ Hết giờ! Bài sẽ được nộp tự động.');
        submitExam();
        return;
      }
      updateTimerDisplay();
      if (exam.timeLeft % 10 === 0) persistSession();
    }, 1000);
  }
  function updateTimerDisplay() {
    var m = Math.floor(exam.timeLeft / 60), s = exam.timeLeft % 60;
    var el = $('exam-timer');
    el.textContent = '⏱ ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    el.classList.toggle('warn', exam.timeLeft <= 60);
  }

  function renderExam() {
    var q = exam.list[exam.idx];
    if (!q) return;
    var total = exam.list.length;
    $('exam-sub').textContent = 'Câu ' + (exam.idx + 1) + ' / ' + total;
    $('exam-pill').textContent = 'Câu ' + (exam.idx + 1);
    var answeredCount = exam.answers.filter(function (a) { return a >= 0; }).length;
    $('exam-counter').textContent = answeredCount + '/' + total + ' đã trả lời';
    $('exam-progress').style.width = (exam.idx / total * 100) + '%';
    $('exam-q').textContent = q.q;
    var cat = $('exam-cat');
    if (q.category) { cat.style.display = ''; cat.textContent = q.category; }
    else cat.style.display = 'none';
    var opts = $('exam-opts');
    opts.innerHTML = '';
    q.o.forEach(function (text, i) {
      var b = document.createElement('button');
      b.className = 'opt' + (exam.answers[exam.idx] === i ? ' chosen' : '');
      b.innerHTML = '<span class="letter">' + LETTERS[i] + '</span><span class="otext">' + escapeHtml(text) + '</span>';
      b.onclick = function () { selectExam(i); };
      opts.appendChild(b);
    });
    var nav = $('exam-nav');
    nav.innerHTML = '';
    exam.list.forEach(function (_, i) {
      var cell = document.createElement('button');
      cell.className = 'nav-cell' + (exam.answers[i] >= 0 ? ' done' : '') + (i === exam.idx ? ' cur' : '');
      cell.textContent = i + 1;
      cell.onclick = function () { exam.idx = i; renderExam(); window.scrollTo(0, 0); };
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
    window.scrollTo(0, 0);
  };
  window.examPrev = function () {
    if (exam.idx === 0) return;
    exam.idx--;
    renderExam();
    window.scrollTo(0, 0);
  };
  window.confirmExitExam = function () {
    if (confirm('Thoát bài thi? Kết quả sẽ không được lưu.')) {
      clearInterval(exam.timerId);
      LddStore.clearSession();
      show('home');
    }
  };
  window.confirmSubmitExam = function () {
    var blank = exam.answers.filter(function (a) { return a < 0; }).length;
    if (confirm(blank > 0 ? 'Còn ' + blank + ' câu chưa trả lời. Vẫn nộp bài?' : 'Nộp bài thi?')) submitExam();
  };

  function submitExam() {
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
    var usedTime = exam.totalTime - exam.timeLeft;
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
        (d.ok ? '✓ Bạn chọn đúng' : '✗ Bạn chọn: <span class="wrong-ans">' + chosenText + '</span>') + '</div>';
      rev.appendChild(div);
    });
    LddStore.pushHistory({ type: 'Thi thử', setId: activeSetId, score: correct, total: total, date: Date.now(), time: usedTime });
    LddStore.clearSession();
    show('exam-result');
  }

  /* ---------- wrong / star / history / search (composite keys) ---------- */
  window.openList = function (type) {
    var ids = type === 'wrong' ? LddStore.getWrong() : LddStore.getStars();
    // ignore stale keys whose questions were removed from newer content
    ids = ids.filter(function (k) { return LddStore.questionById(cache, k); });
    $('list-title').textContent = type === 'wrong' ? '❌ Câu đã sai' : '⭐ Câu đã đánh dấu';
    $('list-sub').textContent = ids.length + ' câu';
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
      b.innerHTML = '<span class="ltxt"><b>' + escapeHtml(setTitleOf(q.setId)) + '</b><br>' + escapeHtml(q.q) + '</span>';
      b.onclick = function () { openSingleQuestion(k); };
      cont.appendChild(b);
    });
    show('list');
  };

  function openSingleQuestion(k) {
    var q = LddStore.questionById(cache, k);
    if (!q) { toast('Câu này đã bị gỡ khỏi bộ đề'); return; }
    activeSetId = q.setId;
    study = { list: [q], idx: 0, answered: false, chosen: -1, ok: 0, no: 0 };
    LddStore.clearSession();
    $('study-title').textContent = 'Ôn tập — ' + setTitleOf(activeSetId);
    show('study');
    renderStudy();
  }

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
    var kw = ($('search-input').value || '').trim().toLowerCase();
    var cont = $('search-results');
    cont.innerHTML = '';
    if (!kw) {
      cont.innerHTML = '<div class="empty-state"><div class="big">🔍</div><p>Nhập từ khóa để tìm câu hỏi</p></div>';
      return;
    }
    var results = [];
    LddStore.allQuestions(cache).forEach(function (q) {
      if (q.q.toLowerCase().indexOf(kw) >= 0 || q.o.some(function (o) { return o.toLowerCase().indexOf(kw) >= 0; })) {
        results.push(q);
      }
    });
    results = results.slice(0, 100);
    if (!results.length) {
      cont.innerHTML = '<div class="empty-state"><div class="big">😕</div><p>Không tìm thấy câu hỏi nào</p></div>';
      return;
    }
    results.forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'list-item';
      b.innerHTML = '<span class="ltxt"><b>' + escapeHtml(setTitleOf(q.setId)) + '</b><br>' + escapeHtml(q.q) + '</span>';
      b.onclick = function () { openSingleQuestion(LddStore.key(q.setId, q.id)); };
      cont.appendChild(b);
    });
  };

  /* ---------- interrupted session restore ---------- */
  function persistSession() {
    try {
      if ($('screen-study') && $('screen-study').classList.contains('active') && study.list.length) {
        LddStore.setSession({
          kind: 'study', setId: activeSetId,
          keys: study.list.map(function (q) { return LddStore.key(q.setId, q.id); }),
          idx: study.idx, ok: study.ok, no: study.no
        });
      } else if ($('screen-exam') && $('screen-exam').classList.contains('active') && exam.list.length) {
        LddStore.setSession({
          kind: 'exam', setId: activeSetId,
          keys: exam.list.map(function (q) { return LddStore.key(q.setId, q.id); }),
          idx: exam.idx, answers: exam.answers,
          timeLeft: exam.timeLeft, totalTime: exam.totalTime
        });
      }
    } catch (e) {}
  }

  function offerResume() {
    var s = LddStore.getSession();
    // tolerate previous-era sessions that stored bare `ids`
    var keys = s && (s.keys || (s.ids || []).map(function (id) {
      var q = LddStore.questionById(cache, id);
      return q ? LddStore.key(q.setId, q.id) : null;
    }));
    if (!s || !keys || !keys.length) return;
    var list = keys.map(function (k) { return LddStore.questionById(cache, k); });
    if (list.some(function (q) { return !q; })) { LddStore.clearSession(); return; }
    var label = s.kind === 'exam' ? 'bài thi' : 'bài ôn';
    setTimeout(function () {
      if (!confirm('Bạn còn ' + label + ' đang làm dở. Tiếp tục?')) { LddStore.clearSession(); return; }
      activeSetId = s.setId;
      if (s.kind === 'study') {
        study = {
          list: list,
          idx: Math.min(s.idx || 0, list.length - 1), answered: false, chosen: -1,
          ok: s.ok || 0, no: s.no || 0
        };
        $('study-title').textContent = 'Ôn tập — ' + setTitleOf(activeSetId);
        show('study');
        renderStudy();
      } else {
        exam = {
          list: list,
          idx: Math.min(s.idx || 0, list.length - 1),
          answers: s.answers || new Array(list.length).fill(-1),
          timeLeft: s.timeLeft || 600, totalTime: s.totalTime || 600, timerId: null
        };
        show('exam');
        renderExam();
        startExamTimer();
      }
    }, 600);
  }

  /* ---------- service worker: APP VERSION update flow ----------
   * Content updates arrive via syncContent() above and never need this
   * button. This banner is only for new HTML/CSS/JS deployments. */
  var swReg = null;
  window.applyAppUpdate = function () {
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
        window.location.reload();
      });
    });
  }

  initialLoad();
})();
