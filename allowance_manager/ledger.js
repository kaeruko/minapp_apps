(function (root) {
  'use strict';
  const VERSION = 1;
  const MAX_AMOUNT = 10000000;
  const MAX_TRANSACTIONS = 500;
  const CATEGORIES = Object.freeze(['食品', '交通', '趣味', '娯楽', '生活', 'その他']);
  const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/;
  const DATE = /^20\d\d-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  function fail(message) { throw new Error(message); }
  function object(value, where) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(where + ' must be an object');
    return value;
  }
  function exactKeys(value, expected, where) {
    const keys = Object.keys(value).sort();
    if (keys.length !== expected.length || keys.some((key, i) => key !== [...expected].sort()[i])) {
      fail(where + ' has unexpected or missing fields');
    }
  }
  function amount(value, label, nullable) {
    if (nullable && value === null) return value;
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_AMOUNT) {
      fail(label + ' must be an integer between 1 and ' + MAX_AMOUNT);
    }
    return value;
  }
  function month(value) {
    if (typeof value !== 'string' || !MONTH.test(value)) fail('Invalid month: ' + value);
    return value;
  }
  function date(value) {
    if (typeof value !== 'string' || !DATE.test(value)) fail('Invalid date: ' + value);
    const [y, m, d] = value.split('-').map(Number);
    const check = new Date(Date.UTC(y, m - 1, d));
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
      fail('Invalid calendar date: ' + value);
    }
    return value;
  }
  function newState() { return { version: VERSION, monthlyBudget: null, transactions: [] }; }
  function validate(value) {
    object(value, 'Saved data');
    exactKeys(value, ['version', 'monthlyBudget', 'transactions'], 'Saved data');
    if (value.version !== VERSION) fail('Unsupported saved data version: ' + value.version);
    amount(value.monthlyBudget, 'monthlyBudget', true);
    if (!Array.isArray(value.transactions) || value.transactions.length > MAX_TRANSACTIONS) fail('Invalid transactions list');
    const ids = new Set();
    value.transactions.forEach((entry, index) => {
      object(entry, 'transaction[' + index + ']');
      exactKeys(entry, ['id', 'date', 'kind', 'amount', 'category', 'note'], 'transaction[' + index + ']');
      if (typeof entry.id !== 'string' || !ID.test(entry.id) || ids.has(entry.id)) fail('Invalid or duplicate transaction ID');
      ids.add(entry.id);
      date(entry.date);
      if (entry.kind !== 'expense' && entry.kind !== 'income') fail('Invalid transaction kind');
      amount(entry.amount, 'transaction amount', false);
      if (entry.kind === 'expense' ? !CATEGORIES.includes(entry.category) : entry.category !== '入金') {
        fail('Invalid transaction category');
      }
      if (typeof entry.note !== 'string' || entry.note.length > 60) fail('Invalid transaction note');
    });
    return value;
  }
  function summary(value, selectedMonth) {
    validate(value);
    month(selectedMonth);
    const entries = value.transactions.filter(x => x.date.startsWith(selectedMonth + '-'));
    const expenses = entries.filter(x => x.kind === 'expense');
    const spent = expenses.reduce((total, x) => total + x.amount, 0);
    const income = entries.filter(x => x.kind === 'income').reduce((total, x) => total + x.amount, 0);
    const budget = value.monthlyBudget === null ? null : value.monthlyBudget + income;
    const remaining = budget === null ? null : budget - spent;
    const categories = CATEGORIES.map(name => ({ name, amount: expenses.filter(x => x.category === name).reduce((total, x) => total + x.amount, 0) }));
    return { spent, income, budget, remaining, categories, entries: [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)) };
  }
  function setBudget(value, budget) {
    validate(value);
    amount(budget, 'monthlyBudget', false);
    return validate({ ...value, monthlyBudget: budget });
  }
  function add(value, entry) {
    validate(value);
    if (value.transactions.length >= MAX_TRANSACTIONS) fail('Transaction history limit reached');
    return validate({ ...value, transactions: [...value.transactions, entry] });
  }
  function remove(value, id) {
    validate(value);
    if (typeof id !== 'string' || !value.transactions.some(x => x.id === id)) fail('Transaction does not exist');
    return validate({ ...value, transactions: value.transactions.filter(x => x.id !== id) });
  }
  function parseYen(text, label) {
    if (typeof text !== 'string' || !/^[1-9][0-9]*$/.test(text)) fail(label + 'は1円以上の整数で入力してください');
    return amount(Number(text), label, false);
  }
  const api = Object.freeze({ VERSION, CATEGORIES, newState, validate, month, date, summary, setBudget, add, remove, parseYen });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AllowanceLedger = api;
})(typeof window === 'undefined' ? globalThis : window);
