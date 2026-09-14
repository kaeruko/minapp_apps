(function () {
  'use strict';

  const sceneList = requiredElement('scene-list');
  const eventEditor = requiredElement('event-editor');
  const settingsPane = requiredElement('settings-pane');
  const characterSettingsSlot = requiredElement('character-settings-slot');
  const openSettings = requiredElement('open-project-settings');
  const closeSettings = requiredElement('close-project-settings');
  const sceneBack = requiredElement('scene-back');

  const EVENT_LABELS = Object.freeze({
    dialogue: '💬 セリフ',
    background: '🖼️ 背景',
    character: '👤 キャラクター',
    choice: '⑂ 選択肢',
    goto: '➡️ シーン移動',
    bgm: '🎵 BGM',
    se: '🔊 効果音',
    end: '🏁 おわり',
  });

  const FIELD_LABELS = Object.freeze({
    speaker: '話す人',
    action: '動き',
    slot: '位置',
    character: 'キャラクター',
    expression: '表情',
    goto: '移動先',
  });

  const OPTION_LABELS = Object.freeze({
    show: '表示する',
    hide: '隠す',
    left: '左',
    center: '中央',
    right: '右',
    play: '再生する',
    stop: '停止する',
  });

  let scheduled = false;
  let effectsSheet = null;
  let currentAddSelect = null;
  let currentAddButton = null;

  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Simple UI requires #${id}`);
    }
    return element;
  }

  function setView(view) {
    if (!['scenes', 'editor', 'settings'].includes(view)) {
      throw new TypeError(`Unsupported simple UI view: ${view}`);
    }
    document.body.dataset.simpleView = view;
    if (view === 'settings') settingsPane.scrollTop = 0;
  }

  function sceneIdFromButton(button) {
    const stored = button.dataset.sceneId;
    if (stored) return stored;
    const raw = button.textContent.trim();
    if (!raw) throw new Error('Scene button has no scene id');
    button.dataset.sceneId = raw;
    return raw;
  }

  function nextSceneId() {
    const used = new Set(
      Array.from(sceneList.querySelectorAll('.scene-button')).map(sceneIdFromButton),
    );
    for (let index = 1; index <= 999999; index += 1) {
      const id = `scene_${String(index).padStart(3, '0')}`;
      if (!used.has(id)) return id;
    }
    throw new Error('Could not allocate a scene id');
  }

  function decorateScenes() {
    const buttons = Array.from(sceneList.querySelectorAll('.scene-button'));
    buttons.forEach((button, index) => {
      const sceneId = sceneIdFromButton(button);
      button.textContent = `シーン ${index + 1}`;
      button.title = sceneId;
      const row = button.parentElement;
      if (row instanceof HTMLElement) row.classList.add('scene-row');
      if (button.dataset.simpleUiBound !== '1') {
        button.dataset.simpleUiBound = '1';
        button.addEventListener('click', () => setView('editor'));
      }
    });

    const addForm = Array.from(sceneList.children).find(
      (child) => child instanceof HTMLElement && child.classList.contains('asset-form'),
    );
    if (!(addForm instanceof HTMLElement)) return;
    addForm.classList.add('simple-scene-add');
    const input = addForm.querySelector('input');
    const addButton = addForm.querySelector('button');
    if (!(input instanceof HTMLInputElement) || !(addButton instanceof HTMLButtonElement)) {
      throw new Error('Scene add form is incomplete');
    }
    input.value = nextSceneId();
    input.classList.add('technical-control');
    addButton.textContent = '＋ シーンを追加';
    if (addButton.dataset.simpleUiBound !== '1') {
      addButton.dataset.simpleUiBound = '1';
      addButton.addEventListener(
        'click',
        () => {
          input.value = nextSceneId();
        },
        true,
      );
      addButton.addEventListener('click', () => setView('editor'));
    }
  }

  function decorateCharacters() {
    const characterPanel = document.querySelector('#character-list')?.closest('.side-card');
    if (!(characterPanel instanceof HTMLElement)) return;
    if (characterPanel.parentElement !== characterSettingsSlot) {
      characterSettingsSlot.appendChild(characterPanel);
    }
    const note = characterPanel.querySelector('h3 + p');
    if (note instanceof HTMLElement) {
      note.textContent = '名前や立ち絵、表情をまとめて設定できます。IDなどの詳細は作品データ内部で保持します。';
    }
  }

  function translateSelectOptions(select) {
    for (const option of select.options) {
      if (OPTION_LABELS[option.value]) option.textContent = OPTION_LABELS[option.value];
    }
  }

  function decorateFieldLabels(card) {
    for (const label of card.querySelectorAll('label')) {
      const ownText = Array.from(label.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent)
        .join('')
        .trim();
      if (FIELD_LABELS[ownText]) {
        for (const node of Array.from(label.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() === ownText) {
            node.textContent = `${FIELD_LABELS[ownText]} `;
          }
        }
      }
      const select = label.querySelector('select');
      if (select instanceof HTMLSelectElement) translateSelectOptions(select);
    }
    for (const select of card.querySelectorAll('select')) translateSelectOptions(select);
  }

  function decorateEventCard(card) {
    const heading = card.querySelector(':scope > .event-heading');
    if (!(heading instanceof HTMLElement)) return false;
    const type = heading.querySelector('strong');
    if (!(type instanceof HTMLElement)) return false;
    const rawType = type.dataset.eventType || type.textContent.trim();
    if (!EVENT_LABELS[rawType]) return false;
    type.dataset.eventType = rawType;
    type.textContent = EVENT_LABELS[rawType];
    card.dataset.eventType = rawType;

    const identity = type.parentElement;
    const id = identity?.querySelector('code');
    if (id instanceof HTMLElement) {
      id.classList.add('technical-id');
      id.title = id.textContent;
    }

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

    for (const code of card.querySelectorAll('.choice-row code')) {
      code.classList.add('technical-id');
    }
    decorateFieldLabels(card);
    return true;
  }

  function ensureEffectsSheet() {
    if (effectsSheet) return effectsSheet;
    const overlay = document.createElement('div');
    overlay.className = 'effects-overlay';
    overlay.hidden = true;
    const sheet = document.createElement('section');
    sheet.className = 'effects-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', '演出を追加');
    const heading = document.createElement('div');
    heading.className = 'effects-heading';
    const title = document.createElement('h2');
    title.textContent = '演出を追加';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sheet-close';
    close.textContent = '×';
    close.addEventListener('click', () => closeEffects());
    heading.append(title, close);
    sheet.appendChild(heading);

    const choices = [
      ['background', '🖼️', '背景を変える', 'シーンの背景画像を設定します'],
      ['character', '👤', 'キャラクターを出す', '立ち絵の表示・非表示を設定します'],
      ['bgm', '🎵', 'BGMを流す', 'BGMの再生・停止を設定します'],
      ['se', '🔊', '効果音を鳴らす', '効果音を再生します'],
      ['goto', '➡️', '別のシーンへ移動', '物語を別のシーンへ進めます'],
      ['end', '🏁', '物語を終わる', 'エンディングを表示します'],
    ];
    const list = document.createElement('div');
    list.className = 'effects-list';
    for (const [eventType, icon, label, description] of choices) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'effects-option';
      button.innerHTML = `<span class="effects-icon">${icon}</span><span><strong>${label}</strong><small>${description}</small></span><span aria-hidden="true">›</span>`;
      button.addEventListener('click', () => {
        addEvent(eventType);
        closeEffects();
      });
      list.appendChild(button);
    }
    sheet.appendChild(list);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'secondary sheet-cancel';
    cancel.textContent = 'キャンセル';
    cancel.addEventListener('click', () => closeEffects());
    sheet.appendChild(cancel);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeEffects();
    });
    overlay.appendChild(sheet);
    document.body.appendChild(overlay);
    effectsSheet = overlay;
    return overlay;
  }

  function openEffects(select, addButton) {
    if (!(select instanceof HTMLSelectElement) || !(addButton instanceof HTMLButtonElement)) {
      throw new TypeError('Event controls are required to open effects');
    }
    currentAddSelect = select;
    currentAddButton = addButton;
    const overlay = ensureEffectsSheet();
    overlay.hidden = false;
  }

  function closeEffects() {
    if (!effectsSheet) return;
    effectsSheet.hidden = true;
    currentAddSelect = null;
    currentAddButton = null;
  }

  function addEvent(eventType) {
    if (!(currentAddSelect instanceof HTMLSelectElement) || !(currentAddButton instanceof HTMLButtonElement)) {
      throw new Error('Event add controls are unavailable');
    }
    const option = Array.from(currentAddSelect.options).find((item) => item.value === eventType);
    if (!option) throw new Error(`Event type ${eventType} is unavailable`);
    currentAddSelect.value = eventType;
    currentAddButton.click();
  }

  function decorateEventAddCard(card) {
    if (card.dataset.simpleUiAdd === '1') return;
    const select = card.querySelector('select');
    const addButton = Array.from(card.querySelectorAll('button')).find((button) =>
      button.textContent.includes('イベント追加'),
    );
    if (!(select instanceof HTMLSelectElement) || !(addButton instanceof HTMLButtonElement)) return;
    card.dataset.simpleUiAdd = '1';
    card.classList.add('event-add-card');
    select.classList.add('technical-control');
    addButton.classList.add('technical-control');
    const label = select.closest('label');
    if (label instanceof HTMLElement) label.classList.add('technical-control');
    const help = card.querySelector('p');
    if (help instanceof HTMLElement) help.classList.add('technical-control');

    const controls = document.createElement('div');
    controls.className = 'simple-add-controls';
    const dialogue = proxyAddButton('💬 ＋ セリフを追加', 'dialogue', select, addButton);
    const choice = proxyAddButton('⑂ ＋ 選択肢を追加', 'choice', select, addButton);
    const effects = document.createElement('button');
    effects.type = 'button';
    effects.className = 'secondary simple-add-button';
    effects.textContent = '✨ ＋ 演出を追加';
    effects.disabled = addButton.disabled;
    effects.addEventListener('click', () => openEffects(select, addButton));
    controls.append(dialogue, choice, effects);
    card.appendChild(controls);
  }

  function proxyAddButton(label, eventType, select, addButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary simple-add-button';
    button.textContent = label;
    button.disabled = addButton.disabled;
    button.addEventListener('click', () => {
      const option = Array.from(select.options).find((item) => item.value === eventType);
      if (!option) throw new Error(`Event type ${eventType} is unavailable`);
      select.value = eventType;
      addButton.click();
    });
    return button;
  }

  function decorateEvents() {
    const cards = Array.from(eventEditor.querySelectorAll(':scope > .event-card'));
    for (const card of cards) {
      if (!decorateEventCard(card)) decorateEventAddCard(card);
    }
    const heading = eventEditor.querySelector(':scope > .scene-heading');
    if (heading instanceof HTMLElement) {
      const id = heading.querySelector('h2');
      if (id instanceof HTMLElement) {
        const rawSceneId = id.dataset.sceneId || id.textContent.trim();
        id.dataset.sceneId = rawSceneId;
        const sceneButtons = Array.from(sceneList.querySelectorAll('.scene-button'));
        const index = sceneButtons.findIndex((button) => sceneIdFromButton(button) === rawSceneId);
        id.textContent = index >= 0 ? `シーン ${index + 1}を編集` : 'シーンを編集';
      }
      const note = heading.querySelector('span');
      if (note instanceof HTMLElement) note.classList.add('technical-control');
    }
  }

  function decorateTechnicalCopy() {
    const revision = document.getElementById('revision');
    const contentRevision = document.getElementById('content-revision');
    if (revision) revision.classList.add('technical-meta');
    if (contentRevision) contentRevision.classList.add('technical-meta');
    const validation = document.getElementById('validation');
    if (validation && validation.dataset.kind === 'ok') {
      validation.textContent = '作品データに問題はありません。';
    }
  }

  function decorate() {
    scheduled = false;
    decorateScenes();
    decorateCharacters();
    decorateEvents();
    decorateTechnicalCopy();
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