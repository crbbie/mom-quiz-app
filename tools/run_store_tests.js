// Node harness for js/store.js (DOM-free). Run: node tools/run_store_tests.js
const fs = require('fs');

const storeSrc = fs.readFileSync('js/store.js', 'utf8');
const dataDoc = JSON.parse(fs.readFileSync('data/luat-kdbds-2023.json', 'utf8'));

function freshEnv() {
  const mem = {};
  const localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
  const window = {};
  const fn = new Function('window', 'localStorage', storeSrc + '; return window.LddStore;');
  return { S: fn(window, localStorage), mem, localStorage };
}

function toInternal(setId, sq, idx) {
  return { id: sq.id, setId, category: sq.category || null, q: sq.question, o: sq.options, c: sq.correct, e: sq.explanation || '', order: (idx + 1) * 10 };
}
function cacheOf(docs) {
  const questionsBySet = {};
  docs.forEach(d => { questionsBySet[d.id] = d.questions.map((sq, i) => toInternal(d.id, sq, i)); });
  return { catalogVersion: 1, sets: docs.map(d => ({ id: d.id })), questionsBySet, syncedAt: 0 };
}

let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log('ok: ' + name); } else { fail++; console.log('FAIL: ' + name); } }

// 1. legacy prototype indices -> composite keys
{
  const { S, localStorage } = freshEnv();
  const cache = cacheOf([dataDoc]);
  const ids = dataDoc.questions.map(q => q.id);
  localStorage.setItem('onthi_wrong_v1', JSON.stringify([0, 5]));
  localStorage.setItem('onthi_star_v1', JSON.stringify([1]));
  S.setCache(1, cache.sets, cache.questionsBySet);
  const did = S.migrateAll(S.getCache(), ids);
  t('legacy migration ran', did === true);
  t('legacy wrong mapped', JSON.stringify(S.getWrong()) === JSON.stringify(['kdbds-2023:' + ids[0], 'kdbds-2023:' + ids[5]]));
  t('legacy star mapped', JSON.stringify(S.getStars()) === JSON.stringify(['kdbds-2023:' + ids[1]]));
  t('legacy keys removed', localStorage.getItem('onthi_wrong_v1') === null);
}

// 2. v1 bare UUIDs -> composite
{
  const mem = {};
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const S = new Function('window', 'localStorage', storeSrc + '; return window.LddStore;')({}, localStorage);
  const cache = cacheOf([dataDoc]);
  const ids = dataDoc.questions.map(q => q.id);
  S.setCache(1, cache.sets, cache.questionsBySet);
  localStorage.setItem('ldd_wrong_v1', JSON.stringify([ids[2]]));
  localStorage.setItem('ldd_stars_v1', JSON.stringify([ids[3]]));
  S.migrateAll(S.getCache(), ids);
  t('v1 wrong -> composite', JSON.stringify(S.getWrong()) === JSON.stringify(['kdbds-2023:' + ids[2]]));
  t('v1 star -> composite', JSON.stringify(S.getStars()) === JSON.stringify(['kdbds-2023:' + ids[3]]));
}

// 3. defer when cache empty, then migrate after content arrives
{
  const mem = {};
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const S = new Function('window', 'localStorage', storeSrc + '; return window.LddStore;')({}, localStorage);
  localStorage.setItem('onthi_star_v1', JSON.stringify([0]));
  const r1 = S.migrateAll(S.getCache(), []);
  t('migration deferred on empty cache', r1 === false && localStorage.getItem('ldd_migrated_v2') === null);
  const cache = cacheOf([dataDoc]);
  S.setCache(1, cache.sets, cache.questionsBySet);
  S.migrateAll(S.getCache(), dataDoc.questions.map(q => q.id));
  t('deferred migration completes later', S.getStars().length === 1);
}

// 4. reorder survival: shuffle file order, keys still resolve
{
  const { S } = freshEnv();
  const rev = { ...dataDoc, questions: [...dataDoc.questions].reverse() };
  const cache = cacheOf([rev]);
  S.setCache(1, cache.sets, cache.questionsBySet);
  const k = 'kdbds-2023:' + dataDoc.questions[0].id;
  S.setStars([k]); S.setWrong([k]);
  S.pruneStaleIds(S.getCache());
  t('stars survive reorder', S.getStars().length === 1 && S.getWrong().length === 1);
  t('questionById finds reordered', S.questionById(S.getCache(), k) !== null);
}

// 5. removed question: graceful ignore, no crash
{
  const { S } = freshEnv();
  const cut = { ...dataDoc, questions: dataDoc.questions.slice(1) }; // drop q0
  const cache = cacheOf([cut]);
  S.setCache(1, cache.sets, cache.questionsBySet);
  S.setStars(['kdbds-2023:' + dataDoc.questions[0].id, 'kdbds-2023:' + dataDoc.questions[1].id]);
  S.pushHistory({ type: 'Ôn tập', setId: 'kdbds-2023', score: 5, total: 10, date: 1 });
  S.pruneStaleIds(S.getCache());
  t('removed q pruned from stars', JSON.stringify(S.getStars()) === JSON.stringify(['kdbds-2023:' + dataDoc.questions[1].id]));
  t('history snapshot kept', S.getHistory().length === 1);
  t('removed q lookup null (no crash)', S.questionById(S.getCache(), 'kdbds-2023:' + dataDoc.questions[0].id) === null);
}

// 6. composite identity across sets (same qid in two sets stays distinct)
{
  const { S } = freshEnv();
  const cache = {
    catalogVersion: 1, sets: [{ id: 'a' }, { id: 'b' }],
    questionsBySet: {
      a: [{ id: 'q1', setId: 'a' }], b: [{ id: 'q1', setId: 'b' }]
    }, syncedAt: 0
  };
  t('same qid distinct per set', S.questionById(cache, 'a:q1').setId === 'a' && S.questionById(cache, 'b:q1').setId === 'b');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
