(function () {
  'use strict';

  const formatApi = window.MinAppNovelFormat;
  const core = window.MinAppNovelEditorCore;
  const assetTools = window.MinAppNovelAssetTools;
  if (!formatApi || typeof formatApi.validateStory !== 'function') {
    throw new Error('MinAppNovelFormat validator is not loaded');
  }
  if (!core || typeof core.validateProject !== 'function') {
    throw new Error('MinAppNovelEditorCore is not loaded');
  }
  if (!assetTools || typeof assetTools.descriptor !== 'function') {
    throw new Error('MinAppNovelAssetTools is not loaded');
  }

  function requiredElement(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Required element #${id} was not found`);
    }
    return element;
  }

  const els = {
    status: requiredElement('status'),
    revision: requiredElement('revision'),
    contentRevision: requiredElement('content-revision'),
    title: requiredElement('story-title'),
    startScene: requiredElement('start-scene'),
    sceneList: requiredElement('scene-list'),
    eventEditor: requiredElement('event-editor'),
    assetId: requiredElement('asset-id'),
    assetFile: requiredElement('asset-file'),
    assetSave: requiredElement('asset-save-button'),
    assetList: requiredElement('asset-list'),
    assetPreview: requiredElement('asset-preview'),
    validation: requiredElement('validation'),
    save: requiredElement('save-button'),
    preview: requiredElement('preview-button'),
    publish: requiredElement('publish-button'),
  };

  let initialized = false;
  let project = null;
  let workingDocument = null;
  let selectedSceneId = null;
  let previewedRevision = null;
  let dirty = false;
  let busy = false;
  let storageValid = false;
  let assetPreviewUrl = null;
  let characterPanel = null;
  let characterList = null;

  function authoringApi() {
    const minapp = window.minapp;
    if (!minapp || minapp.version !== 1 || !minapp.authoring) return null;
    const api = minapp.authoring;
    if (
      typeof api.load !== 'function' ||
      typeof api.save !== 'function' ||
      typeof api.getAsset !== 'function' ||
      typeof api.saveAsset !== 'function' ||
      typeof api.deleteAsset !== 'function' ||
      typeof api.preview !== 'function' ||
      typeof api.publish !== 'function'
    ) {
      throw Object.assign(
        new Error('minapp.authoring load/save/assets/preview/publish are required'),
        { code: 'authoring_bridge_incomplete' },
      );
    }
    return api;
  }

  function requiredAuthoringApi() {
    const api = authoringApi();
    if (!api) {
      throw Object.assign(new Error('Authoring bridge is unavailable'), {
        code: 'authoring_unavailable',
      });
    }
    return api;
  }

  function setStatus(message, kind) {
    els.status.textContent = message;
    els.status.dataset.kind = kind || 'info';
  }

  function setBusy(value) {
    busy = value;
    els.save.disabled = value || !project || !dirty;
    els.preview.disabled = value || !project || !workingDocument || dirty || !storageValid;
    els.publish.disabled =
      value ||
      !project ||
      !workingDocument ||
      dirty ||
      !storageValid ||
      previewedRevision !== project.draftRevision;
    els.title.disabled = value || !project || !workingDocument;
    els.startScene.disabled = value || !project || !workingDocument;
    els.assetId.disabled = value || !project || !workingDocument;
    els.assetFile.disabled = value || !project || !workingDocument;
    els.assetSave.disabled = value || !project || !workingDocument || dirty;

    for (const control of document.querySelectorAll('[data-editor-control="true"]')) {
      if (!(control instanceof HTMLButtonElement || control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)) {
        continue;
      }
      if (value) {
        if (!Object.prototype.hasOwnProperty.call(control.dataset, 'editorWasDisabled')) {
          control.dataset.editorWasDisabled = control.disabled ? '1' : '0';
        }
        control.disabled = true;
      } else if (Object.prototype.hasOwnProperty.call(control.dataset, 'editorWasDisabled')) {
        control.disabled = control.dataset.editorWasDisabled === '1';
        delete control.dataset.editorWasDisabled;
      }
    }
  }

  function markEditorControl(element) {
    element.dataset.editorControl = 'true';
    return element;
  }

  function markDirty() {
    if (!project || !workingDocument || busy) return;
    dirty = true;
    previewedRevision = null;
    validateWorkingDocument();
    setBusy(false);
    setStatus('未保存の変更があります', 'dirty');
  }

  function formatError(error) {
    const code = error && error.code ? error.code : 'editor_error';
    const message = error && error.message ? error.message : String(error);
    return `${code}: ${message}`;
  }

  function assertEditableNow() {
    if (busy) {
      throw Object.assign(new Error('別のAuthoring処理が進行中です'), {
        code: 'editor_busy',
      });
    }
    if (!project || !workingDocument) {
      throw Object.assign(new Error('Authoring Project is not loaded'), {
        code: 'authoring_project_not_loaded',
      });
    }
  }

  function handleUiError(error) {
    setBusy(false);
    setStatus(formatError(error), 'error');
    console.error(error);
  }

  function runMutation(makeNext, message, nextSelectedSceneId) {
    try {
      assertEditableNow();
      const nextDocument = makeNext();
      formatApi.validateStory(nextDocument);
      workingDocument = nextDocument;
      if (nextSelectedSceneId !== undefined) {
        selectedSceneId = nextSelectedSceneId;
      } else if (!workingDocument.scenes[selectedSceneId]) {
        selectedSceneId = workingDocument.start_scene;
      }
      dirty = true;
      previewedRevision = null;
      renderProject();
      setStatus(message, 'dirty');
    } catch (error) {
      handleUiError(error);
    }
  }

  function assertOperationalDocument() {
    formatApi.validateStory(workingDocument);
    assetTools.validateServerAssets(project.assets);
    const missing = assetTools.missingStoredPaths(workingDocument, project.assets);
    if (missing.length > 0) {
      throw Object.assign(
        new Error(`Novel documentが未保存の素材を参照しています: ${missing.join(', ')}`),
        { code: 'asset_not_stored' },
      );
    }
  }

  function validateWorkingDocument() {
    try {
      assertOperationalDocument();
      storageValid = true;
      els.validation.textContent = '✓ minapp/novel@1 と素材保存状態が有効';
      els.validation.dataset.kind = 'ok';
      return true;
    } catch (error) {
      storageValid = false;
      els.validation.textContent = formatError(error);
      els.validation.dataset.kind = 'error';
      return false;
    }
  }

  function acceptDraftMutation(response, expectedRevision) {
    const nextRevision = core.validateSaveResponse(
      response,
      expectedRevision,
      project.contentId,
    );
    assetTools.validateServerAssets(response.assets);
    project.draftRevision = nextRevision;
    project.assets = core.deepClone(response.assets);
    previewedRevision = null;
    return nextRevision;
  }

  function makeButton(text, className, onClick) {
    const button = markEditorControl(document.createElement('button'));
    button.type = 'button';
    button.className = className || 'mini-button';
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  function makeSelect(entries, currentValue, ariaLabel, options) {
    const opts = options || {};
    const select = markEditorControl(document.createElement('select'));
    select.setAttribute('aria-label', ariaLabel);
    if (opts.emptyLabel !== undefined) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = opts.emptyLabel;
      empty.selected = currentValue === '' || currentValue === undefined;
      select.appendChild(empty);
    }
    for (const entry of entries) {
      const option = document.createElement('option');
      option.value = typeof entry === 'string' ? entry : entry.value;
      option.textContent = typeof entry === 'string' ? entry : entry.label;
      option.selected = option.value === currentValue;
      select.appendChild(option);
    }
    if (entries.length === 0 && opts.emptyLabel === undefined) select.disabled = true;
    return select;
  }

  function assetIds(kind) {
    if (!workingDocument) return [];
    return Object.entries(workingDocument.assets)
      .filter(([, asset]) => asset.kind === kind)
      .map(([assetId]) => assetId);
  }

  function sceneIds() {
    return workingDocument ? Object.keys(workingDocument.scenes) : [];
  }

  function characterIds() {
    return workingDocument ? Object.keys(workingDocument.characters) : [];
  }

  function ensureAuxiliaryPanels() {
    if (characterPanel) return;
    const leftPane = els.sceneList.closest('.pane');
    if (!(leftPane instanceof HTMLElement)) {
      throw new Error('Scene pane was not found');
    }
    characterPanel = document.createElement('section');
    characterPanel.className = 'side-card';
    const heading = document.createElement('h3');
    heading.textContent = 'キャラクター';
    const note = document.createElement('p');
    note.textContent = 'キャラID・表情IDはstable IDです。作成後は名前・表情素材を編集できます。';
    characterList = document.createElement('div');
    characterList.id = 'character-list';
    characterPanel.append(heading, note, characterList);
    els.sceneList.insertAdjacentElement('afterend', characterPanel);

    for (const card of document.querySelectorAll('.side-card')) {
      const cardHeading = card.querySelector('h3');
      if (cardHeading && cardHeading.textContent === 'v1 Editorの安全範囲') {
        const paragraph = card.querySelector('p');
        if (paragraph) {
          paragraph.textContent = 'キャラ＋表情、シーン作成、イベント追加・削除・並べ替え、speaker / goto / 立ち絵event編集までEditorから行えます。stable IDそのものは編集しません。';
        }
      }
    }
  }

  function renderProject() {
    ensureAuxiliaryPanels();
    els.revision.textContent = `Draft r${project.draftRevision}`;
    els.contentRevision.textContent = `Save compatibility ${workingDocument.content_revision}`;
    els.title.value = workingDocument.title;

    els.startScene.replaceChildren();
    for (const sceneId of sceneIds()) {
      const option = document.createElement('option');
      option.value = sceneId;
      option.textContent = sceneId;
      option.selected = sceneId === workingDocument.start_scene;
      els.startScene.appendChild(option);
    }

    if (!selectedSceneId || !workingDocument.scenes[selectedSceneId]) {
      selectedSceneId = workingDocument.start_scene;
    }
    renderSceneList();
    renderCharacters();
    renderSelectedScene();
    renderAssets();
    validateWorkingDocument();
    setBusy(false);
  }

  function renderSceneList() {
    els.sceneList.replaceChildren();
    for (const sceneId of sceneIds()) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '6px';
      row.style.alignItems = 'center';
      row.style.marginBottom = '7px';

      const button = markEditorControl(document.createElement('button'));
      button.type = 'button';
      button.className = 'scene-button';
      button.dataset.selected = String(sceneId === selectedSceneId);
      button.textContent = sceneId;
      button.addEventListener('click', () => {
        if (busy) return;
        selectedSceneId = sceneId;
        renderSceneList();
        renderSelectedScene();
      });

      const remove = makeButton('削除', 'mini-button danger', () => {
        runMutation(
          () => core.removeScene(workingDocument, sceneId, formatApi.validateStory),
          `シーン ${sceneId} を削除しました。保存してください`,
        );
      });
      row.append(button, remove);
      els.sceneList.appendChild(row);
    }

    const form = document.createElement('div');
    form.className = 'asset-form';
    const input = markEditorControl(document.createElement('input'));
    input.type = 'text';
    input.maxLength = 64;
    input.placeholder = 'scene_002';
    input.setAttribute('aria-label', '新しいシーンID');
    const add = makeButton('＋ シーン追加', 'secondary', () => {
      const sceneId = input.value.trim();
      runMutation(
        () => core.addScene(workingDocument, sceneId, formatApi.validateStory),
        `シーン ${sceneId} を追加しました。保存してください`,
        sceneId,
      );
    });
    form.append(input, add);
    els.sceneList.appendChild(form);
  }

  function renderCharacters() {
    characterList.replaceChildren();
    const images = assetIds('image');
    const characters = Object.entries(workingDocument.characters);

    if (characters.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'キャラクターはまだいません';
      characterList.appendChild(empty);
    }

    for (const [characterId, character] of characters) {
      const card = document.createElement('div');
      card.className = 'asset-row';
      const heading = document.createElement('div');
      heading.className = 'event-heading';
      const id = document.createElement('strong');
      id.textContent = characterId;
      const removeCharacter = makeButton('キャラ削除', 'mini-button danger', () => {
        runMutation(
          () => core.removeCharacter(workingDocument, characterId, formatApi.validateStory),
          `キャラクター ${characterId} を削除しました。保存してください`,
        );
      });
      heading.append(id, removeCharacter);
      card.appendChild(heading);

      const nameLabel = document.createElement('label');
      nameLabel.textContent = '表示名';
      const nameInput = markEditorControl(document.createElement('input'));
      nameInput.type = 'text';
      nameInput.maxLength = 40;
      nameInput.value = character.name;
      nameInput.addEventListener('input', () => {
        if (busy) return;
        character.name = nameInput.value;
        markDirty();
      });
      nameLabel.appendChild(nameInput);
      card.appendChild(nameLabel);

      const expressionHeading = document.createElement('strong');
      expressionHeading.textContent = '表情';
      card.appendChild(expressionHeading);
      for (const [expressionId, assetId] of Object.entries(character.expressions)) {
        const row = document.createElement('div');
        row.className = 'choice-row';
        const label = document.createElement('code');
        label.textContent = expressionId;
        const select = makeSelect(images, assetId, `${characterId}.${expressionId} の画像素材`);
        select.addEventListener('change', () => {
          runMutation(
            () => core.setCharacterExpression(
              workingDocument,
              characterId,
              expressionId,
              select.value,
              formatApi.validateStory,
            ),
            `${characterId}.${expressionId} の画像を変更しました。保存してください`,
          );
        });
        const remove = makeButton('削除', 'mini-button danger', () => {
          runMutation(
            () => core.removeCharacterExpression(
              workingDocument,
              characterId,
              expressionId,
              formatApi.validateStory,
            ),
            `${characterId}.${expressionId} を削除しました。保存してください`,
          );
        });
        row.append(label, select, remove);
        card.appendChild(row);
      }

      const addExpression = document.createElement('div');
      addExpression.className = 'asset-form';
      const expressionIdInput = markEditorControl(document.createElement('input'));
      expressionIdInput.type = 'text';
      expressionIdInput.maxLength = 64;
      expressionIdInput.placeholder = 'smile';
      expressionIdInput.setAttribute('aria-label', `${characterId} の新しい表情ID`);
      const imageSelect = makeSelect(images, images[0], `${characterId} の新しい表情画像`);
      const addExpressionButton = makeButton('＋ 表情追加', 'mini-button', () => {
        const expressionId = expressionIdInput.value.trim();
        runMutation(
          () => core.addCharacterExpression(
            workingDocument,
            characterId,
            expressionId,
            imageSelect.value,
            formatApi.validateStory,
          ),
          `${characterId}.${expressionId} を追加しました。保存してください`,
        );
      });
      addExpressionButton.disabled = images.length === 0;
      addExpression.append(expressionIdInput, imageSelect, addExpressionButton);
      card.appendChild(addExpression);
      characterList.appendChild(card);
    }

    const create = document.createElement('div');
    create.className = 'asset-form';
    const title = document.createElement('strong');
    title.textContent = '新しいキャラクター';
    const idInput = markEditorControl(document.createElement('input'));
    idInput.type = 'text';
    idInput.maxLength = 64;
    idInput.placeholder = 'akari';
    idInput.setAttribute('aria-label', '新しいキャラクターID');
    const nameInput = markEditorControl(document.createElement('input'));
    nameInput.type = 'text';
    nameInput.maxLength = 40;
    nameInput.placeholder = 'あかり';
    nameInput.setAttribute('aria-label', '新しいキャラクター名');
    const expressionInput = markEditorControl(document.createElement('input'));
    expressionInput.type = 'text';
    expressionInput.maxLength = 64;
    expressionInput.placeholder = 'normal';
    expressionInput.setAttribute('aria-label', '最初の表情ID');
    const imageSelect = makeSelect(images, images[0], '最初の表情画像');
    const add = makeButton('＋ キャラ追加', 'secondary', () => {
      const characterId = idInput.value.trim();
      runMutation(
        () => core.addCharacter(
          workingDocument,
          characterId,
          nameInput.value,
          expressionInput.value.trim(),
          imageSelect.value,
          formatApi.validateStory,
        ),
        `キャラクター ${characterId} を追加しました。保存してください`,
      );
    });
    add.disabled = images.length === 0;
    const help = document.createElement('p');
    help.textContent = images.length === 0
      ? '先に画像素材を追加してください。'
      : '最初の表情を1つ指定して作成します。';
    create.append(title, idInput, nameInput, expressionInput, imageSelect, add, help);
    characterList.appendChild(create);
  }

  function assetSelect(currentAssetId, kind, label, onChange) {
    const select = makeSelect(assetIds(kind), currentAssetId, label);
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function sceneSelect(currentSceneId, label, onChange) {
    const select = makeSelect(sceneIds(), currentSceneId, label);
    select.addEventListener('change', () => onChange(select.value));
    return select;
  }

  function eventHeading(card, event) {
    const heading = document.createElement('div');
    heading.className = 'event-heading';
    const identity = document.createElement('div');
    identity.style.display = 'flex';
    identity.style.gap = '8px';
    identity.style.alignItems = 'center';
    const type = document.createElement('strong');
    type.textContent = event.type;
    const id = document.createElement('code');
    id.textContent = event.id;
    identity.append(type, id);

    const actions = document.createElement('div');
    actions.className = 'asset-actions';
    const up = makeButton('↑', 'mini-button', () => {
      runMutation(
        () => core.moveEvent(workingDocument, selectedSceneId, event.id, -1, formatApi.validateStory),
        `${event.id} を上へ移動しました。保存してください`,
      );
    });
    const down = makeButton('↓', 'mini-button', () => {
      runMutation(
        () => core.moveEvent(workingDocument, selectedSceneId, event.id, 1, formatApi.validateStory),
        `${event.id} を下へ移動しました。保存してください`,
      );
    });
    const remove = makeButton('削除', 'mini-button danger', () => {
      runMutation(
        () => core.removeEvent(workingDocument, selectedSceneId, event.id, formatApi.validateStory),
        `${event.id} を削除しました。保存してください`,
      );
    });
    actions.append(up, down, remove);
    heading.append(identity, actions);
    card.appendChild(heading);
  }

  function renderCharacterEvent(card, event) {
    const actionLabel = document.createElement('label');
    actionLabel.textContent = 'action';
    const action = makeSelect(['show', 'hide'], event.action, `${event.id} のcharacter action`);
    action.addEventListener('change', () => {
      runMutation(
        () => core.setCharacterEventAction(
          workingDocument,
          selectedSceneId,
          event.id,
          action.value,
          formatApi.validateStory,
        ),
        `${event.id} のactionを ${action.value} にしました。保存してください`,
      );
    });
    actionLabel.appendChild(action);
    card.appendChild(actionLabel);

    const slotLabel = document.createElement('label');
    slotLabel.textContent = 'slot';
    const slot = makeSelect(['left', 'center', 'right'], event.slot, `${event.id} のslot`);
    slot.addEventListener('change', () => {
      event.slot = slot.value;
      markDirty();
    });
    slotLabel.appendChild(slot);
    card.appendChild(slotLabel);

    if (event.action === 'hide') return;
    const characters = characterIds();
    const characterLabel = document.createElement('label');
    characterLabel.textContent = 'character';
    const character = makeSelect(characters, event.character, `${event.id} のcharacter`);
    character.addEventListener('change', () => {
      const selected = workingDocument.characters[character.value];
      if (!selected) {
        handleUiError(Object.assign(new Error(`character ${character.value} がありません`), { code: 'character_not_found' }));
        return;
      }
      event.character = character.value;
      event.expression = Object.keys(selected.expressions)[0];
      markDirty();
      renderSelectedScene();
    });
    characterLabel.appendChild(character);
    card.appendChild(characterLabel);

    const expressionLabel = document.createElement('label');
    expressionLabel.textContent = 'expression';
    const expressionIds = Object.keys(workingDocument.characters[event.character].expressions);
    const expression = makeSelect(expressionIds, event.expression, `${event.id} のexpression`);
    expression.addEventListener('change', () => {
      event.expression = expression.value;
      markDirty();
    });
    expressionLabel.appendChild(expression);
    card.appendChild(expressionLabel);
  }

  function renderBgmEvent(card, event) {
    const actionLabel = document.createElement('label');
    actionLabel.textContent = 'action';
    const action = makeSelect(['play', 'stop'], event.action, `${event.id} のBGM action`);
    action.addEventListener('change', () => {
      runMutation(
        () => core.setBgmEventAction(
          workingDocument,
          selectedSceneId,
          event.id,
          action.value,
          formatApi.validateStory,
        ),
        `${event.id} のBGM actionを ${action.value} にしました。保存してください`,
      );
    });
    actionLabel.appendChild(action);
    card.appendChild(actionLabel);
    if (event.action === 'stop') return;

    card.appendChild(
      assetSelect(event.asset, 'audio', `${event.id} のBGM素材`, (value) => {
        event.asset = value;
        markDirty();
      }),
    );
    const loopLabel = document.createElement('label');
    loopLabel.className = 'inline-check';
    const checkbox = markEditorControl(document.createElement('input'));
    checkbox.type = 'checkbox';
    checkbox.checked = event.loop === true;
    checkbox.addEventListener('change', () => {
      event.loop = checkbox.checked;
      markDirty();
    });
    loopLabel.append(checkbox, document.createTextNode('ループ'));
    card.appendChild(loopLabel);
  }

  function eventCard(event) {
    const card = document.createElement('section');
    card.className = 'event-card';
    eventHeading(card, event);

    if (event.type === 'background') {
      card.appendChild(
        assetSelect(event.asset, 'image', `${event.id} の背景素材`, (value) => {
          event.asset = value;
          markDirty();
        }),
      );
      return card;
    }

    if (event.type === 'character') {
      renderCharacterEvent(card, event);
      return card;
    }

    if (event.type === 'dialogue') {
      const speakerLabel = document.createElement('label');
      speakerLabel.textContent = 'speaker';
      const speaker = makeSelect(
        characterIds(),
        event.speaker || '',
        `${event.id} のspeaker`,
        { emptyLabel: 'ナレーション（speakerなし）' },
      );
      speaker.addEventListener('change', () => {
        if (speaker.value === '') delete event.speaker;
        else event.speaker = speaker.value;
        markDirty();
      });
      speakerLabel.appendChild(speaker);
      card.appendChild(speakerLabel);

      const textarea = markEditorControl(document.createElement('textarea'));
      textarea.rows = 4;
      textarea.value = event.text;
      textarea.setAttribute('aria-label', `${event.id} のセリフ`);
      textarea.addEventListener('input', () => {
        event.text = textarea.value;
        markDirty();
      });
      card.appendChild(textarea);
      return card;
    }

    if (event.type === 'choice') {
      for (const option of event.options) {
        const row = document.createElement('div');
        row.className = 'choice-row';
        const input = markEditorControl(document.createElement('input'));
        input.type = 'text';
        input.value = option.label;
        input.maxLength = 200;
        input.setAttribute('aria-label', `${option.id} の選択肢ラベル`);
        input.addEventListener('input', () => {
          option.label = input.value;
          markDirty();
        });
        const target = sceneSelect(option.goto, `${option.id} のgoto`, (value) => {
          option.goto = value;
          markDirty();
        });
        const remove = makeButton('削除', 'mini-button danger', () => {
          runMutation(
            () => core.removeChoiceOption(
              workingDocument,
              selectedSceneId,
              event.id,
              option.id,
              formatApi.validateStory,
            ),
            `${event.id}/${option.id} を削除しました。保存してください`,
          );
        });
        const id = document.createElement('code');
        id.textContent = option.id;
        row.append(input, target, remove, id);
        card.appendChild(row);
      }
      const addOption = makeButton('＋ 選択肢追加', 'mini-button', () => {
        runMutation(
          () => core.addChoiceOption(
            workingDocument,
            selectedSceneId,
            event.id,
            formatApi.validateStory,
          ),
          `${event.id} に選択肢を追加しました。保存してください`,
        );
      });
      card.appendChild(addOption);
      return card;
    }

    if (event.type === 'goto') {
      const label = document.createElement('label');
      label.textContent = 'goto';
      const target = sceneSelect(event.goto, `${event.id} のgoto`, (value) => {
        event.goto = value;
        markDirty();
      });
      label.appendChild(target);
      card.appendChild(label);
      return card;
    }

    if (event.type === 'bgm') {
      renderBgmEvent(card, event);
      return card;
    }

    if (event.type === 'se') {
      card.appendChild(
        assetSelect(event.asset, 'audio', `${event.id} のSE素材`, (value) => {
          event.asset = value;
          markDirty();
        }),
      );
      return card;
    }

    if (event.type === 'end') {
      const input = markEditorControl(document.createElement('input'));
      input.type = 'text';
      input.value = event.label || '';
      input.maxLength = 100;
      input.placeholder = 'END';
      input.setAttribute('aria-label', `${event.id} のENDラベル`);
      input.addEventListener('input', () => {
        if (input.value === '') delete event.label;
        else event.label = input.value;
        markDirty();
      });
      card.appendChild(input);
      return card;
    }

    throw new Error(`Unsupported event type in Editor: ${event.type}`);
  }

  function renderSelectedScene() {
    els.eventEditor.replaceChildren();
    const scene = workingDocument.scenes[selectedSceneId];
    if (!scene) {
      throw new Error(`Selected scene ${selectedSceneId} was not found`);
    }
    const heading = document.createElement('div');
    heading.className = 'scene-heading';
    const title = document.createElement('h2');
    title.textContent = selectedSceneId;
    const note = document.createElement('span');
    note.textContent = 'stable IDは編集しません';
    heading.append(title, note);
    els.eventEditor.appendChild(heading);
    for (const event of scene.events) {
      els.eventEditor.appendChild(eventCard(event));
    }

    const addCard = document.createElement('section');
    addCard.className = 'event-card';
    const label = document.createElement('label');
    label.textContent = 'イベントを追加';
    const eventType = makeSelect(
      ['dialogue', 'background', 'character', 'choice', 'goto', 'bgm', 'se', 'end'],
      'dialogue',
      '追加するイベント種別',
    );
    label.appendChild(eventType);
    const add = makeButton('＋ イベント追加', 'secondary', () => {
      runMutation(
        () => core.addEvent(
          workingDocument,
          selectedSceneId,
          eventType.value,
          formatApi.validateStory,
        ),
        `${eventType.value} eventを追加しました。保存してください`,
      );
    });
    const help = document.createElement('p');
    help.textContent = '新しいイベントは末尾のchoice / goto / endの直前へ追加します。終端を変える場合は新しい終端eventを追加→並べ替え→古い終端を削除します。';
    addCard.append(label, add, help);
    els.eventEditor.appendChild(addCard);
  }

  function clearAssetPreview() {
    if (assetPreviewUrl) {
      URL.revokeObjectURL(assetPreviewUrl);
      assetPreviewUrl = null;
    }
    els.assetPreview.replaceChildren();
  }

  async function previewAsset(assetId) {
    const descriptor = workingDocument.assets[assetId];
    if (!descriptor) {
      throw Object.assign(new Error(`素材 ${assetId} がありません`), {
        code: 'asset_not_found',
      });
    }
    const result = await requiredAuthoringApi().getAsset(descriptor.src);
    if (
      !result ||
      !(result.bytes instanceof Uint8Array) ||
      result.contentType !== descriptor.mime
    ) {
      throw Object.assign(new Error('素材取得結果がNovel documentと一致しません'), {
        code: 'asset_response_mismatch',
      });
    }
    clearAssetPreview();
    assetPreviewUrl = URL.createObjectURL(
      new Blob([result.bytes], { type: result.contentType }),
    );
    const label = document.createElement('strong');
    label.textContent = assetId;
    els.assetPreview.appendChild(label);
    if (descriptor.kind === 'image') {
      const image = document.createElement('img');
      image.src = assetPreviewUrl;
      image.alt = descriptor.alt || assetId;
      els.assetPreview.appendChild(image);
    } else {
      const audio = document.createElement('audio');
      audio.src = assetPreviewUrl;
      audio.controls = true;
      els.assetPreview.appendChild(audio);
    }
  }

  async function deleteOrphanAsset(path) {
    if (dirty) {
      throw Object.assign(new Error('素材整理前に変更を保存してください'), {
        code: 'unsaved_changes',
      });
    }
    if (Object.values(workingDocument.assets).some((asset) => asset.src === path)) {
      throw Object.assign(new Error('この素材pathはNovel documentから参照されています'), {
        code: 'asset_in_use',
      });
    }
    const api = requiredAuthoringApi();
    const expectedRevision = project.draftRevision;
    setBusy(true);
    setStatus(`未参照素材 ${path} を削除しています…`);
    const response = await api.deleteAsset(path, { expectedRevision });
    acceptDraftMutation(response, expectedRevision);
    renderProject();
    setStatus(`未参照素材 ${path} を削除しました`, 'ok');
  }

  async function deleteLogicalAsset(assetId) {
    if (dirty) {
      throw Object.assign(new Error('素材削除前に変更を保存してください'), {
        code: 'unsaved_changes',
      });
    }
    const descriptor = workingDocument.assets[assetId];
    if (!descriptor) {
      throw Object.assign(new Error(`素材 ${assetId} がありません`), {
        code: 'asset_not_found',
      });
    }
    const refs = assetTools.references(workingDocument, assetId);
    if (refs.length > 0) {
      throw Object.assign(new Error(`素材 ${assetId} は使用中です: ${refs.join(', ')}`), {
        code: 'asset_in_use',
      });
    }

    const api = requiredAuthoringApi();
    const nextDocument = core.deepClone(workingDocument);
    delete nextDocument.assets[assetId];
    formatApi.validateStory(nextDocument);
    setBusy(true);
    setStatus(`素材 ${assetId} を削除しています…`);

    let expectedRevision = project.draftRevision;
    const saveResponse = await api.save(nextDocument, { expectedRevision });
    acceptDraftMutation(saveResponse, expectedRevision);
    workingDocument = core.deepClone(nextDocument);
    dirty = false;

    const pathStillUsed = Object.values(workingDocument.assets).some(
      (asset) => asset.src === descriptor.src,
    );
    if (!pathStillUsed && assetTools.serverAssetByPath(project.assets, descriptor.src)) {
      try {
        expectedRevision = project.draftRevision;
        const deleteResponse = await api.deleteAsset(descriptor.src, { expectedRevision });
        acceptDraftMutation(deleteResponse, expectedRevision);
      } catch (error) {
        renderProject();
        throw error;
      }
    }
    renderProject();
    setStatus(`素材 ${assetId} を削除しました`, 'ok');
  }

  async function saveAssetFromForm() {
    if (dirty) {
      throw Object.assign(new Error('素材追加・差し替え前に変更を保存してください'), {
        code: 'unsaved_changes',
      });
    }
    const file = els.assetFile.files && els.assetFile.files[0];
    if (!file) {
      throw Object.assign(new Error('素材ファイルを選んでください'), {
        code: 'asset_file_required',
      });
    }
    const assetId = assetTools.requireAssetId(els.assetId.value.trim());
    const previous = workingDocument.assets[assetId] || null;
    const descriptor = assetTools.descriptor(assetId, file.name, previous);
    const nextDocument = core.deepClone(workingDocument);
    nextDocument.assets[assetId] = descriptor;
    formatApi.validateStory(nextDocument);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length === 0) {
      throw Object.assign(new Error('空の素材ファイルは保存できません'), {
        code: 'empty_asset',
      });
    }

    const api = requiredAuthoringApi();
    setBusy(true);
    setStatus(`素材 ${assetId} を保存しています…`);
    let expectedRevision = project.draftRevision;
    const assetResponse = await api.saveAsset(descriptor.src, bytes, {
      expectedRevision,
    });
    acceptDraftMutation(assetResponse, expectedRevision);

    try {
      expectedRevision = project.draftRevision;
      const documentResponse = await api.save(nextDocument, { expectedRevision });
      acceptDraftMutation(documentResponse, expectedRevision);
      workingDocument = core.deepClone(nextDocument);
      dirty = false;
    } catch (error) {
      renderProject();
      throw error;
    }

    if (
      previous &&
      previous.src !== descriptor.src &&
      !assetTools.pathUsedByOtherDescriptor(workingDocument, assetId, previous.src) &&
      assetTools.serverAssetByPath(project.assets, previous.src)
    ) {
      try {
        expectedRevision = project.draftRevision;
        const cleanupResponse = await api.deleteAsset(previous.src, {
          expectedRevision,
        });
        acceptDraftMutation(cleanupResponse, expectedRevision);
      } catch (error) {
        renderProject();
        throw error;
      }
    }

    els.assetId.value = '';
    els.assetFile.value = '';
    renderProject();
    setStatus(`素材 ${assetId} をDraftへ反映しました`, 'ok');
  }

  function renderAssets() {
    clearAssetPreview();
    els.assetList.replaceChildren();
    assetTools.validateServerAssets(project.assets);
    const logicalEntries = Object.entries(workingDocument.assets);
    const referencedPaths = new Set(logicalEntries.map(([, asset]) => asset.src));
    if (logicalEntries.length === 0 && project.assets.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = '素材はまだありません';
      els.assetList.appendChild(empty);
      return;
    }

    for (const [assetId, asset] of logicalEntries) {
      const row = document.createElement('div');
      row.className = 'asset-row';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = assetId;
      const meta = document.createElement('code');
      const stored = assetTools.serverAssetByPath(project.assets, asset.src);
      meta.textContent = `${asset.kind} · ${asset.src} · ${asset.mime}${
        stored ? ` · ${stored.bytes} bytes` : ' · server未保存'
      }`;
      info.append(title, meta);

      const actions = document.createElement('div');
      actions.className = 'asset-actions';
      const preview = makeButton('確認', 'mini-button', async () => {
        try {
          await previewAsset(assetId);
        } catch (error) {
          handleUiError(error);
        }
      });
      preview.disabled = !stored || busy;

      const replace = makeButton('差し替え', 'mini-button', () => {
        els.assetId.value = assetId;
        els.assetFile.click();
      });
      replace.disabled = busy || dirty;

      const remove = makeButton('削除', 'mini-button danger', async () => {
        try {
          await deleteLogicalAsset(assetId);
        } catch (error) {
          handleUiError(error);
        }
      });
      remove.disabled = busy || dirty;
      actions.append(preview, replace, remove);
      row.append(info, actions);
      els.assetList.appendChild(row);
    }

    for (const serverAsset of project.assets) {
      if (referencedPaths.has(serverAsset.path)) continue;
      const row = document.createElement('div');
      row.className = 'asset-row orphan';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = '未参照素材';
      const meta = document.createElement('code');
      meta.textContent = `${serverAsset.path} · ${serverAsset.bytes} bytes`;
      info.append(title, meta);
      const remove = makeButton('整理', 'mini-button danger', async () => {
        try {
          await deleteOrphanAsset(serverAsset.path);
        } catch (error) {
          handleUiError(error);
        }
      });
      remove.disabled = busy || dirty;
      row.append(info, remove);
      els.assetList.appendChild(row);
    }
  }

  async function initializeEmptyProject(api) {
    const initialDocument = core.createInitialDocument();
    formatApi.validateStory(initialDocument);
    const expectedRevision = project.draftRevision;
    setStatus('新しい作品を初期化しています…');
    const response = await api.save(initialDocument, { expectedRevision });
    acceptDraftMutation(response, expectedRevision);
    project.document = core.deepClone(initialDocument);
    project.needsInitialization = false;
    workingDocument = core.deepClone(initialDocument);
    selectedSceneId = workingDocument.start_scene;
    dirty = false;
    renderProject();
    setStatus(`新しい作品を Draft r${project.draftRevision} として初期化しました`, 'ok');
  }

  async function loadProject() {
    const api = authoringApi();
    if (!api) return false;
    setBusy(true);
    setStatus('作品を読み込んでいます…');
    const payload = await api.load();
    project = core.validateProject(payload, formatApi.validateStory);
    assetTools.validateServerAssets(project.assets);
    if (project.needsInitialization) {
      await initializeEmptyProject(api);
      return true;
    }
    workingDocument = core.deepClone(project.document);
    selectedSceneId = workingDocument.start_scene;
    previewedRevision = null;
    dirty = false;
    renderProject();
    setStatus('読み込みました。公開前にPreviewしてください', 'ok');
    return true;
  }

  async function saveProject() {
    if (!project || !workingDocument) {
      throw Object.assign(new Error('Authoring Project is not loaded'), {
        code: 'authoring_project_not_loaded',
      });
    }
    if (!dirty) return;
    const api = requiredAuthoringApi();
    setBusy(true);
    setStatus('保存しています…');
    const expectedRevision = project.draftRevision;
    const documentToSave = core.prepareDocumentSave(
      workingDocument,
      formatApi.validateStory,
    );
    const response = await api.save(documentToSave, { expectedRevision });
    acceptDraftMutation(response, expectedRevision);
    workingDocument = core.deepClone(documentToSave);
    dirty = false;
    renderProject();
    setStatus(`Draft r${project.draftRevision} を保存しました。公開前にPreviewしてください`, 'ok');
  }

  async function previewProject() {
    if (!project || !workingDocument) {
      throw Object.assign(new Error('Authoring Project is not loaded'), {
        code: 'authoring_project_not_loaded',
      });
    }
    if (dirty) {
      throw Object.assign(new Error('Preview前に変更を保存してください'), {
        code: 'unsaved_changes',
      });
    }
    assertOperationalDocument();
    const api = requiredAuthoringApi();
    setBusy(true);
    setStatus('Previewを開いています…');
    const expectedRevision = project.draftRevision;
    const response = await api.preview({ expectedRevision });
    const playerAppId = core.validatePreviewResponse(response, expectedRevision);
    if (playerAppId === null) {
      previewedRevision = null;
      setBusy(false);
      setStatus('Previewをキャンセルしました', 'waiting');
      return;
    }
    previewedRevision = expectedRevision;
    setBusy(false);
    setStatus(`Draft r${expectedRevision} をPreviewしました`, 'ok');
  }

  async function publishProject() {
    if (!project || !workingDocument) {
      throw Object.assign(new Error('Authoring Project is not loaded'), {
        code: 'authoring_project_not_loaded',
      });
    }
    if (dirty) {
      throw Object.assign(new Error('公開前に変更を保存してください'), {
        code: 'unsaved_changes',
      });
    }
    if (previewedRevision !== project.draftRevision) {
      throw Object.assign(new Error('現在のDraftをPreviewしてから公開してください'), {
        code: 'preview_required',
      });
    }
    assertOperationalDocument();
    const api = requiredAuthoringApi();
    setBusy(true);
    setStatus('公開要求を送っています…');
    const expectedRevision = project.draftRevision;
    const response = await api.publish({ expectedRevision });
    const version = core.validatePublishResponse(
      response,
      expectedRevision,
      project.contentId,
    );
    setBusy(false);
    setStatus(`Published v${version} を作成しました`, 'ok');
  }

  async function initializeFromHost() {
    if (initialized) return;
    const api = authoringApi();
    if (!api) {
      setStatus('みんアプの編集画面から開いてください', 'waiting');
      return;
    }
    initialized = true;
    try {
      await loadProject();
    } catch (error) {
      initialized = false;
      handleUiError(error);
    }
  }

  els.title.addEventListener('input', () => {
    if (!workingDocument || busy) return;
    workingDocument.title = els.title.value;
    markDirty();
  });
  els.startScene.addEventListener('change', () => {
    if (!workingDocument || busy) return;
    workingDocument.start_scene = els.startScene.value;
    markDirty();
  });
  els.assetSave.addEventListener('click', async () => {
    try {
      await saveAssetFromForm();
    } catch (error) {
      handleUiError(error);
    }
  });
  els.assetFile.addEventListener('change', () => {
    if (
      els.assetFile.files &&
      els.assetFile.files[0] &&
      els.assetId.value.trim() !== ''
    ) {
      setStatus(
        `素材 ${els.assetId.value.trim()} を「追加 / 差し替え」で反映できます`,
        'waiting',
      );
    }
  });
  els.save.addEventListener('click', async () => {
    try {
      await saveProject();
    } catch (error) {
      handleUiError(error);
    }
  });
  els.preview.addEventListener('click', async () => {
    try {
      await previewProject();
    } catch (error) {
      previewedRevision = null;
      handleUiError(error);
    }
  });
  els.publish.addEventListener('click', async () => {
    try {
      await publishProject();
    } catch (error) {
      handleUiError(error);
    }
  });

  window.addEventListener('minappready', initializeFromHost);
  setBusy(false);
  initializeFromHost();
})();
