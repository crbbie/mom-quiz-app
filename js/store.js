/* Local persistence layer — fully static, no backend.
 * CONTENT (question sets) ships as data/*.json with the deployment and is
 * cached locally. PERSONAL data (stars/wrong/history/prefs/session) is
 * device-local, keyed by COMPOSITE keys "setId:questionId" — never by array
 * position — so reorder/add/delete of questions cannot corrupt progress. */
(function () {
  'use strict';

  var K = {
    cache: 'ldd_cache_v2',      // { catalogVersion, sets:[], questionsBySet:{}, syncedAt }
    stars: 'ldd_stars_v2',      // ["setId:questionId"]
    wrong: 'ldd_wrong_v2',      // ["setId:questionId"]
    history: 'ldd_history_v1',  // [{type,setId,score,total,date,time}] (snapshots, kept)
    prefs: 'ldd_prefs_v1',      // {shuffleQ,shuffleA}
    session: 'ldd_session_v1'   // {kind,setId,keys:[...]} unfinished study/exam
  };

  // Previous keys (bare question UUIDs, Supabase era) — migrated once.
  var V1 = { cache: 'ldd_cache_v1', stars: 'ldd_stars_v1', wrong: 'ldd_wrong_v1' };

  // Original single-file prototype keys (array indices) — migrated once.
  var LEGACY = {
    wrong: 'onthi_wrong_v1',
    star: 'onthi_star_v1',
    history: 'onthi_history_v1'
  };

  // First-set id used by the legacy index migration (seed order of set 1).
  var LEGACY_SET_ID = 'kdbds-2023';

  function read(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  function key(setId, qid) { return setId + ':' + qid; }

  // ---- Content cache ----
  function getCache() {
    return read(K.cache, { catalogVersion: 0, sets: [], questionsBySet: {}, syncedAt: 0 });
  }
  function setCache(catalogVersion, sets, questionsBySet) {
    write(K.cache, { catalogVersion: catalogVersion, sets: sets, questionsBySet: questionsBySet, syncedAt: Date.now() });
  }
  function allQuestions(cache) {
    var out = [];
    Object.keys(cache.questionsBySet || {}).forEach(function (setId) {
      (cache.questionsBySet[setId] || []).forEach(function (q) { out.push(q); });
    });
    return out;
  }
  // Accepts composite "setId:qid" or bare "qid" (searched across sets).
  function questionById(cache, idOrKey) {
    var lists = cache.questionsBySet || {};
    var pos = String(idOrKey).indexOf(':');
    if (pos > 0) {
      var sid = idOrKey.slice(0, pos), qid = idOrKey.slice(pos + 1);
      var list = lists[sid] || [];
      for (var i = 0; i < list.length; i++) if (list[i].id === qid) return list[i];
      return null;
    }
    var keys = Object.keys(lists);
    for (var k = 0; k < keys.length; k++) {
      var arr = lists[keys[k]];
      for (var j = 0; j < arr.length; j++) if (arr[j].id === idOrKey) return arr[j];
    }
    return null;
  }

  // ---- Progress (composite keys; stale refs to removed questions ignored) ----
  function getStars() { return read(K.stars, []); }
  function setStars(a) { write(K.stars, a); }
  function getWrong() { return read(K.wrong, []); }
  function setWrong(a) { write(K.wrong, a); }
  function getHistory() { return read(K.history, []); }
  function pushHistory(h) {
    var arr = read(K.history, []);
    arr.unshift(h);
    if (arr.length > 50) arr.length = 50;
    write(K.history, arr);
  }
  // Batch 2 §2: {shuffleQ, shuffleA, textSize:'large'|'xlarge'}.
  // Old installs stored only shuffle flags — merge defaults, never crash.
  function getPrefs() {
    var p = read(K.prefs, null);
    var out = { shuffleQ: false, shuffleA: false, textSize: 'large' };
    if (p && typeof p === 'object') {
      if (p.shuffleQ === true) out.shuffleQ = true;
      if (p.shuffleA === true) out.shuffleA = true;
      if (p.textSize === 'xlarge') out.textSize = 'xlarge';
    }
    return out;
  }
  function setPrefs(p) { write(K.prefs, p); }
  function getSession() { return read(K.session, null); }
  function setSession(s) { write(K.session, s); }
  function clearSession() { try { localStorage.removeItem(K.session); } catch (e) {} }

  // Drop star/wrong refs whose questions no longer exist. History snapshots kept.
  function pruneStaleIds(cache) {
    var valid = {};
    Object.keys(cache.questionsBySet || {}).forEach(function (setId) {
      (cache.questionsBySet[setId] || []).forEach(function (q) { valid[key(setId, q.id)] = true; });
    });
    function norm(id) {
      if (valid[id]) return id;
      // tolerate bare qid: resolve to its set if still present
      var q = questionById(cache, id);
      return q ? key(q.setId, q.id) : null;
    }
    var stars = getStars().map(norm).filter(Boolean);
    var wrong = getWrong().map(norm).filter(Boolean);
    setStars(stars); setWrong(wrong);
    return { stars: stars.length, wrong: wrong.length };
  }

  // One-time migrations to composite keys. `seedIds` = ordered UUID list of
  // the first set (maps legacy array positions). `cache` resolves v1 UUIDs.
  // If old keys exist but no content is cached yet (fresh install, sync
  // pending), migration is DEFERRED — the flag is not set, so a later call
  // after download can still pick the progress up.
  function migrateAll(cache, seedIds) {
    try {
      if (localStorage.getItem('ldd_migrated_v2') === '1') return false;
      var v1stars = read('ldd_stars_v1', null);
      var v1wrong = read('ldd_wrong_v1', null);
      var lw0 = read(LEGACY.wrong, null);
      var ls0 = read(LEGACY.star, null);
      var lh0 = read(LEGACY.history, null);
      var hasOld = (Array.isArray(v1stars) && v1stars.length) ||
                   (Array.isArray(v1wrong) && v1wrong.length) ||
                   lw0 !== null || ls0 !== null || lh0 !== null;
      if (hasOld && !allQuestions(cache).length && !(seedIds && seedIds.length)) {
        return false; // defer: nothing to resolve IDs against yet
      }
      var changed = false;

      // v1 bare-UUID lists -> composite keys (Supabase-era app).
      [['ldd_stars_v1', K.stars], ['ldd_wrong_v1', K.wrong]].forEach(function (pair) {
        var old = read(pair[0], null);
        if (Array.isArray(old) && old.length) {
          var cur = read(pair[1], []);
          old.forEach(function (id) {
            if (String(id).indexOf(':') > 0) { if (cur.indexOf(id) < 0) cur.push(id); return; }
            var q = questionById(cache, id);
            if (q) {
              var k = key(q.setId, q.id);
              if (cur.indexOf(k) < 0) cur.push(k);
            }
          });
          write(pair[1], cur);
          changed = true;
        }
        try { localStorage.removeItem(pair[0]); } catch (e) {}
      });
      try { localStorage.removeItem(V1.cache); } catch (e) {}

      // Original prototype (array indices) -> composite keys of first set.
      var lw = read(LEGACY.wrong, null);
      var ls = read(LEGACY.star, null);
      var lh = read(LEGACY.history, null);
      if (Array.isArray(lw) && lw.length && seedIds) {
        var w = getWrong();
        lw.forEach(function (i) {
          if (seedIds[i]) { var k2 = key(LEGACY_SET_ID, seedIds[i]); if (w.indexOf(k2) < 0) w.push(k2); }
        });
        setWrong(w); changed = true;
      }
      if (Array.isArray(ls) && ls.length && seedIds) {
        var st = getStars();
        ls.forEach(function (i) {
          if (seedIds[i]) { var k3 = key(LEGACY_SET_ID, seedIds[i]); if (st.indexOf(k3) < 0) st.push(k3); }
        });
        setStars(st); changed = true;
      }
      if (Array.isArray(lh) && lh.length) {
        var h = getHistory();
        lh.forEach(function (e2) {
          h.push({ type: e2.type === 'Thi thử' ? 'Thi thử' : 'Ôn tập', setId: null, score: e2.score, total: e2.total, date: e2.date, time: e2.time });
        });
        write(K.history, h.slice(0, 50));
        changed = true;
      }
      Object.keys(LEGACY).forEach(function (k4) { try { localStorage.removeItem(LEGACY[k4]); } catch (e) {} });
      localStorage.setItem('ldd_migrated_v2', '1');
      return changed;
    } catch (e) { return false; }
  }

  window.LddStore = {
    KEYS: K,
    key: key,
    getCache: getCache, setCache: setCache,
    allQuestions: allQuestions, questionById: questionById,
    getStars: getStars, setStars: setStars,
    getWrong: getWrong, setWrong: setWrong,
    getHistory: getHistory, pushHistory: pushHistory,
    getPrefs: getPrefs, setPrefs: setPrefs,
    getSession: getSession, setSession: setSession, clearSession: clearSession,
    pruneStaleIds: pruneStaleIds, migrateAll: migrateAll
  };
})();
