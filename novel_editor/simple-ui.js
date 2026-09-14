(function () {
  'use strict';

  const EVENT_LABELS = Object.freeze({
    dialogue: '💬 セリフ', background: '🖼️ 背景', character: '👤 キャラクター',
    choice: '⑂ 選択肢', goto: '➡️ シーン移動', bgm: '🎵 BGM', se: '🔊 効果音', end: '🏁 おわり',
  });
  const FIELD_LABELS = Object.freeze({ speaker: '話す人', action: '動き', slot: '位置', character: 'キャラクター', expression: '表情', goto: '移動先' });
  const OPTION_LABELS = Object.freeze({ show: '表示する', hide: '隠す', left: '左', center: '中央', right: '右', play: '再生する', stop: '停止する' });

  const sceneList = required('scene-list');
  const eventEditor = required('event-editor');
  const settingsPane = required('settings-pane');
  const characterSlot = required('character-settings-slot');
  const openSettings = required('open-project-settings');
  const closeSettings = required('close-project-settings');
  const sceneBack = required('scene-back');

  let scheduled = false;
  let effectsOverlay = null;
  let effectsSelect = null;
  let effectsAddButton = null;

  function required(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) throw new Error(`Simple UI requires #${id}`);
    return element;
  }

  function setView(view) {
    if (!['scenes', 'editor', 'settings'].includes(view)) throw new TypeError(`Unsupported simple UI view: ${view}`);
    document.body.dataset.simpleView = view;
    if (view === 'settings') settingsPane.scrollTop = 0;
  }

  function sceneId(button) {
    if (button.dataset.sceneId) return button.dataset.sceneId;
    const value = button.textContent.trim();
    if (!value) throw new Error('Scene button has no scene id');
    button.dataset.sceneId = value;
    return value;
  }

  function nextSceneId() {
    const used = new Set(Array.from(sceneList.querySelectorAll('.scene-button')).map(sceneId));
    for (let index = 1; index <= 999999; index += 1) {
      const value = `scene_${String(index).padStart(3, '0')}`;
      if (!used.has(value)) return value;
    }
    throw new Error('Could not allocate a scene id');
  }

  function decorateScenes() {
    const buttons = Array.from(sceneList.querySelectorAll('.scene-button'));
    buttons.forEach((button, index) => {
      const rawId = sceneId(button);
      const display = `シーン ${index + 1}`;
      if (button.textContent !== display) button.textContent = display;
      if (button.title !== rawId) button.title = rawId;
      button.parentElement?.classList.add('scene-row');
      if (button.dataset.simpleUiBound !== '1') {
        button.dataset.simpleUiBound = '1';
        button.addEventListener('click', () => setView('editor'));
      }
    });

    const form = Array.from(sceneList.children).find((child) => child.classList?.contains('asset-form'));
    if (!(form instanceof HTMLElement)) return;
    form.classList.add('simple-scene-add');
    const input = form.querySelector('input');
    const add = form.querySelector('button');
    if (!(input instanceof HTMLInputElement) || !(add instanceof HTMLButtonElement)) throw new Error('Scene add form is incomplete');
    input.classList.add('technical-control');
    if (input.value === '') input.value = nextSceneId();
    if (add.textContent !== '＋ シーンを追加') add.textContent = '＋ シーンを追加';
    if (add.dataset.simpleUiBound !== '1') {
      add.dataset.simpleUiBound = '1';
      add.addEventListener('click', () => { input.value = nextSceneId(); }, true);
      add.addEventListener('click', () => setView('editor'));
    }
  }

  function decorateCharacters() {
    const panel = document.querySelector('#character-list')?.closest('.side-card');
    if (!(panel instanceof HTMLElement)) return;
    if (panel.parentElement !== characterSlot) characterSlot.appendChild(panel);
    const note = panel.querySelector('h3 + p');
    const copy = '名前や立ち絵、表情をまとめて設定できます。IDなどの詳細は作品データ内部で保持します。';
    if (note instanceof HTMLElement && note.textContent !== copy) note.textContent = copy;
  }

  function translateOptions(select) {
    for (const option of select.options) {
      const label = OPTION_LABELS[option.value];
      if (label && option.textContent !== label) option.textContent = label;
    }
  }

  function decorateFields(card) {
    for (const label of card.querySelectorAll('label')) {
      const textNode = Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== '');
      const raw = textNode?.textContent.trim();
      if (raw && FIELD_LABELS[raw] && textNode.textContent.trim() !== FIELD_LABELS[raw]) textNode.textContent = `${FIELD_LABELS[raw]} `;
      const select = label.querySelector('select');
      if (select instanceof HTMLSelectElement) translateOptions(select);
    }
    for (const select of card.querySelectorAll('select')) translateOptions(select);
  }

  function decorateEventCard(card) {
    const heading = card.querySelector(':scope > .event-heading');
    const type = heading?.querySelector('strong');
    if (!(heading instanceof HTMLElement) || !(type instanceof HTMLElement)) return false;
    const rawType = type.dataset.eventType || type.textContent.trim();
    const display = EVENT_LABELS[rawType];
    if (!display) return false;
    type.dataset.eventType = rawType;
    if (type.textContent !== display) type.textContent = display;
    card.dataset.eventType = rawType;

    const identity = type.parentElement;
    const id = identity?.querySelector('code');
    if (id instanceof HTMLElement) id.classList.add('technical-id');
    for (const code of card.querySelectorAll('.choice-row code')) code.classList.add('technical-id');

    const actions = heading.querySelector(':scope > .asset-actions');
    if (actions instanceof HTMLElement && !heading.querySelector(':scope > details.event-menu')) {
      const menu = document.createElement('details');
      menu.className = 'event-menu';
      const summary = document.createElement('summary');
      summary.textContent = '⋯';
      summary.setAttribute('aria-label', 'この項目のメニュー');
      menu.append(summary, actions);
      heading.appendChild(menu);
      for (const button of actions.querySelectorAll('button')) {
        if (button.textContent === '↑') button.textContent = '上へ移動';
        if (button.textContent === '↓') button.textContent = '下へ移動';
      }
    }
    decorateFields(card);
    return true;
  }

  function addVia(select, addButton, type) {
    if (!Array.from(select.options).some((option) => option.value === type)) throw new Error(`Event type ${type} is unavailable`);
    select.value = type;
    addButton.click();
  }

  function proxyButton(label, type, select, addButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary simple-add-button';
    button.textContent = label;
    button.disabled = addButton.disabled;
    button.addEventListener('click', () => addVia(select, addButton, type));
    return button;
  }

  function ensureEffectsOverlay() {
    if (effectsOverlay) return effectsOverlay;
    const overlay = document.createElement('div');
    overlay.className = 'effects-overlay';
    overlay.hidden = true;
    const sheet = document.createElement('section');
    sheet.className = 'effects-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = '<div class="effects-heading"><h2>演出を追加</h2><button class="sheet-close" type="button" aria-label="閉じる">×</button></div>';
    sheet.querySelector('.sheet-close').addEventListener('click', closeEffects);
    const list = document.createElement('div');
    list.className = 'effects-list';
    const entries = [
      ['background', '🖼️', '背景を変える', 'シーンの背景画像を設定します'],
      ['character', '👤', 'キャラクターを出す', '立ち絵の表示・非表示を設定します'],
      ['bgm', '🎵', 'BGMを流す', 'BGMの再生・停止を設定します'],
      ['se', '🔊', '効果音を鳴らす', '効果音を再生します'],
      ['goto', '➡️', '別のシーンへ移動', '物語を別のシーンへ進めます'],
      ['end', '🏁', '物語を終わる', 'エンディングを表示します'],
    ];
    for (const [type, icon, label, description] of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'effects-option';
      button.innerHTML = `<span class="effects-icon">${icon}</span><span><strong>${label}</strong><small>${description}</small></span><span aria-hidden="true">›</span>`;
      button.addEventListener('click', () => {
        if (!(effectsSelect instanceof HTMLSelectElement) || !(effectsAddButton instanceof HTMLButtonElement)) throw new Error('Event add controls are unavailable');
        addVia(effectsSelect, effectsAddButton, type);
        closeEffects();
      });
      list.appendChild(button);
    }
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary sheet-cancel';
    cancel.textContent = 'キャンセル';
    cancel.addEventListener('click', closeEffects);
    sheet.append(list, cancel);
    overlay.appendChild(sheet);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) closeEffects(); });
    document.body.appendChild(overlay);
    effectsOverlay = overlay;
    return overlay;
  }

  function openEffects(select, addButton) {
    if (!(select instanceof HTMLSelectElement) || !(addButton instanceof HTMLButtonElement)) throw new TypeError('Event controls are required to open effects');
    effectsSelect = select;
    effectsAddButton = addButton;
    ensureEffectsOverlay().hidden = false;
  }

  function closeEffects() {
    if (effectsOverlay) effectsOverlay.hidden = true;
    effectsSelect = null;
    effectsAddButton = null;
  }

  function decorateAddCard(card) {
    if (card.dataset.simpleUiAdd === '1') return;
    const select = card.querySelector('select');
    const add = Array.from(card.querySelectorAll('button')).find((button) => button.textContent.includes('イベント追加'));
    if (!(select instanceof HTMLSelectElement) || !(add instanceof HTMLButtonElement)) return;
    card.dataset.simpleUiAdd = '1';
    card.classList.add('event-add-card');
    select.closest('label')?.classList.add('technical-control');
    add.classList.add('technical-control');
    card.querySelector('p')?.classList.add('technical-control');
    const controls = document.createElement('div');
    controls.className = 'simple-add-controls';
    const effects = document.createElement('button');
    effects.type = 'button';
    effects.className = 'secondary simple-add-button';
    effects.textContent = '✨ ＋ 演出を追加';
    effects.disabled = add.disabled;
    effects.addEventListener('click', () => openEffects(select, add));
    controls.append(proxyButton('💬 ＋ セリフを追加', 'dialogue', select, add), proxyButton('⑂ ＋ 選択肢を追加', 'choice', select, add), effects);
    card.appendChild(controls);
  }

  function decorateEvents() {
    for (const card of eventEditor.querySelectorAll(':scope > .event-card')) {
      if (!decorateEventCard(card)) decorateAddCard(card);
    }
    const heading = eventEditor.querySelector(':scope > .scene-heading');
    const title = heading?.querySelector('h2');
    if (title instanceof HTMLElement) {
      const rawId = title.dataset.sceneId || title.textContent.trim();
      title.dataset.sceneId = rawId;
      const buttons = Array.from(sceneList.querySelectorAll('.scene-button'));
      const index = buttons.findIndex((button) => sceneId(button) === rawId);
      const display = index >= 0 ? `シーン ${index + 1}を編集` : 'シーンを編集';
      if (title.textContent !== display) title.textContent = display;
    }
    heading?.querySelector('span')?.classList.add('technical-control');
  }

  function decorateDiagnostics() {
    document.getElementById('revision')?.classList.add('technical-meta');
    document.getElementById('content-revision')?.classList.add('technical-meta');
    const validation = document.getElementById('validation');
    if (validation?.dataset.kind === 'ok' && validation.textContent !== '作品データに問題はありません。') validation.textContent = '作品データに問題はありません。';
  }

  function decorate() {
    scheduled = false;
    decorateScenes();
    decorateCharacters();
    decorateEvents();
    decorateDiagnostics();
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(decorate);
  }

  openSettings.addEventListener('click', () => setView('settings'));
  closeSettings.addEventListener('click', () => setView('scenes'));
  sceneBack.addEventListener('click', () => setView('scenes'));
  document.body.dataset.simpleView = 'scenes';

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(sceneList, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  observer.observe(eventEditor, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  observer.observe(settingsPane, { childList: true, subtree: true });
  decorate();
})();