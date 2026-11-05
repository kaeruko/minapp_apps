(function () {
  'use strict';
  const B = window.AllowanceLedger;
  if (!B) throw new Error('AllowanceLedger core failed to load');
  const KEY = 'allowance_manager_v1';
  const $ = id => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing element: ' + id);
    return element;
  };
  const COLORS = Object.freeze(['#e98b35', '#45758f', '#a95050', '#8f4a51', '#79a65b', '#b4a69b']);
  const SYMBOLS = Object.freeze(['🍱', '🚃', '🎲', '❤️', '🪴', '📦']);
  const pages = ['home', 'record', 'history', 'settings'];
  const fields = ['entry-date', 'entry-amount', 'entry-category', 'entry-note', 'add-entry', 'monthly-budget', 'save-budget'].map($);
  let state = null;
  let busy = false;
  let stopped = false;
  let loading = false;
  let mode = 'expense';
  function yen(value) { return new Intl.NumberFormat('ja-JP').format(value) + '円'; }
  function localMonth(date) { return B.month(date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0')); }
  function selectedMonth() { return B.month($('month').value); }
  function show(message, error) { $('status').textContent = message; $('status').classList.toggle('error', Boolean(error)); }
  function enable() { for (const field of fields) field.disabled = !state || busy || stopped; }
  function hasBridge() { return Boolean(window.minapp && window.minapp.version === 1 && window.minapp.userState && typeof window.minapp.userState.get === 'function' && typeof window.minapp.userState.set === 'function'); }
  function stop(error) { stopped = true; enable(); show('読み書きを停止しました: ' + (error instanceof Error ? error.message : String(error)), true); console.error(error); }
  function openPage(page) {
    if (!pages.includes(page)) throw new Error('Unknown page: ' + page);
    for (const name of pages) $('page-' + name).hidden = page !== name;
    for (const button of document.querySelectorAll('.nav-button')) {
      const active = button.dataset.view === page;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }
  function resetDate() {
    const chosen = selectedMonth();
    const [year, month] = chosen.split('-').map(Number);
    const last = new Date(year, month, 0).getDate();
    const field = $('entry-date');
    field.min = chosen + '-01';
    field.max = chosen + '-' + String(last).padStart(2, '0');
    const today = new Date();
    field.value = localMonth(today) === chosen ? chosen + '-' + String(today.getDate()).padStart(2, '0') : field.min;
  }
  function changeMode(next) {
    if (next !== 'expense' && next !== 'income') throw new Error('Unknown transaction kind');
    mode = next;
    for (const kind of ['expense', 'income']) {
      const button = $('mode-' + kind);
      button.classList.toggle('active', kind === mode);
      button.setAttribute('aria-pressed', String(kind === mode));
    }
    $('category-field').hidden = mode === 'income';
    $('add-entry').textContent = mode === 'income' ? '入金を保存する' : '支出を保存する';
    $('entry-note').placeholder = mode === 'income' ? '例：臨時のお小遣い' : '何に使った？';
  }
  function go(action) {
    if (action === 'expense' || action === 'income') {
      changeMode(action);
      openPage('record');
    } else openPage(action);
  }
  function buildEntry(entry, deletable) {
    const li = document.createElement('li');
    const icon = document.createElement('span');
    icon.className = 'entry-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = entry.kind === 'income' ? '🏧' : SYMBOLS[B.CATEGORIES.indexOf(entry.category)];
    const info = document.createElement('span');
    info.className = 'entry-copy';
    const day = document.createElement('small');
    day.textContent = entry.date;
    const detail = document.createElement('strong');
    detail.textContent = entry.category + (entry.note ? '・' + entry.note : '');
    info.append(day, detail);
    const value = document.createElement('span');
    value.className = 'entry-money' + (entry.kind === 'income' ? ' income' : '');
    value.textContent = (entry.kind === 'income' ? '＋' : '−') + yen(entry.amount);
    li.append(icon, info, value);
    if (deletable) {
      const del = document.createElement('button');
      del.className = 'delete'; del.type = 'button'; del.textContent = '削除';
      del.disabled = busy || stopped;
      del.setAttribute('aria-label', entry.date + ' ' + entry.category + ' ' + yen(entry.amount) + 'を削除');
      del.addEventListener('click', () => {
        if (!window.confirm(entry.date + 'の' + yen(entry.amount) + 'を削除しますか？')) return;
        void commit(B.remove(state, entry.id), '記録を削除しました');
      });
      li.append(del);
    }
    return li;
  }
  function render() {
    if (!state) return;
    const chosen = selectedMonth();
    const sum = B.summary(state, chosen);
    $('current-month').textContent = chosen.replace('-', '年') + '月の予算';
    $('history-month').textContent = chosen.replace('-', '年') + '月の記録';
    const unconfigured = sum.budget === null;
    const over = sum.remaining !== null && sum.remaining < 0;
    const usage = unconfigured ? 0 : Math.min(100, Math.round(sum.spent * 100 / sum.budget));
    $('remaining').textContent = unconfigured ? '—' : (over ? '−' : '') + '¥' + new Intl.NumberFormat('ja-JP').format(Math.abs(sum.remaining));
    $('remaining').classList.toggle('negative', over);
    $('budget-total').textContent = unconfigured ? ' / 予算未設定' : ' / ' + yen(sum.budget);
    $('spent-caption').textContent = '今月の支出 ' + yen(sum.spent) + (sum.income ? ' ・入金 ＋' + yen(sum.income) : '');
    $('progress').setAttribute('aria-valuenow', String(usage));
    $('progress').setAttribute('aria-valuetext', unconfigured ? '予算未設定' : '予算の' + usage + '%を使用');
    $('progress-fill').style.width = usage + '%';
    $('progress-fill').classList.toggle('over', over);
    $('progress-caption').textContent = unconfigured ? '設定から月の予算を登録してください' : (over ? '予算を' + yen(Math.abs(sum.remaining)) + '超えています' : '予算の' + usage + '%を使いました');
    $('donut-total').textContent = yen(sum.spent);
    const segments = [];
    const legend = $('legend');
    legend.replaceChildren();
    let position = 0;
    sum.categories.forEach((item, i) => {
      if (!item.amount) return;
      const end = position + item.amount / sum.spent * 100;
      segments.push(COLORS[i] + ' ' + position + '% ' + end + '%');
      position = end;
      const row = document.createElement('div'); row.className = 'legend-row';
      const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = COLORS[i];
      const name = document.createElement('span'); name.className = 'legend-label'; name.textContent = SYMBOLS[i] + ' ' + item.name;
      const percent = document.createElement('span'); percent.className = 'legend-percent'; percent.textContent = Math.round(item.amount / sum.spent * 100) + '%';
      row.append(dot, name, percent); legend.append(row);
    });
    if (!sum.spent) {
      const empty = document.createElement('p'); empty.className = 'legend-empty'; empty.textContent = '支出を登録すると内訳が表示されます。'; legend.append(empty);
    }
    $('donut').style.background = segments.length ? 'conic-gradient(' + segments.join(',') + ')' : '#e1d9cf';
    $('donut').setAttribute('aria-label', sum.spent ? '支出合計' + yen(sum.spent) + 'のカテゴリ別内訳' : 'カテゴリ別支出なし');
    const list = $('transaction-list'); list.replaceChildren();
    $('history-empty').hidden = sum.entries.length > 0;
    for (const entry of sum.entries) list.append(buildEntry(entry, true));
    const recent = $('recent-list'); recent.replaceChildren();
    if (!sum.entries.length) recent.textContent = 'まだ記録がありません。';
    else { const mini = document.createElement('ul'); mini.className = 'list'; for (const entry of sum.entries.slice(0, 3)) mini.append(buildEntry(entry, false)); recent.append(mini); }
  }
  async function commit(next, message, onSaved) {
    if (!state || busy || stopped) return;
    B.validate(next);
    busy = true; enable(); render(); show('保存中…');
    try {
      if (!hasBridge()) throw new Error('MinApp userState bridge disappeared');
      B.validate(await window.minapp.userState.set(KEY, next));
      state = next;
      if (onSaved) onSaved();
      render(); show(message);
    } catch (error) { stop(error); }
    finally { busy = false; enable(); render(); }
  }
  async function boot() {
    if (loading || state || stopped) return;
    loading = true;
    try {
      if (!hasBridge()) throw new Error('みんアプ工房の個人保存APIが見つかりません');
      try {
        state = B.validate(await window.minapp.userState.get(KEY));
        show('保存済みの小遣い帳を読み込みました');
      } catch (error) {
        if (!error || error.code !== 'state_not_found') throw error;
        const initial = B.newState();
        B.validate(await window.minapp.userState.set(KEY, initial));
        state = initial;
        show('新しい小遣い帳を用意しました');
      }
      $('monthly-budget').value = state.monthlyBudget === null ? '' : String(state.monthlyBudget);
      enable(); render();
    } catch (error) { stop(error); }
    finally { loading = false; }
  }
  $('budget-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!state || busy || stopped) return;
    try {
      const next = B.setBudget(state, B.parseYen($('monthly-budget').value, '毎月の予算'));
      void commit(next, '予算を保存しました', () => openPage('home'));
    } catch (error) { show(error.message, true); }
  });
  $('transaction-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!state || busy || stopped) return;
    try {
      const day = B.date($('entry-date').value);
      if (!day.startsWith(selectedMonth() + '-')) throw new Error('選択中の月の日付を入力してください');
      if (!window.crypto || typeof window.crypto.randomUUID !== 'function') throw new Error('安全なID生成機能がありません');
      const entry = { id: window.crypto.randomUUID(), date: day, kind: mode,
        amount: B.parseYen($('entry-amount').value, '金額'), category: mode === 'income' ? '入金' : $('entry-category').value, note: $('entry-note').value };
      const next = B.add(state, entry);
      void commit(next, mode === 'income' ? '入金を記録しました' : '支出を記録しました', () => {
        $('entry-amount').value = ''; $('entry-note').value = ''; openPage('home');
      });
    } catch (error) { show(error.message, true); }
  });
  $('month').addEventListener('change', () => { try { resetDate(); render(); } catch (error) { show(error.message, true); } });
  $('mode-expense').addEventListener('click', () => changeMode('expense'));
  $('mode-income').addEventListener('click', () => changeMode('income'));
  for (const button of document.querySelectorAll('.nav-button')) button.addEventListener('click', () => go(button.dataset.view));
  for (const button of document.querySelectorAll('[data-go]')) button.addEventListener('click', () => go(button.dataset.go));
  $('month').value = localMonth(new Date());
  resetDate();
  changeMode('expense');
  window.addEventListener('minappready', () => { void boot(); });
  if (hasBridge()) void boot();
})();
