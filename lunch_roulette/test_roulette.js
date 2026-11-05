'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('./roulette.js');

const state = R.newState();
assert.equal(state.version, 1);
assert.deepEqual(state.settings, {
  minYen: 800, maxYen: 1200,
  genreIds: ['ramen','curry','gyudon','soba_udon','teishoku','chinese','yoshoku','burger'],
  avoid: '', mode: 'genre'
});
assert.equal(R.GENRES.length, 10);
assert.strictEqual(R.validate(state), state);
assert.equal(R.candidates(state).length, 8);
assert.equal(R.choose(R.candidates(state), 0).label, 'ラーメン');

const uuid1 = '11111111-1111-4111-8111-111111111111';
const uuid2 = '22222222-2222-4222-8222-222222222222';
const uuid3 = '33333333-3333-4333-8333-333333333333';
const store1 = {
  id: uuid1, name: '駅前の中華屋さん', genreId: 'chinese',
  priceYen: 950, query: '東京駅 町中華', note: '徒歩圏内'
};
const store2 = {
  id: uuid2, name: 'ラーメン屋さん', genreId: 'ramen',
  priceYen: 1500, query: '', note: ''
};
const added = R.addStore(R.addStore(state, store1), store2);
assert.equal(state.stores.length, 0, 'core must not mutate previous state');
assert.equal(added.stores.length, 2);
const storeMode = R.setSettings(added, {
  ...added.settings, mode: 'store',
  genreIds: ['chinese', 'ramen'], avoid: '卵・鶏肉'
});
assert.deepEqual(R.candidates(storeMode).map(x => x.label), ['駅前の中華屋さん']);
assert.equal(R.candidates(storeMode)[0].query, '東京駅 町中華');
const eligible = R.candidates(storeMode)[0];
const recorded = R.record(storeMode, eligible, uuid3, '2026-11-05T11:00:00.000Z');
assert.equal(recorded.history.length, 1);
assert.equal(recorded.history[0].label, store1.name);
assert.equal(recorded.history[0].priceYen, 950);
assert.equal(recorded.history[0].mode, 'store');
assert.equal(R.deleteStore(recorded, uuid1).history.length, 1,
  'deleting a store must retain previous draw snapshots');
assert.deepEqual(R.candidates(R.deleteStore(recorded, uuid1)), []);
assert.throws(() => R.choose([], 0), /No candidates/);
assert.throws(() => R.choose([eligible], 1), /draw index/);
assert.throws(() => R.record(storeMode, {
  ...eligible, label: '未登録のお店'
}, uuid3, '2026-11-05T11:00:00.000Z'), /eligible/);
assert.throws(() => R.record(recorded, eligible, uuid3, '2026-11-05T11:00:01.000Z'),
  /Duplicate history id/);
assert.throws(() => R.setSettings(state, {
  ...state.settings, minYen: 2000, maxYen: 1200
}), /Minimum budget/);
assert.throws(() => R.setSettings(state, {
  ...state.settings, genreIds: []
}), /genreIds/);
assert.throws(() => R.setSettings(state, {
  ...state.settings, genreIds: ['ramen','ramen']
}), /genreIds/);
assert.throws(() => R.setSettings(state, {
  ...state.settings, mode: 'unknown'
}), /Unsupported draw mode/);
assert.throws(() => R.addStore(added, store1), /Duplicate store id/);
assert.throws(() => R.addStore(state, {
  ...store1, priceYen: 0
}), /store price/);
assert.throws(() => R.deleteStore(state, uuid1), /does not exist/);
assert.throws(() => R.validate({
  ...state, version: 2
}), /Unsupported saved data version/);
assert.throws(() => R.validate({
  ...state, extra: true
}), /unexpected or missing fields/);
assert.throws(() => R.parseYen('0', '予算'), /整数/);
assert.throws(() => R.parseYen('1.5', '予算'), /整数/);
assert.throws(() => R.parseYen('100001', '予算'), /integer/);
assert.equal(R.parseYen('1200', '予算'), 1200);
const genreDraw = R.record(state, R.candidates(state)[1], uuid3, '2026-11-05T11:00:00.000Z');
assert.equal(genreDraw.history[0].storeId, null);
assert.equal(genreDraw.history[0].priceYen, null);
assert.equal(R.candidates(state).some(item => item.mode === 'store'), false);

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const referenced = [...html.matchAll(/(?:src|url)\s*=\s*["'](assets\/[^"']+)/g)].map(x => x[1]);
for (const name of referenced) {
  assert.ok(fs.existsSync(path.join(__dirname, name)), 'Missing published image: ' + name);
}
for (const file of [
  'title_logo.png','background_wood_repeatable.png','roulette_frame.png',
  'roulette_center.png','roulette_pointer.png','roulette_shadow.png','mallet.png',
  ...R.GENRES.map(x => x.image)
]) {
  assert.ok(fs.existsSync(path.join(__dirname,'assets',file)), 'Missing roulette asset: ' + file);
}
for (const id of [
  'status','spin','filter','wheel-stage','wheel-rotor','wheel-disc','wheel-items',
  'budget-label','result','result-image','result-name','result-detail',
  'map-link','map-query','map-prompt','view-roulette','view-history',
  'view-stores','view-settings','settings-form','budget-min','budget-max',
  'draw-mode','genre-filters','avoid','store-form','store-name','store-genre',
  'store-price','store-query','store-note','store-list','history-list'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'Missing required UI element: ' + id);
}
assert.match(app, /window\.addEventListener\('minappready'/);
assert.doesNotMatch(app, /1800/, 'bridge must not fail due to a hard-coded short timeout');
assert.match(app, /window\.minapp\.userState\.get/);
assert.match(app, /window\.minapp\.userState\.set/);
assert.match(app, /crypto\.getRandomValues/, 'roulette must use unbiased secure randomness');
assert.match(app, /conic-gradient/, 'wheel sectors must be rendered');
assert.match(app, /new Promise\(\(resolve\) => window\.setTimeout/, 'spin must animate');
assert.match(html, /food_ramen\.png/);
assert.equal((html.match(/class="nav-item(?: active)?"/g) || []).length, 4);
console.log('lunch_roulette: all domain, image, navigation and packaging tests passed');
