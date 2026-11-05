'use strict';
const assert = require('node:assert/strict');
const B = require('./budget.js');
const fs = require('node:fs');
const path = require('node:path');

const original = B.newState();
assert.deepEqual(original, { version: 1, monthlyBudget: null, visitCost: 2000, expenses: [] });
assert.deepEqual(B.summary(original, '2026-11'), { spent: 0, remaining: null, visits: null, expenses: [] });
const configured = B.setBudget(original, 12000, 2000);
assert.equal(original.monthlyBudget, null, 'mutations must not change previous state');
assert.equal(B.summary(configured, '2026-11').visits, 6);
const a = { id: '11111111-1111-4111-8111-111111111111', date: '2026-11-02', amount: 2300, note: '居酒屋' };
const b = { id: '22222222-2222-4222-8222-222222222222', date: '2026-11-03', amount: 1900, note: '家飲み' };
const c = { id: '33333333-3333-4333-8333-333333333333', date: '2026-10-31', amount: 500, note: '' };
let data = B.addExpense(B.addExpense(B.addExpense(configured, a), b), c);
let sum = B.summary(data, '2026-11');
assert.equal(sum.spent, 4200);
assert.equal(sum.remaining, 7800);
assert.equal(sum.visits, 3);
assert.deepEqual(sum.expenses.map(x => x.id), [b.id, a.id]);
assert.equal(B.summary(data, '2026-10').spent, 500);
data = B.removeExpense(data, a.id);
assert.equal(B.summary(data, '2026-11').remaining, 10100);
assert.throws(() => B.removeExpense(data, a.id), /does not exist/);
assert.equal(B.summary(B.addExpense(configured, { ...a, amount: 13000 }), '2026-11').visits, 0);
assert.equal(B.summary(B.addExpense(configured, { ...a, amount: 13000 }), '2026-11').remaining, -1000);
assert.throws(() => B.date('2026-02-30'), /calendar date/);
assert.throws(() => B.month('2026-13'), /Invalid month/);
assert.throws(() => B.parseYen('2.5', 'amount'), /整数/);
assert.throws(() => B.parseYen('0', 'amount'), /整数/);
assert.throws(() => B.parseYen('10000001', 'amount'), /integer/);
assert.throws(() => B.validate({ ...configured, version: 2 }), /version/);
assert.throws(() => B.validate({ ...configured, unexpected: 1 }), /fields/);
assert.throws(() => B.validate({ ...configured, expenses: [a, a] }), /duplicate/);
assert.throws(() => B.addExpense(configured, { ...a, amount: 1.5 }), /integer/);
assert.throws(() => B.addExpense(configured, { ...a, note: 'x'.repeat(41) }), /note/);
// Navigation and visualization contract of the packaged WebView UI.
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appScript = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
for (const id of [
  'status', 'month', 'current-month', 'visits', 'budget-total',
  'spent-total', 'remaining-total', 'estimate', 'progress', 'progress-fill',
  'budget-ring', 'ring-remaining', 'ring-caption',
  'history-month', 'expense-list', 'no-expenses',
  'settings-form', 'monthly-budget', 'visit-cost', 'save-settings',
  'expense-form', 'spent-date', 'spent-amount', 'spent-note', 'add-expense'
]) {
  assert.ok(html.includes('id="' + id + '"'), 'required runtime element is absent: ' + id);
}
const pageNames = [...html.matchAll(/data-page="([^"]+)"/g)].map(x => x[1]);
const navigation = [...html.matchAll(/class="nav-button(?: active)?" data-view="([^"]+)"/g)].map(x => x[1]);
const shortcuts = [...html.matchAll(/class="shortcut" type="button" data-go="([^"]+)"/g)].map(x => x[1]);
assert.deepEqual(pageNames, ['home', 'record', 'history', 'settings']);
assert.deepEqual(navigation, pageNames);
assert.deepEqual(shortcuts, ['settings', 'record', 'history', 'previous', 'current', 'next']);
assert.match(html, /conic-gradient\(/, 'dashboard must show real usage as a ring chart');
assert.match(html, /@media \(max-width: 360px\)/, 'compact phones must have responsive styles');
assert.match(html, /aria-current="page"/, 'active navigation must have accessible state');
assert.match(appScript, /setProperty\('--usage', usage \+ '%'\)/);
assert.match(appScript, /budget-ring'\)\.classList\.toggle\('over', over\)/);
assert.match(appScript, /window\.addEventListener\('minappready'/);
assert.doesNotMatch(appScript, /setTimeout\(/, 'WebView must not fail just because bridge injection is delayed');

console.log('drink_budget: all domain and UI contract tests passed');