// Regression: combined 111-question bank topic labels are metadata-only.
// Run: node tools/run_topic_review_tests.js
const fs = require('fs');
const assert = require('assert');
const data = JSON.parse(fs.readFileSync('data/chuyen-de-4-7-9-10.json', 'utf8'));
const catalog = JSON.parse(fs.readFileSync('data/catalog.json', 'utf8'));
const app = fs.readFileSync('js/app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const set = catalog.sets.find(s => s.id === data.id);
assert(set && set.version === data.version, 'Catalog and set versions must match');
assert.strictEqual(data.questions.length, 111, 'Do not add/remove questions');
assert.strictEqual(new Set(data.questions.map(q => q.id)).size, 111, 'Question IDs must stay unique');
const expected = {7:20, 4:20, 9:25, 10:46};
for (const [topic, count] of Object.entries(expected)) {
  const found = data.questions.filter(q => q.category && q.category.startsWith('Chuyên đề ' + topic + ' · '));
  assert.strictEqual(found.length, count, 'Incorrect partition for topic ' + topic);
}
assert(data.questions.every(q => /^Chuyên đề (4|7|9|10) · /.test(q.category)), 'Every question has exactly one approved topic');
assert(html.includes('id="view-topic-filter"') && html.includes('id="view-topic-select"'), 'Visible topic select missing');
assert(app.includes('window.changeViewTopic') && app.includes('view.list = next;'), 'Filtered answer navigation missing');
assert(app.includes("(!view.origin || view.origin.type === 'home')"), 'Single-question review must remain unfiltered');
assert(app.includes('function guardReplaceSession') && app.includes('proceed();'), 'New session replacement handler missing');
assert(app.includes('window.resumeSession') && app.includes('data-act="resume"'), 'Continue session action missing');
console.log('OK: 111 IDs unique, 20+20+25+46 topic partition, review filter and session guards checked');
