(function () {
  'use strict';

  const B = window.DrinkBudget;
  if (!B) throw new Error('DrinkBudget core failed to load');
  const KEY = 'drink_budget_v1';
  const $ = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing element: ' + id);
    return element;
  };
  const monthInput = $('month');
  const budgetInput = $('monthly-budget');
  const visitInput = $('visit-cost');
  const dateInput = $('spent-date');
  const amountInput = $('spent-amount');
  const noteInput = $('spent-note');
  const status = $('status');
  const controls = [budgetInput, visitInput, dateInput, amountInput, noteInput, $('save-settings'), $('add-expense')];
  let state = null;
  let loading = false;
  let busy = false;
  let stopped = false;
  const pages = ['home', 'record', 'history', 'settings'];

  function openPage(page) {
    if (!pages.includes(page)) throw new Error('Unknown budget page: ' + page);
    for (const name of pages) {
      $('page-' + name).hidden = name !== page;
    }
    for (const button of document.querySelectorAll('.nav-button')) {
      const active = button.dataset.view === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }

  function changeMonth(offset) {
    if (!Number.isSafeInteger(offset)) throw new TypeError('Month offset must be an integer');
    const [year, month] = selectedMonth().split('-').map(Number);
    const target = new Date(year, month - 1 + offset, 1);
    const targetMonth = B.month(target.getFullYear() + '-' +
      String(target.getMonth() + 1).padStart(2, '0'));
    monthInput.value = targetMonth;
    resetDateForMonth();
    render();
    openPage('home');
  }

  function localMonth(now) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return B.month(y + '-' + m);
  }
  function yen(value) { return new Intl.NumberFormat('ja-JP').format(value) + '円'; }
  function selectedMonth() { return B.month(monthInput.value); }
  function show(message, error) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(error));
  }
  function enableControls() {
    for (const element of controls) element.disabled = state === null || busy || stopped;
  }
  function hasBridge() {
    return !!(window.minapp && window.minapp.version === 1 && window.minapp.userState &&
      typeof window.minapp.userState.get === 'function' && typeof window.minapp.userState.set === 'function');
  }
  function stop(error) {
    stopped = true;
    enableControls();
    show('読み書きを停止しました: ' + (error instanceof Error ? error.message : String(error)), true);
    console.error(error);
  }
  function resetDateForMonth() {
    const chosen = selectedMonth();
    dateInput.min = chosen + '-01';
    const [y, m] = chosen.split('-').map(Number);
    dateInput.max = chosen + '-' + String(new Date(y, m, 0).getDate()).padStart(2, '0');
    const today = new Date();
    const todayString = localMonth(today) + '-' + String(today.getDate()).padStart(2, '0');
    dateInput.value = todayString.startsWith(chosen + '-') ? todayString : dateInput.min;
  }
  function render() {
    if (!state) return;
    const chosen = selectedMonth();
    const sum = B.summary(state, chosen);
    $('current-month').textContent = chosen.replace('-', '年') + '月の晩酌予算';
    $('history-month').textContent = chosen.replace('-', '年') + '月の支出';
    $('visits').textContent = sum.visits === null ? '—' : new Intl.NumberFormat('ja-JP').format(sum.visits);
    $('budget-total').textContent = state.monthlyBudget === null ? '未設定' : yen(state.monthlyBudget);
    $('spent-total').textContent = yen(sum.spent);
    $('remaining-total').textContent = sum.remaining === null ? '—' : yen(sum.remaining);
    $('remaining-total').classList.toggle('negative', sum.remaining !== null && sum.remaining < 0);
    $('estimate').textContent = sum.remaining === null
      ? '月の予算を設定すると計算できます。'
      : '1回 ' + yen(state.visitCost) + ' として計算。' + (sum.remaining < 0 ? '予算を超えています。' : '');
    const unconfigured = state.monthlyBudget === null;
    const over = sum.remaining !== null && sum.remaining < 0;
    const usage = unconfigured ? 0 : Math.min(100, Math.round(sum.spent * 100 / state.monthlyBudget));
    const remainingAmount = sum.remaining === null ? '—' :
      (sum.remaining < 0 ? '−' : '') + '¥' +
      new Intl.NumberFormat('ja-JP').format(Math.abs(sum.remaining));
    $('ring-remaining').textContent = remainingAmount;
    $('ring-caption').textContent = unconfigured ? '月の予算を設定してください' :
      (over ? '予算オーバー' : '今月使える金額');
    $('budget-ring').style.setProperty('--usage', usage + '%');
    $('budget-ring').classList.toggle('over', over);
    $('budget-ring').setAttribute('aria-label', unconfigured
      ? '予算未設定。支出は' + yen(sum.spent)
      : '予算' + yen(state.monthlyBudget) + 'のうち' + yen(sum.spent) + 'を使用。残り' + yen(sum.remaining));
    $('progress').setAttribute('aria-valuenow', String(usage));
    $('progress').setAttribute('aria-valuetext', unconfigured
      ? '予算未設定' : (over ? '予算を超過しています' : '予算の' + usage + '%を使用'));
    $('progress-fill').style.width = usage + '%';
    $('progress-fill').classList.toggle('over', over);
    const list = $('expense-list');
    list.replaceChildren();
    $('no-expenses').hidden = sum.expenses.length > 0;
    for (const entry of sum.expenses) {
      const li = document.createElement('li');
      const copy = document.createElement('div');
      copy.className = 'entry-copy';
      const d = document.createElement('span');
      d.className = 'entry-date';
      d.textContent = entry.date;
      const n = document.createElement('span');
      n.className = 'entry-note';
      n.textContent = entry.note || '晩酌';
      copy.append(d, n);
      const amount = document.createElement('strong');
      amount.className = 'entry-amount';
      amount.textContent = yen(entry.amount);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete';
      del.textContent = '削除';
      del.disabled = busy || stopped;
      del.setAttribute('aria-label', entry.date + ' ' + yen(entry.amount) + 'の記録を削除');
      del.addEventListener('click', () => {
        if (!window.confirm(entry.date + 'の' + yen(entry.amount) + 'を削除しますか？')) return;
        void commit(B.removeExpense(state, entry.id), '記録を削除しました');
      });
      li.append(copy, amount, del);
      list.appendChild(li);
    }
  }
  async function commit(next, message, onSaved) {
    if (!state || busy || stopped) return;
    B.validate(next);
    busy = true;
    enableControls();
    render();
    show('保存中…');
    try {
      if (!hasBridge()) throw new Error('MinApp userState bridge disappeared');
      const saved = await window.minapp.userState.set(KEY, next);
      B.validate(saved);
      state = next;
      if (onSaved) onSaved();
      render();
      show(message);
    } catch (error) {
      stop(error);
    } finally {
      busy = false;
      enableControls();
      render();
    }
  }
  async function boot() {
    if (loading || state || stopped) return;
    loading = true;
    try {
      if (!hasBridge()) throw new Error('みんアプ工房の個人保存APIが見つかりません');
      try {
        state = B.validate(await window.minapp.userState.get(KEY));
        show('保存済みの予算を読み込みました');
      } catch (error) {
        if (!error || error.code !== 'state_not_found') throw error;
        const initial = B.newState();
        B.validate(await window.minapp.userState.set(KEY, initial));
        state = initial;
        show('新しい予算帳を用意しました');
      }
      budgetInput.value = state.monthlyBudget === null ? '' : String(state.monthlyBudget);
      visitInput.value = String(state.visitCost);
      enableControls();
      render();
    } catch (error) {
      stop(error);
    } finally {
      loading = false;
    }
  }
  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state || busy || stopped) return;
    try {
      const next = B.setBudget(state, B.parseYen(budgetInput.value, '毎月の予算'), B.parseYen(visitInput.value, '1回の目安'));
      void commit(next, '予算を保存しました', () => openPage('home'));
    } catch (error) {
      show(error.message, true);
    }
  });
  $('expense-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state || busy || stopped) return;
    try {
      const day = B.date(dateInput.value);
      if (!day.startsWith(selectedMonth() + '-')) throw new Error('選択した月の日付を入力してください');
      if (!window.crypto || typeof window.crypto.randomUUID !== 'function') throw new Error('安全なID生成機能がありません');
      const next = B.addExpense(state, { id: window.crypto.randomUUID(), date: day,
        amount: B.parseYen(amountInput.value, '支出額'), note: noteInput.value });
      void commit(next, '支出を記録しました', () => {
        amountInput.value = '';
        noteInput.value = '';
        openPage('history');
      });
    } catch (error) {
      show(error.message, true);
    }
  });
  monthInput.addEventListener('change', () => {
    try { resetDateForMonth(); render(); }
    catch (error) { show(error.message, true); }
  });
  for (const button of document.querySelectorAll('.nav-button')) {
    button.addEventListener('click', () => openPage(button.dataset.view));
  }
  for (const button of document.querySelectorAll('.shortcut')) {
    button.addEventListener('click', () => {
      const action = button.dataset.go;
      if (pages.includes(action)) {
        openPage(action);
        return;
      }
      try {
        if (action === 'previous') changeMonth(-1);
        else if (action === 'next') changeMonth(1);
        else if (action === 'current') {
          monthInput.value = localMonth(new Date());
          resetDateForMonth();
          render();
          openPage('home');
        } else {
          throw new Error('Unknown budget shortcut: ' + action);
        }
      } catch (error) {
        show(error instanceof Error ? error.message : String(error), true);
      }
    });
  }
  monthInput.value = localMonth(new Date());
  resetDateForMonth();
  window.addEventListener('minappready', () => { void boot(); });
  if (hasBridge()) void boot();
})();