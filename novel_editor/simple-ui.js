(function () {
  'use strict';

  const EVENT_LABELS = Object.freeze({
    dialogue: '💬 セリフ', background: '🖼️ 背景', character: '👤 キャラクター',
    choice: '⑂ 選択肢', goto: '➡️ シーン移動', bgm: '🎵 BGM', se: '🔊 効果音', end: '🏁 おわり',
  });
  const FIELD_LABELS = Object.freeze({ speaker: '話す人', action: '動き', slot: '位置', character: 'キャラクター', expression: '表情', goto: '移動先' });
  const OPTION_LABELS = Object.freeze({ show: '表示する', hide: '隠す', left: '左', center: '中央', right: '右', play: '再生する', stop: '停止する' });
  const SAMPLE_SCENE_LABELS = Object.freeze({
    start: '放課後の教室',
    rooftop: '屋上',
    together: 'となりに座る',
    photo: '写真を撮る',
    leave: '帰る',
  });
  const SIMPLE_VIEWS = Object.freeze(['scenes', 'editor', 'settings', 'publish']);
  const SHORT_STATUS_MESSAGES = new Set([
    '作品を読み込んでいます',
    '読み込みました',
    '保存しました',
    '変更があります',
  ]);

  const sceneList = required('scene-list');
  const eventEditor = required('event-editor');
  const settingsPane = required('settings-pane');
  const characterSlot = required('character-settings-slot');
  const openSettings = required('open-project-settings');
  const closeSettings = required('close-project-settings');
  const sceneBack = required('scene-back');
  const status = required('status');
  const storyTitle = requiredInput('story-title');
  const saveButton = requiredButton('save-button');
  const previewButton = requiredButton('preview-button');
  const publishButton = requiredButton('publish-button');
  const startSceneSelect = requiredSelect('start-scene');
  const workspace = document.querySelector('.workspace');
  const app = document.querySelector('.app');
  if (!(workspace instanceof HTMLElement) || !(app instanceof HTMLElement)) {
    throw new Error('Simple UI requires .app and .workspace');
  }

  let scheduled = false;
  let effectsOverlay = null;
  let effectsSelect = null;
  let effectsAddButton = null;
  let footerNav = null;
  let previewProxy = null;
  let publishProxy = null;
  let publishHint = null;
  let projectHero = null;
  let projectHeroTitle = null;
  let projectHeroStatus = null;
  let projectHeroSave = null;

  function required(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) throw new Error(`Simple UI requires #${id}`);
    return element;
  }

  function requiredInput(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Simple UI requires input #${id}`);
    return element;
  }

  function requiredButton(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLButtonElement)) throw new Error(`Simple UI requires button #${id}`);
    return element;
  }

  function requiredSelect(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLSelectElement)) throw new Error(`Simple UI requires select #${id}`);
    return element;
  }

  function ensureMobileChrome() {
    if (!document.getElementById('simple-mobile-chrome-style')) {
      const style = document.createElement('style');
      style.id = 'simple-mobile-chrome-style';
      style.textContent = `
        .editor-footer, .publish-pane, .mobile-project-preview, .mobile-project-hero { display: none; }
        @media (max-width: 900px) {
          .app { grid-template-rows: auto minmax(0, 1fr) auto; }
          header { display: none !important; }
          .settings-launch { display: none !important; }
          .scene-pane > .pane-title,
          .scene-pane > .title-field { display: none !important; }
          .mobile-project-hero {
            display: grid;
            gap: 9px;
            position: relative;
            overflow: hidden;
            margin: 8px 14px 4px;
            padding: 13px 14px 12px;
            border: 1px solid rgba(232, 201, 213, .9);
            border-radius: 20px;
            background: linear-gradient(135deg, rgba(255,255,255,.9), rgba(255,242,248,.84));
            box-shadow: 0 7px 22px rgba(116, 91, 158, .08);
            backdrop-filter: blur(14px);
          }
          .mobile-project-hero::after {
            content: '♡  ✦';
            position: absolute;
            top: 9px;
            right: 13px;
            color: rgba(239, 111, 166, .35);
            font-size: 14px;
            letter-spacing: 3px;
            pointer-events: none;
          }
          .mobile-project-hero-label {
            color: #665069;
            font-size: 11px;
            font-weight: 900;
          }
          .mobile-project-hero-title {
            width: 100%;
            min-height: 44px;
            padding: 8px 10px;
            border: 1px solid #decbe0;
            border-radius: 14px;
            background: rgba(255,255,255,.9);
            color: #4f3c4c;
            font-size: 17px;
            font-weight: 900;
          }
          .mobile-project-hero-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            min-height: 28px;
          }
          .mobile-project-hero-status {
            display: inline-flex;
            align-items: center;
            min-height: 28px;
            padding: 5px 10px;
            border-radius: 999px;
            background: #e2f6e9;
            color: #2c6941;
            font-size: 11px;
            font-weight: 900;
          }
          .mobile-project-hero-status[data-kind="dirty"] { background: #fff0c9; color: #755108; }
          .mobile-project-hero-status[data-kind="waiting"] { background: #e9efff; color: #3f5489; }
          .mobile-project-hero-status[data-kind="error"] { background: #ffe5e8; color: #922a3d; }
          .mobile-project-hero-save {
            min-height: 30px;
            padding: 5px 11px;
            border: 0;
            border-radius: 999px;
            background: #76558f;
            color: white;
            font-size: 11px;
            font-weight: 900;
          }
          .mobile-project-hero-save[hidden] { display: none; }
          .mobile-project-preview { display: block; margin: 14px 0 10px; }
          .mobile-project-preview > button { width: 100%; min-height: 52px; font-size: 15px; }
          .publish-pane { display: none; }
          body[data-simple-view="scenes"] .publish-pane,
          body[data-simple-view="editor"] .publish-pane,
          body[data-simple-view="settings"] .publish-pane { display: none !important; }
          body[data-simple-view="publish"] .scene-pane,
          body[data-simple-view="publish"] .editor-pane,
          body[data-simple-view="publish"] .settings-pane { display: none !important; }
          body[data-simple-view="publish"] .publish-pane { display: block !important; }
          .pane { min-height: calc(100dvh - 154px); }
          .editor-footer {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 2px;
            position: sticky;
            bottom: 0;
            z-index: 40;
            padding: 7px 8px max(7px, env(safe-area-inset-bottom));
            border-top: 1px solid #eaddea;
            background: rgba(255, 250, 252, .96);
            backdrop-filter: blur(16px);
            box-shadow: 0 -8px 24px rgba(84, 57, 91, .08);
          }
          .editor-footer button {
            min-width: 0;
            min-height: 52px;
            display: grid;
            place-items: center;
            gap: 1px;
            padding: 4px 2px;
            border: 0;
            border-radius: 14px;
            background: transparent;
            color: #725f79;
            font-size: 10px;
            font-weight: 900;
          }
          .editor-footer button[data-selected="true"] {
            color: #7a4e8e;
            background: #f1e7f7;
          }
          .editor-footer .footer-icon { font-size: 20px; line-height: 1.1; }
          .publish-card {
            display: grid;
            gap: 12px;
            padding: 18px;
            border: 1px solid #eaddea;
            border-radius: 18px;
            background: rgba(255,255,255,.92);
          }
          .publish-card h2 { margin: 0; font-size: 20px; }
          .publish-card p { margin: 0; color: #756582; font-size: 13px; line-height: 1.65; }
          .publish-card button { width: 100%; min-height: 52px; }
        }
      `;
      document.head.appendChild(style);
    }

    if (!projectHero) {
      const hero = document.createElement('section');
      hero.className = 'mobile-project-hero';
      hero.setAttribute('aria-label', '作品情報');

      const label = document.createElement('div');
      label.className = 'mobile-project-hero-label';
      label.textContent = '作品タイトル';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'mobile-project-hero-title';
      titleInput.maxLength = storyTitle.maxLength;
      titleInput.setAttribute('aria-label', '作品タイトル');
      titleInput.addEventListener('input', () => {
        if (storyTitle.disabled) return;
        storyTitle.value = titleInput.value;
        storyTitle.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const actions = document.createElement('div');
      actions.className = 'mobile-project-hero-actions';
      const state = document.createElement('span');
      state.className = 'mobile-project-hero-status';
      state.textContent = '読み込み中';
      state.dataset.kind = 'waiting';
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'mobile-project-hero-save';
      save.textContent = '保存する';
      save.addEventListener('click', () => saveButton.click());
      actions.append(state, save);
      hero.append(label, titleInput, actions);
      app.insertBefore(hero, workspace);
      projectHero = hero;
      projectHeroTitle = titleInput;
      projectHeroStatus = state;
      projectHeroSave = save;
    }

    if (!previewProxy) {
      const scenePane = document.querySelector('.scene-pane');
      if (!(scenePane instanceof HTMLElement)) throw new Error('Simple UI requires .scene-pane');
      const wrapper = document.createElement('div');
      wrapper.className = 'mobile-project-preview';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ghost-button';
      button.textContent = '▷ ためし読み';
      button.addEventListener('click', () => previewButton.click());
      wrapper.appendChild(button);
      scenePane.appendChild(wrapper);
      previewProxy = button;
    }

    if (!document.querySelector('.publish-pane')) {
      const pane = document.createElement('aside');
      pane.className = 'pane publish-pane';
      const card = document.createElement('section');
      card.className = 'publish-card';
      const heading = document.createElement('h2');
      heading.textContent = '公開';
      const hint = document.createElement('p');
      hint.textContent = '作品画面の「ためし読み」で内容を確認すると公開できます。';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'primary';
      button.textContent = '公開する';
      button.addEventListener('click', () => publishButton.click());
      card.append(heading, hint, button);
      pane.appendChild(card);
      workspace.appendChild(pane);
      publishProxy = button;
      publishHint = hint;
    }

    if (!footerNav) {
      const nav = document.createElement('nav');
      nav.className = 'editor-footer';
      nav.setAttribute('aria-label', 'ノベルエディタ');
      const entries = [
        ['scenes', '📁', '作品'],
        ['editor', '✏️', 'シーン'],
        ['settings', '⚙️', '設定'],
        ['publish', '👑', '公開'],
      ];
      for (const [view, icon, label] of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.editorView = view;
        button.innerHTML = `<span class="footer-icon" aria-hidden="true">${icon}</span><span>${label}</span>`;
        button.addEventListener('click', () => setView(view));
        nav.appendChild(button);
      }
      app.appendChild(nav);
      footerNav = nav;
    }

    syncProjectHero();
    syncActionProxies();
    syncFooter(document.body.dataset.simpleView || 'scenes');
  }

  function setView(view) {
    if (!SIMPLE_VIEWS.includes(view)) throw new TypeError(`Unsupported simple UI view: ${view}`);
    document.body.dataset.simpleView = view;
    if (view === 'settings') settingsPane.scrollTop = 0;
    const publishPane = document.querySelector('.publish-pane');
    if (view === 'publish' && publishPane instanceof HTMLElement) publishPane.scrollTop = 0;
    syncFooter(view);
  }

  function syncFooter(view) {
    if (!(footerNav instanceof HTMLElement)) return;
    for (const button of footerNav.querySelectorAll('button[data-editor-view]')) {
      const selected = button.dataset.editorView === view;
      button.dataset.selected = selected ? 'true' : 'false';
      if (selected) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
  }

  function syncProjectHero() {
    if (!(projectHeroTitle instanceof HTMLInputElement) ||
        !(projectHeroStatus instanceof HTMLElement) ||
        !(projectHeroSave instanceof HTMLButtonElement)) return;

    if (document.activeElement !== projectHeroTitle && projectHeroTitle.value !== storyTitle.value) {
      projectHeroTitle.value = storyTitle.value;
    }
    projectHeroTitle.disabled = storyTitle.disabled;

    const kind = status.dataset.kind || 'waiting';
    let label = '保存済み';
    let displayKind = 'ok';
    if (kind === 'error') {
      label = 'エラー';
      displayKind = 'error';
    } else if (kind === 'dirty') {
      label = '未保存';
      displayKind = 'dirty';
    } else if (kind === 'waiting' || storyTitle.disabled) {
      label = '読み込み中';
      displayKind = 'waiting';
    }
    projectHeroStatus.textContent = label;
    projectHeroStatus.dataset.kind = displayKind;
    projectHeroSave.disabled = saveButton.disabled;
    projectHeroSave.hidden = saveButton.disabled;
  }

  function syncActionProxies() {
    if (previewProxy instanceof HTMLButtonElement) previewProxy.disabled = previewButton.disabled;
    if (publishProxy instanceof HTMLButtonElement) publishProxy.disabled = publishButton.disabled;
    if (publishHint instanceof HTMLElement) {
      publishHint.textContent = publishButton.disabled
        ? '作品画面の「ためし読み」で内容を確認すると公開できます。'
        : 'ためし読みで確認した内容を公開できます。';
    }
  }

  function decorateStatus() {
    const message = status.textContent.trim();
    if (!message || SHORT_STATUS_MESSAGES.has(message)) return;
    let short = null;
    if (message.includes('読み込みました')) short = '読み込みました';
    else if (message.includes('保存しました')) short = '保存しました';
    else if (message.includes('未保存') || message.includes('変更')) short = '変更があります';
    if (short === null) return;
    status.title = message;
    status.textContent = short;
  }

  function sceneId(button) {
    if (button.dataset.sceneId) return button.dataset.sceneId;
    const value = button.textContent.trim();
    if (!value) throw new Error('Scene button has no scene id');
    button.dataset.sceneId = value;
    return value;
  }

  function sceneDisplay(rawId, index) {
    const label = SAMPLE_SCENE_LABELS[rawId];
    return label ? `シーン ${index + 1}　${label}` : `シーン ${index + 1}`;
  }

  function sceneOptionDisplay(rawId, index) {
    return SAMPLE_SCENE_LABELS[rawId] || `シーン ${index + 1}`;
  }

  function translateSceneOptions(select) {
    if (!(select instanceof HTMLSelectElement)) {
      throw new TypeError('Scene select must be an HTMLSelectElement');
    }
    const sceneIds = Array.from(sceneList.querySelectorAll('.scene-button')).map(sceneId);
    for (const option of select.options) {
      const index = sceneIds.indexOf(option.value);
      if (index < 0) {
        throw new Error(`Scene select contains unknown scene id: ${option.value}`);
      }
      const display = sceneOptionDisplay(option.value, index);
      if (option.textContent !== display) option.textContent = display;
      option.dataset.sceneId = option.value;
    }
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
      const display = sceneDisplay(rawId, index);
      if (button.textContent !== display) button.textContent = display;
      if (button.title !== rawId) button.title = rawId;
      button.parentElement?.classList.add('scene-row');
      if (button.dataset.simpleUiBound !== '1') {
        button.dataset.simpleUiBound = '1';
        button.addEventListener('click', () => setView('editor'));
      }
    });

    translateSceneOptions(startSceneSelect);

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
    if (rawType === 'choice') {
      const targets = card.querySelectorAll('.choice-row select');
      if (targets.length === 0) {
        throw new Error('Choice event is missing scene target selects');
      }
      for (const target of targets) translateSceneOptions(target);
    } else if (rawType === 'goto') {
      const target = card.querySelector('label select');
      if (!(target instanceof HTMLSelectElement)) {
        throw new Error('Goto event is missing a scene target select');
      }
      translateSceneOptions(target);
    }
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
      const display = index >= 0
        ? `${sceneDisplay(rawId, index)}を編集`
        : 'シーンを編集';
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
    ensureMobileChrome();
    decorateScenes();
    decorateCharacters();
    decorateEvents();
    decorateDiagnostics();
    decorateStatus();
    syncProjectHero();
    syncActionProxies();
  }

  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(decorate);
  }

  openSettings.addEventListener('click', () => setView('settings'));
  closeSettings.addEventListener('click', () => setView('scenes'));
  sceneBack.addEventListener('click', () => setView('scenes'));
  storyTitle.addEventListener('input', syncProjectHero);
  document.body.dataset.simpleView = 'scenes';

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(sceneList, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  observer.observe(eventEditor, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  observer.observe(settingsPane, { childList: true, subtree: true });
  observer.observe(status, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-kind'] });
  observer.observe(storyTitle, { attributes: true, attributeFilter: ['disabled'] });
  observer.observe(saveButton, { attributes: true, attributeFilter: ['disabled'] });
  observer.observe(previewButton, { attributes: true, attributeFilter: ['disabled'] });
  observer.observe(publishButton, { attributes: true, attributeFilter: ['disabled'] });
  decorate();
})();