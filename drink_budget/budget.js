(function (root) {
  'use strict';

  const VERSION = 1;
  const MAX_YEN = 10000000;
  const MAX_EXPENSES = 500;
  const MAX_NOTE_LENGTH = 40;
  const MONTH_PATTERN = /^(20\d\d)-(0[1-9]|1[0-2])$/;
  const DATE_PATTERN = /^(20\d\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function fail(message) { throw new Error(message); }
  function plainObject(value, where) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where + ' must be an object');
    return value;
  }
  function keys(value, allowed, where) {
    const actual = Object.keys(value).sort();
    if (actual.length !== allowed.length || actual.some((key, i) => key !== [...allowed].sort()[i])) {
      fail(where + ' has unexpected or missing fields');
    }
  }
  function yen(value, where, allowNull) {
    if (allowNull && value === null) return value;
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_YEN) {
      fail(where + ' must be an integer between 1 and ' + MAX_YEN);
    }
    return value;
  }
  function month(value) {
    if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) fail('Invalid month: ' + value);
    return value;
  }
  function date(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail('Invalid date: ' + value);
    const [y, m, d] = value.split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      fail('Invalid calendar date: ' + value);
    }
    return value;
  }
  function newState() { return { version: VERSION, monthlyBudget: null, visitCost: 2000, expenses: [] }; }
  function validate(value) {
    plainObject(value, 'Saved data');
    keys(value, ['version', 'monthlyBudget', 'visitCost', 'expenses'], 'Saved data');
    if (value.version !== VERSION) fail('Unsupported saved data version: ' + value.version);
    yen(value.monthlyBudget, 'monthlyBudget', true);
    yen(value.visitCost, 'visitCost', false);
    if (!Array.isArray(value.expenses) || value.expenses.length > MAX_EXPENSES) fail('Invalid expenses list');
    const seen = new Set();
    value.expenses.forEach((entry, i) => {
      plainObject(entry, 'expenses[' + i + ']');
      keys(entry, ['id', 'date', 'amount', 'note'], 'expenses[' + i + ']');
      if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id) || seen.has(entry.id)) fail('Invalid or duplicate expense id');
      seen.add(entry.id);
      date(entry.date);
      yen(entry.amount, 'expense amount', false);
      if (typeof entry.note !== 'string' || entry.note.length > MAX_NOTE_LENGTH) fail('Invalid expense note');
    });
    return value;
  }
  function summary(value, selectedMonth) {
    validate(value);
    month(selectedMonth);
    const expenses = value.expenses.filter((entry) => entry.date.startsWith(selectedMonth + '-'));
    const spent = expenses.reduce((sum, entry) => sum + entry.amount, 0);
    const remaining = value.monthlyBudget === null ? null : value.monthlyBudget - spent;
    const visits = remaining === null ? null : Math.max(0, Math.floor(remaining / value.visitCost));
    return { spent, remaining, visits, expenses: [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)) };
  }
  function setBudget(value, budget, cost) {
    validate(value);
    yen(budget, 'monthlyBudget', false);
    yen(cost, 'visitCost', false);
    return validate({ ...value, monthlyBudget: budget, visitCost: cost });
  }
  function addExpense(value, entry) {
    validate(value);
    plainObject(entry, 'New expense');
    keys(entry, ['id', 'date', 'amount', 'note'], 'New expense');
    if (value.expenses.length >= MAX_EXPENSES) fail('Expense history limit reached');
    return validate({ ...value, expenses: [...value.expenses, entry] });
  }
  function removeExpense(value, id) {
    validate(value);
    if (typeof id !== 'string' || !value.expenses.some((entry) => entry.id === id)) fail('Expense does not exist');
    return validate({ ...value, expenses: value.expenses.filter((entry) => entry.id !== id) });
  }
  function parseYen(value, where) {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) fail(where + 'は1円以上の整数で入力してください');
    return yen(Number(value), where, false);
  }
  const api = Object.freeze({ VERSION, MAX_EXPENSES, newState, validate, month, date, summary, setBudget, addExpense, removeExpense, parseYen });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DrinkBudget = api;
})(typeof window === 'undefined' ? globalThis : window);