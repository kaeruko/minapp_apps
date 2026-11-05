(function () {
  'use strict';
  const R = window.LunchRoulette;
  if (!R) throw new Error('LunchRoulette core was not loaded');
  const KEY = 'lunch_roulette_v1';
  const VIEWS = ['roulette', 'history', 'stores', 'settings'];
  const COLORS = ['#ffe6a5', '#f2c762', '#fff1bf', '#ebd07f', '#fff2cd',
    '#f1b951', '#f6e3a7', '#eccb74', '#fff0b4', '#edd69a'];
  const $ = (id) => {
    const element = document.getElementById(id);
    if (!element) throw new Error('Missing lunch roulette element: ' + id);
    return element;
  };
  const controls = ['spin', 'draw-mode', 'budget-min', 'budget-max', 'avoid',
    'save-settings', 'store-name', 'store-genre', 'store-price', 'store-query',
    'store-note', 'add-store'].map($);
  const genreById = new Map(R.GENRES.map((genre) => [genre.id, genre]));
  let state = null;
  let booting = false;
  let saving = false;
  let spinning = false;
  let stopped = false;
  let lastChoice = null;
  let angle = 0;
  let currentView = 'roulette';

  function yen(value) { return '¥' + new Intl.NumberFormat('ja-JP').format(value); }
  function setStatus(message, error) {
    $('status').textContent = message;
    $('status').classList.toggle('error', Boolean(error));
  }
  function hasBridge() {
    return Boolean(window.minapp && window.minapp.version === 1 &&
      window.minapp.userState && typeof window.minapp.userState.get === 'function' &&
      typeof window.minapp.userState.set === 'function');
  }
  function disableUntilReady() {
    for (const element of controls) element.disabled = !state || saving || spinning || stopped;
    for (const checkbox of document.querySelectorAll('[data-genre]')) {
      checkbox.disabled = !state || saving || spinning || stopped;
    }
    for (const button of document.querySelectorAll('.delete')) {
      button.disabled = !state || saving || spinning || stopped;
    }
    $('filter').disabled = spinning || saving || stopped;
    $('to-stores').disabled = spinning || saving || stopped;
    for (const button of document.querySelectorAll('.nav-item')) {
      button.disabled = spinning || saving || stopped;
    }
  }
  function stop(error) {
    stopped = true;
    setStatus('保存・読み込みを停止しました: ' +
      (error instanceof Error ? error.message : String(error)), true);
    disableUntilReady();
    console.error(error);
  }
  function openView(view) {
    if (!VIEWS.includes(view)) throw new Error('Unknown lunch roulette view: ' + view);
    if (spinning || saving || stopped) return;
    currentView = view;
    for (const item of VIEWS) $('view-' + item).hidden = item !== view;
    for (const button of document.querySelectorAll('.nav-item')) {
      const active = button.dataset.view === view;
      button.classList.toggle('active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
  }
  function genreOptions() {
    for (const genre of R.GENRES) {
      const option = document.createElement('option');
      option.value = genre.id;
      option.textContent = genre.label;
      $('store-genre').appendChild(option);
      const label = document.createElement('label');
      label.className = 'genre-check';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = genre.id;
      checkbox.setAttribute('data-genre', '');
      const image = document.createElement('img');
      image.src = 'assets/' + genre.image;
      image.alt = '';
      const name = document.createElement('span');
      name.textContent = genre.label;
      label.append(checkbox, image, name);
      $('genre-filters').appendChild(label);
    }
  }
  function eligibleWheelGenres(list) {
    const ids = new Set(list.map((item) => item.genreId));
    return R.GENRES.filter((genre) => ids.has(genre.id));
  }
  function renderWheel(list) {
    const genres = eligibleWheelGenres(list);
    const wheel = $('wheel-disc');
    const icons = $('wheel-items');
    icons.replaceChildren();
    if (genres.length === 0) {
      wheel.style.background = '#e5cfaa';
      $('wheel-stage').setAttribute('aria-label', '抽選できる候補がありません');
      return;
    }
    const size = 360 / genres.length;
    const stops = genres.map((genre, i) =>
      COLORS[i % COLORS.length] + ' ' + (i * size).toFixed(4) + 'deg ' +
      ((i + 1) * size).toFixed(4) + 'deg'
    );
    wheel.style.background = 'conic-gradient(' + stops.join(',') + ')';
    for (const [i, genre] of genres.entries()) {
      const radius = 36;
      const rad = (i + .5) * 2 * Math.PI / genres.length;
      const div = document.createElement('div');
      div.className = 'wheel-item';
      div.style.left = (50 + radius * Math.sin(rad)) + '%';
      div.style.top = (50 - radius * Math.cos(rad)) + '%';
      div.style.transform = 'translate(-50%, -50%)';
      const image = document.createElement('img');
      image.src = 'assets/' + genre.image;
      image.alt = '';
      const label = document.createElement('span');
      label.textContent = genre.label;
      div.append(image, label);
      icons.appendChild(div);
    }
    $('wheel-stage').setAttribute('aria-label', '抽選候補: ' +
      genres.map((genre) => genre.label).join('、'));
  }
  function renderStores() {
    const list = $('store-list');
    list.replaceChildren();
    $('store-count').textContent = String(state.stores.length);
    $('no-stores').hidden = state.stores.length !== 0;
    for (const item of state.stores) {
      const row = document.createElement('div');
      row.className = 'store-card';
      const icon = document.createElement('img');
      icon.className = 'card-food';
      icon.src = 'assets/' + genreById.get(item.genreId).image;
      icon.alt = '';
      const copy = document.createElement('div');
      copy.className = 'card-details';
      const title = document.createElement('strong');
      title.textContent = item.name;
      const details = document.createElement('small');
      details.textContent = genreById.get(item.genreId).label + '・' +
        yen(item.priceYen) + (item.note ? '・' + item.note : '');
      copy.append(title, details);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'delete';
      del.textContent = '削除';
      del.setAttribute('aria-label', item.name + 'を削除');
      del.addEventListener('click', () => {
        if (!window.confirm(item.name + 'を登録店から削除しますか？')) return;
        try { void commit(R.deleteStore(state, item.id), 'お店を削除しました'); }
        catch (error) { setStatus(error.message, true); }
      });
      row.append(icon, copy, del);
      list.appendChild(row);
    }
  }
  function renderHistory() {
    const list = $('history-list');
    list.replaceChildren();
    $('no-history').hidden = state.history.length !== 0;
    for (const item of state.history.slice(0, 30)) {
      const row = document.createElement('div');
      row.className = 'history-card';
      const icon = document.createElement('img');
      icon.className = 'card-food';
      icon.src = 'assets/' + genreById.get(item.genreId).image;
      icon.alt = '';
      const copy = document.createElement('div');
      copy.className = 'card-details';
      const title = document.createElement('strong');
      title.textContent = item.label;
      const details = document.createElement('small');
      details.textContent = new Date(item.at).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
      }) + '・' + (item.mode === 'store' ? '登録店 ' + yen(item.priceYen) : 'ジャンル抽選');
      copy.append(title, details);
      row.append(icon, copy);
      list.appendChild(row);
    }
  }
  function renderResult(choice) {
    if (!choice) {
      $('result').hidden = true;
      $('map-link').hidden = true;
      $('map-prompt').textContent = '抽選結果が出たら、近くのお店を探そう。';
      $('map-query').textContent = '検索キーワードをここに表示します。';
      return;
    }
    $('result').hidden = false;
    $('result-image').src = 'assets/' + genreById.get(choice.genreId).image;
    $('result-name').textContent = choice.label;
    $('result-detail').textContent = choice.mode === 'store'
      ? '登録したお店・目安 ' + yen(choice.priceYen)
      : genreById.get(choice.genreId).label + ' が当たりました';
    $('result-warning').hidden = !state.settings.avoid.trim();
    $('result-warning').textContent = state.settings.avoid.trim()
      ? '食材の確認メモ：' + state.settings.avoid.trim() + '（材料は店頭で確認）' : '';
    const keyword = choice.query;
    $('map-prompt').textContent = '「' + choice.label + '」を地図で探す';
    $('map-query').textContent = '検索ワード：' + keyword;
    $('map-link').href = 'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(keyword);
    $('map-link').hidden = false;
  }
  function fillSettings() {
    $('budget-min').value = String(state.settings.minYen);
    $('budget-max').value = String(state.settings.maxYen);
    $('draw-mode').value = state.settings.mode;
    $('avoid').value = state.settings.avoid;
    const selected = new Set(state.settings.genreIds);
    for (const checkbox of document.querySelectorAll('[data-genre]')) {
      checkbox.checked = selected.has(checkbox.value);
    }
  }
  function render() {
    if (!state) return;
    R.validate(state);
    $('budget-label').textContent = yen(state.settings.minYen) + '〜' +
      yen(state.settings.maxYen);
    fillSettings();
    const list = R.candidates(state);
    renderWheel(list);
    $('spin').textContent = state.settings.mode === 'store' ? '🎲 お店を抽選する' : '🎲 ルーレットを回す';
    renderStores();
    renderHistory();
    renderResult(lastChoice);
    disableUntilReady();
  }
  async function commit(next, message, onSaved) {
    if (!state || saving || stopped) return;
    R.validate(next);
    saving = true;
    disableUntilReady();
    setStatus('保存中…');
    try {
      if (!hasBridge()) throw new Error('みんアプ工房の個人保存APIが利用できません');
      const response = await window.minapp.userState.set(KEY, next);
      R.validate(response);
      state = next;
      if (onSaved) onSaved();
      render();
      setStatus(message);
    } catch (error) {
      stop(error);
    } finally {
      saving = false;
      disableUntilReady();
    }
  }
  async function boot() {
    if (booting || state || stopped) return;
    booting = true;
    try {
      if (!hasBridge()) throw new Error('みんアプ工房の個人保存APIが見つかりません');
      let loaded;
      try {
        loaded = R.validate(await window.minapp.userState.get(KEY));
      } catch (error) {
        if (!error || error.code !== 'state_not_found') throw error;
        const initial = R.newState();
        R.validate(await window.minapp.userState.set(KEY, initial));
        loaded = initial;
      }
      state = loaded;
      if (state.history.length) {
        const latest = state.history[0];
        lastChoice = {
          mode: latest.mode,
          label: latest.label,
          genreId: latest.genreId,
          priceYen: latest.priceYen,
          storeId: latest.storeId,
          query: latest.label
        };
      }
      render();
      setStatus('準備できました。今日の昼めしを決めよう！');
    } catch (error) {
      stop(error);
    } finally {
      booting = false;
    }
  }
  function randomIndex(length) {
    if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
      throw new Error('安全な乱数生成APIを利用できません');
    }
    if (!Number.isSafeInteger(length) || length < 1 || length > 0xffffffff) {
      throw new RangeError('Invalid roulette candidate count');
    }
    const range = 0x100000000;
    const threshold = range - (range % length);
    const values = new Uint32Array(1);
    do { window.crypto.getRandomValues(values); } while (values[0] >= threshold);
    return values[0] % length;
  }
  async function spin() {
    if (!state || spinning || saving || stopped) return;
    const list = R.candidates(state);
    if (list.length === 0) {
      setStatus('この条件に合う登録店はありません。お店か条件を見直してください。', true);
      return;
    }
    if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
      stop(new Error('安全な抽選履歴ID生成APIを利用できません'));
      return;
    }
    const selection = R.choose(list, randomIndex(list.length));
    const genres = eligibleWheelGenres(list);
    const segmentIndex = genres.findIndex((genre) => genre.id === selection.genreId);
    if (segmentIndex < 0) throw new Error('Selected genre disappeared from the wheel');
    spinning = true;
    disableUntilReady();
    $('result').hidden = true;
    setStatus('今日の昼めしを選んでいます…');
    const n = genres.length;
    const centerDegrees = (segmentIndex + .5) * (360 / n);
    const target = (360 - centerDegrees + 360) % 360;
    const current = ((angle % 360) + 360) % 360;
    angle += 6 * 360 + ((target - current + 360) % 360);
    $('wheel-rotor').style.transform = 'rotate(' + angle + 'deg)';
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 4050));
      const next = R.record(state, selection, window.crypto.randomUUID(), new Date().toISOString());
      await commit(next, '決定！ ' + selection.label, () => { lastChoice = selection; });
    } finally {
      spinning = false;
      disableUntilReady();
    }
  }

  genreOptions();
  for (const button of document.querySelectorAll('.nav-item')) {
    button.addEventListener('click', () => openView(button.dataset.view));
  }
  $('filter').addEventListener('click', () => openView('settings'));
  $('to-stores').addEventListener('click', () => openView('stores'));
  $('spin').addEventListener('click', () => { void spin().catch(stop); });
  $('settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state || saving || spinning || stopped) return;
    try {
      const selected = [...document.querySelectorAll('[data-genre]:checked')].map((el) => el.value);
      const next = R.setSettings(state, {
        minYen: R.parseYen($('budget-min').value, '最低予算'),
        maxYen: R.parseYen($('budget-max').value, '最高予算'),
        genreIds: selected,
        avoid: $('avoid').value,
        mode: $('draw-mode').value
      });
      void commit(next, '条件を保存しました', () => {
        lastChoice = null;
      }).then(() => openView('roulette'));
    } catch (error) { setStatus(error.message, true); }
  });
  $('store-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!state || saving || spinning || stopped) return;
    try {
      if (!window.crypto || typeof window.crypto.randomUUID !== 'function') {
        throw new Error('安全な店舗ID生成APIを利用できません');
      }
      const next = R.addStore(state, {
        id: window.crypto.randomUUID(),
        name: $('store-name').value,
        genreId: $('store-genre').value,
        priceYen: R.parseYen($('store-price').value, 'お店の予算'),
        query: $('store-query').value,
        note: $('store-note').value
      });
      void commit(next, 'お店を登録しました', () => {
        $('store-form').reset();
      });
    } catch (error) { setStatus(error.message, true); }
  });
  window.addEventListener('minappready', () => { void boot(); });
  if (hasBridge()) void boot();
})();
