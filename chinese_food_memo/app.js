(function () {
  'use strict';

  const M = window.ChukaMemo;
  if (!M || M.VERSION !== 1) throw new Error('町中華メモの計算・保存モデルを読み込めません');
  const KEY_PREFIX = 'chuka_memo_v1_';
  const el = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error('必要な画面要素が見つかりません: ' + id);
    return element;
  };
  const fields = {
    shop: el('shop'), area: el('area'), dish: el('dish'),
    price: el('price'), visitedAt: el('visited-at'), rating: el('rating'),
    favorite: el('favorite'), note: el('note')
  };
  const status = el('status');
  const form = el('record-form');
  const formTitle = el('form-title');
  const saveButton = el('save-record');
  const cancelButton = el('cancel-edit');
  const searchInput = el('search');
  const favoriteFilter = el('favorites-only');
  const sortInput = el('sort');
  const cards = el('records');
  const empty = el('no-records');
  const recordCount = el('result-count');
  const totalVisits = el('stat-visits');
  const totalShops = el('stat-shops');
  const totalFavorites = el('stat-favorites');
  const inputs = [...Object.values(fields), saveButton, cancelButton, searchInput, favoriteFilter, sortInput];
  let slots = null;
  let booting = false;
  let busy = false;
  let stopped = false;
  let editingId = null;

  function hasBridge() {
    return Boolean(window.minapp && window.minapp.version === 1 &&
      window.minapp.userState &&
      typeof window.minapp.userState.get === 'function' &&
      typeof window.minapp.userState.set === 'function');
  }
  function slotKey(index) {
    if (!Number.isInteger(index) || index < 0 || index >= M.SLOT_COUNT) {
      throw new Error('記録ページ番号が不正です');
    }
    return KEY_PREFIX + index;
  }
  function show(message, isError) {
    status.textContent = message;
    status.classList.toggle('error', Boolean(isError));
  }
  function enabled() {
    const ready = Boolean(slots) && !busy && !stopped;
    for (const input of inputs) input.disabled = !ready;
    cancelButton.disabled = !ready || editingId === null;
  }
  function stop(error) {
    stopped = true;
    console.error('町中華メモを停止しました:', error);
    const diagnostic = error instanceof Error ? error.message : String(error);
    show('保存・読み込みエラー: ' + diagnostic + '。編集を停止しました。', true);
    enabled();
    render();
  }
  function todayLocal() {
    const now = new Date();
    if (!Number.isFinite(now.getTime())) throw new Error('端末の日付が不正です');
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return M.date(String(year) + '-' + month + '-' + day);
  }
  function yen(value) {
    if (value === null) return '金額未記録';
    if (!Number.isSafeInteger(value)) throw new Error('価格が不正です');
    return value.toLocaleString('ja-JP') + '円';
  }
  function setDraft(entry) {
    fields.shop.value = entry.shop;
    fields.area.value = entry.area;
    fields.dish.value = entry.dish;
    fields.price.value = entry.price === null ? '' : String(entry.price);
    fields.visitedAt.value = entry.visitedAt;
    fields.rating.value = String(entry.rating);
    fields.favorite.checked = entry.favorite;
    fields.note.value = entry.note;
  }
  function clearDraft() {
    editingId = null;
    form.reset();
    fields.visitedAt.value = todayLocal();
    fields.rating.value = '3';
    formTitle.textContent = '記録する';
    saveButton.textContent = '保存';
    cancelButton.classList.add('hidden');
    enabled();
  }
  function readDraft() {
    if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
      throw new Error('安全な記録ID生成機能が利用できません');
    }
    const entry = {
      id: editingId === null ? window.crypto.randomUUID() : editingId,
      shop: fields.shop.value, area: fields.area.value,
      dish: fields.dish.value, price: M.parsePrice(fields.price.value),
      visitedAt: M.date(fields.visitedAt.value), rating: Number(fields.rating.value),
      favorite: fields.favorite.checked, note: fields.note.value
    };
    return M.validateEntry(entry);
  }
  function create(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }
  function cardFor(entry) {
    const card = create('article', 'record');
    const top = create('div', 'record-top');
    const titleGroup = create('div', '');
    const title = create('h3', 'shop-title', entry.shop);
    const area = create('p', 'shop-area', entry.area ? '📍 ' + entry.area : '場所は未記録');
    titleGroup.append(title, area);
    const date = create('time', 'date-chip', entry.visitedAt);
    date.dateTime = entry.visitedAt;
    top.append(titleGroup, date);
    const body = create('div', 'record-body');
    body.append(create('p', 'dish-name', '🥢 ' + entry.dish));
    const chips = create('div', 'detail-row');
    chips.append(
      create('span', 'chip', yen(entry.price)),
      create('span', 'chip star', '★'.repeat(entry.rating) + '☆'.repeat(5 - entry.rating))
    );
    if (entry.favorite) chips.append(create('span', 'chip want', '♡ また行きたい'));
    body.append(chips);
    if (entry.note) body.append(create('p', 'memo', entry.note));
    const actions = create('div', 'card-actions');
    const favorite = create('button', entry.favorite ? 'active' : '', entry.favorite ? '♥ お気に入り中' : '♡ また行きたい');
    favorite.type = 'button';
    favorite.disabled = busy || stopped;
    favorite.setAttribute('aria-label', entry.shop + 'のまた行きたいを切り替える');
    favorite.addEventListener('click', () => {
      if (!slots || busy || stopped) return;
      try { void commit(M.toggleFavorite(slots, entry.id), 'また行きたいを更新しました'); }
      catch (error) { stop(error); }
    });
    const edit = create('button', '', '✎ 編集');
    edit.type = 'button';
    edit.disabled = busy || stopped;
    edit.setAttribute('aria-label', entry.shop + 'の記録を編集');
    edit.addEventListener('click', () => {
      if (!slots || busy || stopped) return;
      editingId = entry.id;
      setDraft(entry);
      formTitle.textContent = '記録を編集';
      saveButton.textContent = '更新';
      cancelButton.classList.remove('hidden');
      enabled();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const remove = create('button', '', '削除');
    remove.type = 'button';
    remove.disabled = busy || stopped;
    remove.setAttribute('aria-label', entry.shop + '・' + entry.dish + 'の記録を削除');
    remove.addEventListener('click', () => {
      if (!slots || busy || stopped) return;
      if (!window.confirm(entry.visitedAt + 'の「' + entry.shop + ' / ' + entry.dish + '」を削除しますか？')) return;
      try {
        const change = M.remove(slots, entry.id);
        void commit(change, '記録を削除しました', () => { if (editingId === entry.id) clearDraft(); });
      } catch (error) { stop(error); }
    });
    actions.append(favorite, edit, remove);
    card.append(top, body, actions);
    return card;
  }
  function render() {
    if (!slots) return;
    const stats = M.stats(slots);
    totalVisits.textContent = String(stats.visits);
    totalShops.textContent = String(stats.shops);
    totalFavorites.textContent = String(stats.favorites);
    const results = M.search(slots, searchInput.value, favoriteFilter.checked, sortInput.value);
    recordCount.textContent = results.length + '件表示 ／ 全' + stats.visits + '件';
    cards.replaceChildren(...results.map(cardFor));
    empty.classList.toggle('hidden', results.length > 0);
    empty.textContent = stats.visits === 0
      ? 'まだ記録がありません。最初の一皿を書いてみよう。'
      : '条件に合う記録がありません。検索条件を変えてみてね。';
  }
  async function commit(change, message, onSaved) {
    if (!slots || busy || stopped) return;
    const nextSlots = M.validateSlots(change.slots);
    const slotIndex = change.slotIndex;
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= M.SLOT_COUNT) {
      throw new Error('保存対象のページ番号が不正です');
    }
    busy = true;
    enabled();
    render();
    show('保存中…');
    try {
      if (!hasBridge()) throw new Error('個人保存APIへの接続が失われました');
      const saved = await window.minapp.userState.set(slotKey(slotIndex), nextSlots[slotIndex]);
      M.validateSlot(saved);
      if (JSON.stringify(saved) !== JSON.stringify(nextSlots[slotIndex])) {
        throw new Error('保存APIから予期しない内容が返されました');
      }
      slots = nextSlots;
      if (typeof onSaved === 'function') onSaved();
      show(message);
    } catch (error) {
      stop(error);
    } finally {
      busy = false;
      enabled();
      render();
    }
  }
  async function boot() {
    if (booting || slots || stopped) return;
    booting = true;
    try {
      if (!hasBridge()) throw new Error('みんアプ工房の個人保存APIが見つかりません');
      const loaded = await Promise.all(Array.from({ length: M.SLOT_COUNT }, async (_, i) => {
        try {
          return M.validateSlot(await window.minapp.userState.get(slotKey(i)));
        } catch (error) {
          if (!error || error.code !== 'state_not_found') throw error;
          return { version: M.VERSION, entries: [] };
        }
      }));
      M.validateSlots(loaded);
      slots = loaded;
      clearDraft();
      render();
      show('記録を読み込みました。お気に入りの一皿を追加しよう！');
    } catch (error) {
      stop(error);
    } finally {
      booting = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!slots || busy || stopped) return;
    try {
      const entry = readDraft();
      const change = editingId === null ? M.add(slots, entry) : M.update(slots, entry);
      void commit(change, editingId === null ? '新しい一皿を保存しました' : '記録を更新しました', clearDraft);
    } catch (error) {
      show('入力エラー: ' + (error instanceof Error ? error.message : String(error)), true);
    }
  });
  cancelButton.addEventListener('click', () => {
    if (!slots || busy || stopped) return;
    clearDraft();
    show('編集を取り消しました');
  });
  searchInput.addEventListener('input', render);
  favoriteFilter.addEventListener('change', render);
  sortInput.addEventListener('change', render);
  fields.visitedAt.value = todayLocal();
  window.addEventListener('minappready', () => { void boot(); });
  if (hasBridge()) void boot();
  else window.setTimeout(() => {
    if (!slots && !booting && !stopped) {
      stop(new Error('みんアプ工房から開いてください。個人保存APIが利用できません'));
    }
  }, 1800);
})();
