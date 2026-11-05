'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('./memo.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const entry = (id, overrides = {}) => ({
  id, shop: '大衆中華ふくろう', area: '高円寺', dish: '麻婆豆腐', price: 880,
  visitedAt: '2026-11-05', rating: 5, favorite: true, note: '辛さがちょうどいい',
  ...overrides
});

const empty = M.newSlots();
assert.equal(empty.length, 8);
assert.equal(M.stats(empty).visits, 0);
assert.equal(M.stats(empty).shops, 0);
assert.equal(M.search(empty, '', false, 'recent').length, 0);

const one = M.add(empty, entry(A));
assert.equal(M.stats(one.slots).visits, 1);
assert.equal(M.stats(empty).visits, 0, 'add must not mutate original data');
const two = M.add(one.slots, entry(B, {
  visitedAt: '2026-11-04', dish: '焼き餃子', price: null, favorite: false,
  rating: 3, area: '新宿', note: '店の看板が赤い'
}));
const three = M.add(two.slots, entry(C, {
  shop: '中華食堂まる', visitedAt: '2026-11-07', dish: '野菜炒め',
  rating: 4, area: '上野', note: ''
}));
assert.deepEqual(M.stats(three.slots), { visits: 3, shops: 2, favorites: 2 });
assert.deepEqual(M.search(three.slots, '', false, 'recent').map(e => e.id), [C, A, B]);
assert.deepEqual(M.search(three.slots, '', false, 'rating').map(e => e.id), [A, C, B]);
assert.deepEqual(M.search(three.slots, 'ふくろう', false, 'recent').map(e => e.id), [A, B]);
assert.deepEqual(M.search(three.slots, '餃子', false, 'recent').map(e => e.id), [B]);
assert.deepEqual(M.search(three.slots, 'しんじゅく', false, 'recent'), []);
assert.deepEqual(M.search(three.slots, '上野', true, 'recent').map(e => e.id), [C]);
assert.deepEqual(M.search(three.slots, '辛さ', true, 'recent').map(e => e.id), [A]);

const toggled = M.toggleFavorite(three.slots, B);
assert.equal(M.stats(toggled.slots).favorites, 3);
assert.equal(M.stats(three.slots).favorites, 2, 'toggle must not mutate original data');
const changed = M.update(toggled.slots, entry(B, {
  area: '新宿三丁目', dish: 'ワンタン麺', favorite: true, note: '', rating: 4
}));
assert.equal(M.stats(changed.slots).visits, 3);
assert.equal(M.search(changed.slots, 'ワンタン', false, 'recent')[0].id, B);
assert.equal(M.search(changed.slots, '餃子', false, 'recent').length, 0);
const removed = M.remove(changed.slots, A);
assert.equal(M.stats(removed.slots).visits, 2);
assert.equal(M.stats(changed.slots).visits, 3);
assert.throws(() => M.remove(removed.slots, A), /見つかりません/);
assert.throws(() => M.update(removed.slots, entry(A)), /見つかりません/);
assert.throws(() => M.add(three.slots, entry(A)), /同じ記録ID/);

assert.equal(M.parsePrice(''), null);
assert.equal(M.parsePrice('1000'), 1000);
for (const value of ['0', '-5', '1.5', '1,000', ' 100', '100円', '']) {
  if (value !== '') assert.throws(() => M.parsePrice(value));
}
assert.throws(() => M.parsePrice('100001'));
assert.equal(M.date('2024-02-29'), '2024-02-29');
assert.throws(() => M.date('2026-02-29'), /存在しない/);
assert.throws(() => M.date('2026-11-31'), /存在しない/);
assert.throws(() => M.date('2026-00-04'));
assert.throws(() => M.validateEntry(entry(A, { shop: ' ' })));
assert.throws(() => M.validateEntry(entry(A, { area: ' 上野 ' })));
assert.equal(M.validateEntry(entry(A, { note: '改行\nあり' })).note, '改行\nあり');
assert.throws(() => M.validateEntry(entry(A, { note: 'タブ\t不可' })));
assert.throws(() => M.validateEntry(entry(A, { rating: 0 })));
assert.throws(() => M.validateEntry(entry(A, { price: 0 })));
assert.throws(() => M.validateEntry(entry(A, { futureField: true })));
assert.throws(() => M.validateSlot({ version: 9, entries: [] }));
assert.throws(() => M.validateSlot({ version: 1, entries: [entry(A), entry(A)] }), /重複/);
const repeated = M.newSlots();
repeated[0].entries.push(entry(A));
repeated[1].entries.push(entry(A));
assert.throws(() => M.validateSlots(repeated), /ページをまたいで重複/);

const maxed = M.newSlots();
for (let i = 0; i < M.MAX_ENTRIES; i++) {
  const id = String(i).padStart(8, '0') + '-0000-4000-8000-' + String(i).padStart(12, '0');
  const change = M.add(maxed, entry(id, { dish: '焼きそば', note: '' }));
  maxed.splice(0, maxed.length, ...change.slots);
}
assert.equal(M.stats(maxed).visits, M.MAX_ENTRIES);
assert.throws(() => M.add(maxed, entry('ffffffff-ffff-4fff-8fff-ffffffffffff')), /最大180件/);
for (const slot of maxed) {
  assert.ok(new TextEncoder().encode(JSON.stringify(slot)).length <= M.MAX_SLOT_BYTES);
}

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const mapsConfig = fs.readFileSync(path.join(__dirname, 'maps-config.js'), 'utf8');
assert.equal((html.match(/class="nav-button/g) || []).length, 4);
assert.equal((html.match(/referrerpolicy="strict-origin-when-cross-origin"/g) || []).length, 2);
assert.ok(html.includes('id="map-frame"'));
assert.ok(html.includes('id="map-frame-large"'));
assert.ok(html.indexOf('src="memo.js"') < html.indexOf('src="maps-config.js"'));
assert.ok(html.indexOf('src="maps-config.js"') < html.indexOf('src="app.js"'));
assert.ok(app.includes('https://www.google.com/maps/embed/v1/search?'));
const bootStart = app.indexOf('  async function boot() {');
const bootEnd = app.indexOf('\n  function submitMapSearch(', bootStart);
assert.ok(bootStart >= 0 && bootEnd > bootStart, 'boot function must exist');
const bootScript = app.slice(bootStart, bootEnd);
const startupStart = app.indexOf('  fields.visitedAt.value = todayLocal();', bootEnd);
assert.ok(startupStart > bootEnd, 'startup block must exist');
const startupScript = app.slice(startupStart);
assert.ok(bootScript.includes('      slots = loaded;'));
assert.ok(
  bootScript.indexOf('      slots = loaded;') <
    bootScript.indexOf('      setMapQuery(DEFAULT_MAP_QUERY, false);'),
  'Google Maps must not load before the personal state bridge responds'
);
assert.ok(startupScript.includes("window.addEventListener('minappready'"));
assert.ok(!startupScript.includes('setMapQuery('), 'do not start maps before host bridge readiness');
assert.ok(!startupScript.includes('setTimeout('), 'do not fail before a delayed native bridge is ready');
assert.equal((mapsConfig.match(/__KOBO_GOOGLE_MAPS_API_KEY__/g) || []).length, 1);
assert.equal(/AIza[0-9A-Za-z_-]{30,60}/.test(mapsConfig), false, 'real API key must not be committed');
console.log('chinese_food_memo: all memo domain tests passed');
