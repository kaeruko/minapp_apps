(function () {
  'use strict';

  const M = window.ChukaMemo;
  if (!M || M.VERSION !== 1) throw new Error('町中華メモの計算・保存モデルを読み込めません');
  const maps = window.ChukaMemoMaps;
  if (!maps || typeof maps.apiKey !== 'string' || !/^AIza[0-9A-Za-z_-]{30,60}$/.test(maps.apiKey)) {
    throw new Error('Google Maps Embed APIキーが未設定または不正です');
  }

  const KEY_PREFIX = 'chuka_memo_v1_';
  const DEFAULT_MAP_QUERY = '町中華 東京';
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
  const homeCards = el('home-records');
  const empty = el('no-records');
  const homeEmpty = el('home-empty');
  const recordCount = el('result-count');
  const totalVisits = el('stat-visits');
  const totalShops = el('stat-shops');
  const totalFavorites = el('stat-favorites');
  const mapFrame = el('map-frame');
  const largeMapFrame = el('map-frame-large');
  const mapQuery = el('map-query');
  const largeMapQuery = el('map-query-large');
  const mapNote = el('map-note');
  const inputs = [...Object.values(fields), saveButton, cancelButton, searchInput, favoriteFilter, sortInput];
  const validViews = new Set(['home', 'map', 'list', 'add']);
  let slots = null;
  let booting = false;
  let busy = false;
  let stopped = false;
  let editingId = null;
  let currentMapQuery = DEFAULT_MAP_QUERY;
  let largeMapLoaded = false;

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

  function create(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = value;
    return node;
  }

  function mapUrl(query) {
    if (typeof query !== 'string') throw new TypeError('地図検索語は文字列で指定してください');
    const normalized = query.trim();
    if (!normalized || normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new Error('地図検索は1〜120文字で入力してください');
    }
    const parameters = new URLSearchParams({
      key: maps.apiKey,
      q: normalized,
      language: 'ja',
      region: 'JP'
    });
    return 'https://www.google.com/maps/embed/v1/search?' + parameters.toString();
  }

  function setMapQuery(query, loadLarge) {
    const url = mapUrl(query);
    currentMapQuery = query.trim();
    mapQuery.value = currentMapQuery;
    largeMapQuery.value = currentMapQuery;
    mapFrame.src = url;
    if (loadLarge || largeMapLoaded) {
      largeMapFrame.src = url;
      largeMapLoaded = true;
    }
    mapNote.textContent = '「' + currentMapQuery + '」の検索結果を表示中';
  }

  function openView(name) {
    if (!validViews.has(name)) throw new Error('未対応の画面です: ' + name);
    for (const view of document.querySelectorAll('.view')) {
      view.classList.toggle('active', view.id === 'view-' + name);
    }
    for (const button of document.querySelectorAll('.nav-button')) {
      button.classList.toggle('active', button.dataset.view === name);
      button.setAttribute('aria-current', button.dataset.view === name ? 'page' : 'false');
    }
    if (name === 'map' && !largeMapLoaded) setMapQuery(currentMapQuery, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
    formTitle.textContent = '新しい町中華メモ';
    saveButton.textContent = 'この一皿を保存';
    cancelButton.classList.add('hidden');
    enabled();
  }

  function readDraft() {
    if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
      throw new Error('安全な記録ID生成機能が利用できません');
    }
    return M.validateEntry({
      id: editingId === null ? window.crypto.randomUUID() : editingId,
      shop: fields.shop.value,
      area: fields.area.value,
      dish: fields.dish.value,
      price: M.parsePrice(fields.price.value),
      visitedAt: M.date(fields.visitedAt.value),
      rating: Number(fields.rating.value),
      favorite: fields.favorite.checked,
      note: fields.note.value
    });
  }

  function queryFor(entry) {
    return [entry.shop, entry.area].filter(Boolean).join(' ');
  }

  function cardFor(entry) {
    const card = create('article', 'record');
    const main = create('div', 'record-main');
    main.append(create('div', 'dish-art', entry.rating >= 4 ? '🥟' : '🍜'));
    const copy = create('div', 'record-copy');
    const heading = create('div', 'shop-line');
    const title = create('h3', 'shop-title', entry.shop);
    const date = create('time', 'date-chip', entry.visitedAt);
    date.dateTime = entry.visitedAt;
    heading.append(title, date);
    copy.append(
      heading,
      create('p', 'shop-area', entry.area ? '📍 ' + entry.area : '場所は未記録'),
      create('p', 'dish-name', entry.dish + ' ・ ' + yen(entry.price)),
      create('div', 'rating', '●'.repeat(entry.rating) + '○'.repeat(5 - entry.rating))
    );
    if (entry.note) copy.append(create('p', 'memo', entry.note));

    const favorite = create('button', 'favorite-button' + (entry.favorite ? ' active' : ''), entry.favorite ? '♥' : '♡');
    favorite.type = 'button';
    favorite.disabled = busy || stopped;
    favorite.setAttribute('aria-label', entry.shop + 'のまた行きたいを切り替える');
    favorite.addEventListener('click', () => {
      if (!slots || busy || stopped) return;
      try { void commit(M.toggleFavorite(slots, entry.id), 'また行きたいを更新しました'); }
      catch (error) { stop(error); }
    });
    main.append(copy, favorite);

    const actions = create('div', 'card-actions');
    const showMap = create('button', '', '⌖ 地図で見る');
    showMap.type = 'button';
    showMap.addEventListener('click', () => {
      try {
        setMapQuery(queryFor(entry), true);
        openView('map');
      } catch (error) { show('地図エラー: ' + (error instanceof Error ? error.message : String(error)), true); }
    });
    const edit = create('button', '', '✎ 編集');
    edit.type = 'button';
    edit.disabled = busy || stopped;
    edit.addEventListener('click', () => {
      if (!slots || busy || stopped) return;
      editingId = entry.id;
      setDraft(entry);
      formTitle.textContent = '町中華メモを編集';
      saveButton.textContent = '変更を保存する';
      cancelButton.classList.remove('hidden');
      enabled();
      openView('add');
    });
    const remove = create('button', '', '削除');
    remove.type = 'button';
    remove.disabled = busy || stopped;
    remove.addEventListener('click', () => {
      if (!slots || busy || stopped) return;
      if (!window.confirm(entry.visitedAt + 'の「' + entry.shop + ' / ' + entry.dish + '」を削除しますか？')) return;
      try {
        const change = M.remove(slots, entry.id);
        void commit(change, '記録を削除しました', () => { if (editingId === entry.id) clearDraft(); });
      } catch (error) { stop(error); }
    });
    actions.append(showMap, edit, remove);
    card.append(main, actions);
    return card;
  }

  function render() {
    if (!slots) return;
    const stats = M.stats(slots);
    totalVisits.textContent = String(stats.visits);
    totalShops.textContent = String(stats.shops);
    totalFavorites.textContent = String(stats.favorites);
    const results = M.search(slots, searchInput.value, favoriteFilter.checked, sortInput.value);
    const recent = M.search(slots, '', false, 'recent').slice(0, 3);
    recordCount.textContent = results.length + '件表示 ／ 全' + stats.visits + '件';
    cards.replaceChildren(...results.map(cardFor));
    homeCards.replaceChildren(...recent.map(cardFor));
    empty.classList.toggle('hidden', results.length > 0);
    homeEmpty.classList.toggle('hidden', recent.length > 0);
    empty.textContent = stats.visits === 0
      ? 'まだ記録がありません。最初の一皿を書いてみよう。'
      : '条件に合う記録がありません。検索条件を変えてください。';
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
      show('記録を読み込みました。気になる店を地図で探してみよう。');
    } catch (error) {
      stop(error);
    } finally {
      booting = false;
    }
  }

  function submitMapSearch(event, input, loadLarge) {
    event.preventDefault();
    try { setMapQuery(input.value, loadLarge); }
    catch (error) { show('地図検索エラー: ' + (error instanceof Error ? error.message : String(error)), true); }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!slots || busy || stopped) return;
    try {
      const entry = readDraft();
      const adding = editingId === null;
      const change = adding ? M.add(slots, entry) : M.update(slots, entry);
      void commit(change, adding ? '新しい一皿を保存しました' : '記録を更新しました', () => {
        clearDraft();
        openView('home');
      });
    } catch (error) {
      show('入力エラー: ' + (error instanceof Error ? error.message : String(error)), true);
    }
  });
  cancelButton.addEventListener('click', () => {
    if (!slots || busy || stopped) return;
    clearDraft();
    openView('list');
    show('編集を取り消しました');
  });
  searchInput.addEventListener('input', render);
  favoriteFilter.addEventListener('change', render);
  sortInput.addEventListener('change', render);
  el('map-search-form').addEventListener('submit', (event) => submitMapSearch(event, mapQuery, false));
  el('map-search-form-large').addEventListener('submit', (event) => submitMapSearch(event, largeMapQuery, true));
  el('show-all').addEventListener('click', () => openView('list'));
  el('add-shortcut').addEventListener('click', () => openView('add'));
  for (const button of document.querySelectorAll('.nav-button')) {
    button.addEventListener('click', () => openView(button.dataset.view));
  }

  fields.visitedAt.value = todayLocal();
  setMapQuery(DEFAULT_MAP_QUERY, false);
  window.addEventListener('minappready', () => { void boot(); });
  if (hasBridge()) void boot();
  else window.setTimeout(() => {
    if (!slots && !booting && !stopped) {
      stop(new Error('みんアプ工房から開いてください。個人保存APIが利用できません'));
    }
  }, 1800);
})();
