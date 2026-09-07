(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MinAppNovelEditorCore = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FORMAT = 'minapp/novel@1';
  const APP_ID_RE = /^[0-9a-f]{32}$/;
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const PROJECT_FIELDS = new Set([
    'content_id',
    'group_id',
    'content_format',
    'status',
    'draft_revision',
    'assets',
    'created_at',
    'updated_at',
    'document',
  ]);
  const SAVE_RESPONSE_FIELDS = new Set([
    'content_id',
    'group_id',
    'content_format',
    'status',
    'draft_revision',
    'assets',
    'created_at',
    'updated_at',
  ]);
  const PREVIEW_RESPONSE_FIELDS = new Set([
    'content_format',
    'draft_revision',
    'player_app_id',
  ]);
  const PUBLISH_RESPONSE_FIELDS = new Set([
    'content_id',
    'group_id',
    'content_format',
    'published_version',
    'source_revision',
    'published_app_id',
    'player_app_id',
    'player_source_version',
    'assets',
    'published_at',
  ]);
  const TERMINAL_EVENT_TYPES = new Set(['choice', 'goto', 'end']);
  const EVENT_TYPES = new Set([
    'background',
    'character',
    'dialogue',
    'choice',
    'goto',
    'bgm',
    'se',
    'end',
  ]);

  class NovelEditorContractError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'NovelEditorContractError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new NovelEditorContractError(code, message);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isEmptyObject(value) {
    return isObject(value) && Object.keys(value).length === 0;
  }

  function requireExactFields(value, expected, context) {
    if (!isObject(value)) fail('invalid_authoring_response', `${context} must be an object`);
    const actual = Object.keys(value);
    if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
      fail('invalid_authoring_response', `${context} fields do not match the Authoring contract`);
    }
  }

  function requirePositiveInteger(value, context) {
    if (!Number.isInteger(value) || value < 1) {
      fail('invalid_authoring_response', `${context} must be a positive integer`);
    }
    return value;
  }

  function requireString(value, context) {
    if (typeof value !== 'string' || value.length === 0) {
      fail('invalid_authoring_response', `${context} must be a non-empty string`);
    }
    return value;
  }

  function requireAppId(value, context) {
    requireString(value, context);
    if (!APP_ID_RE.test(value)) {
      fail('invalid_authoring_response', `${context} must be a 32-character lowercase hexadecimal app id`);
    }
    return value;
  }

  function requireFormat(value) {
    if (value !== FORMAT) {
      fail('unsupported_content_format', `Editor requires exact ${FORMAT}`);
    }
  }

  function requireEditorId(value, context) {
    if (typeof value !== 'string' || !ID_RE.test(value)) {
      fail('invalid_editor_id', `${context} must match /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`);
    }
    return value;
  }

  function requireEditorText(value, context, maxLength) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
      fail('invalid_editor_value', `${context} must be 1-${maxLength} characters`);
    }
    return value;
  }

  function createInitialDocument() {
    return {
      content_format: FORMAT,
      schema_version: 1,
      // content_revision is the save-compatibility epoch used by the Player.
      // Ordinary text/scene edits do not change it. Bump it only for a deliberate
      // breaking change that must invalidate existing per-user progress.
      content_revision: 1,
      title: '新しいノベル',
      start_scene: 'scene_001',
      assets: {},
      characters: {},
      scenes: {
        scene_001: {
          id: 'scene_001',
          events: [
            {
              id: 'event_001',
              type: 'dialogue',
              text: 'ここから物語をはじめよう。',
            },
            {
              id: 'event_002',
              type: 'end',
              label: 'END',
            },
          ],
        },
      },
    };
  }

  function validateProject(payload, validateStory) {
    if (typeof validateStory !== 'function') {
      throw new TypeError('validateStory must be a function');
    }
    requireExactFields(payload, PROJECT_FIELDS, 'Authoring load response');
    requireString(payload.content_id, 'content_id');
    requireString(payload.group_id, 'group_id');
    requireFormat(payload.content_format);
    if (payload.status !== 'draft') {
      fail('content_not_editable', 'Authoring content status must be draft');
    }
    requirePositiveInteger(payload.draft_revision, 'draft_revision');
    if (!Array.isArray(payload.assets)) {
      fail('invalid_authoring_response', 'assets must be a list');
    }
    requireString(payload.created_at, 'created_at');
    requireString(payload.updated_at, 'updated_at');
    if (!isObject(payload.document)) {
      fail('invalid_authoring_response', 'document must be an object');
    }

    if (isEmptyObject(payload.document)) {
      return {
        contentId: payload.content_id,
        draftRevision: payload.draft_revision,
        document: null,
        assets: deepClone(payload.assets),
        needsInitialization: true,
      };
    }

    const document = validateStory(payload.document);
    return {
      contentId: payload.content_id,
      draftRevision: payload.draft_revision,
      document: deepClone(document),
      assets: deepClone(payload.assets),
      needsInitialization: false,
    };
  }

  function prepareDocumentSave(document, validateStory) {
    if (typeof validateStory !== 'function') {
      throw new TypeError('validateStory must be a function');
    }
    if (!isObject(document)) {
      fail('invalid_editor_document', 'Editor document must be an object');
    }
    const next = deepClone(document);
    requireFormat(next.content_format);
    requirePositiveInteger(next.content_revision, 'document.content_revision');
    return validateStory(next);
  }

  function validateSaveResponse(payload, expectedRevision, expectedContentId) {
    requirePositiveInteger(expectedRevision, 'expectedRevision');
    requireExactFields(payload, SAVE_RESPONSE_FIELDS, 'Authoring save response');
    requireFormat(payload.content_format);
    if (payload.content_id !== expectedContentId) {
      fail('authoring_scope_changed', 'Authoring save response changed content scope');
    }
    if (payload.status !== 'draft') {
      fail('content_not_editable', 'Saved Authoring content must remain draft');
    }
    if (payload.draft_revision !== expectedRevision + 1) {
      fail('authoring_revision_changed', 'Authoring save did not advance exactly one revision');
    }
    if (!Array.isArray(payload.assets)) {
      fail('invalid_authoring_response', 'assets must be a list');
    }
    return payload.draft_revision;
  }

  function validatePreviewResponse(payload, expectedRevision) {
    requirePositiveInteger(expectedRevision, 'expectedRevision');
    if (payload === null) return null;
    requireExactFields(payload, PREVIEW_RESPONSE_FIELDS, 'Authoring preview response');
    requireFormat(payload.content_format);
    if (payload.draft_revision !== expectedRevision) {
      fail('authoring_revision_changed', 'Preview draft revision does not match requested draft revision');
    }
    return requireAppId(payload.player_app_id, 'player_app_id');
  }

  function validatePublishResponse(payload, expectedRevision, expectedContentId) {
    requirePositiveInteger(expectedRevision, 'expectedRevision');
    requireExactFields(payload, PUBLISH_RESPONSE_FIELDS, 'Authoring publish response');
    requireFormat(payload.content_format);
    if (payload.content_id !== expectedContentId) {
      fail('authoring_scope_changed', 'Authoring publish response changed content scope');
    }
    if (payload.source_revision !== expectedRevision) {
      fail('authoring_revision_changed', 'Published source revision does not match requested draft revision');
    }
    requirePositiveInteger(payload.published_version, 'published_version');
    requirePositiveInteger(payload.player_source_version, 'player_source_version');
    requireAppId(payload.published_app_id, 'published_app_id');
    requireAppId(payload.player_app_id, 'player_app_id');
    if (!Array.isArray(payload.assets)) {
      fail('invalid_authoring_response', 'assets must be a list');
    }
    requireString(payload.published_at, 'published_at');
    return payload.published_version;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mutateValidated(document, validateStory, mutator) {
    if (typeof validateStory !== 'function') {
      throw new TypeError('validateStory must be a function');
    }
    if (!isObject(document)) {
      fail('invalid_editor_document', 'Editor document must be an object');
    }
    const next = deepClone(document);
    validateStory(next);
    mutator(next);
    validateStory(next);
    return next;
  }

  function requireScene(document, sceneId) {
    requireEditorId(sceneId, 'sceneId');
    const scene = document.scenes && document.scenes[sceneId];
    if (!scene) fail('scene_not_found', `scene ${sceneId} does not exist`);
    return scene;
  }

  function requireCharacter(document, characterId) {
    requireEditorId(characterId, 'characterId');
    const character = document.characters && document.characters[characterId];
    if (!character) fail('character_not_found', `character ${characterId} does not exist`);
    return character;
  }

  function requireImageAsset(document, assetId) {
    requireEditorId(assetId, 'assetId');
    const asset = document.assets && document.assets[assetId];
    if (!asset) fail('asset_not_found', `asset ${assetId} does not exist`);
    if (asset.kind !== 'image') fail('asset_kind_mismatch', `asset ${assetId} must be image`);
    return asset;
  }

  function requireAudioAsset(document, assetId) {
    requireEditorId(assetId, 'assetId');
    const asset = document.assets && document.assets[assetId];
    if (!asset) fail('asset_not_found', `asset ${assetId} does not exist`);
    if (asset.kind !== 'audio') fail('asset_kind_mismatch', `asset ${assetId} must be audio`);
    return asset;
  }

  function allEventIds(document) {
    const ids = new Set();
    for (const scene of Object.values(document.scenes || {})) {
      for (const event of scene.events || []) ids.add(event.id);
    }
    return ids;
  }

  function nextEventId(document) {
    const used = allEventIds(document);
    for (let index = 1; index <= 999999; index += 1) {
      const id = `event_${String(index).padStart(3, '0')}`;
      if (!used.has(id)) return id;
    }
    fail('event_id_exhausted', 'could not allocate a stable event id');
  }

  function nextChoiceId(event) {
    const used = new Set((event.options || []).map((option) => option.id));
    for (let index = 1; index <= 999999; index += 1) {
      const id = `option_${String(index).padStart(3, '0')}`;
      if (!used.has(id)) return id;
    }
    fail('choice_id_exhausted', 'could not allocate a stable choice id');
  }

  function firstAssetId(document, kind) {
    const match = Object.entries(document.assets || {}).find(([, asset]) => asset.kind === kind);
    if (!match) fail('missing_editor_dependency', `${kind} asset is required for this event`);
    return match[0];
  }

  function firstCharacterSelection(document) {
    const match = Object.entries(document.characters || {})[0];
    if (!match) fail('missing_editor_dependency', 'character is required for this event');
    const [characterId, character] = match;
    const expressionId = Object.keys(character.expressions || {})[0];
    if (!expressionId) fail('missing_editor_dependency', `character ${characterId} has no expression`);
    return { characterId, expressionId };
  }

  function findEvent(document, sceneId, eventId) {
    const scene = requireScene(document, sceneId);
    requireEditorId(eventId, 'eventId');
    const index = scene.events.findIndex((event) => event.id === eventId);
    if (index < 0) fail('event_not_found', `event ${eventId} does not exist in ${sceneId}`);
    return { scene, event: scene.events[index], index };
  }

  function addScene(document, sceneId, validateStory) {
    const id = requireEditorId(sceneId, 'sceneId');
    return mutateValidated(document, validateStory, (next) => {
      if (next.scenes[id]) fail('duplicate_scene_id', `scene ${id} already exists`);
      next.scenes[id] = {
        id,
        events: [{ id: nextEventId(next), type: 'end', label: 'END' }],
      };
    });
  }

  function removeScene(document, sceneId, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      requireScene(next, sceneId);
      if (Object.keys(next.scenes).length <= 1) {
        fail('last_scene', 'the last scene cannot be deleted');
      }
      if (next.start_scene === sceneId) {
        fail('scene_in_use', 'change start_scene before deleting this scene');
      }
      for (const [sourceSceneId, scene] of Object.entries(next.scenes)) {
        if (sourceSceneId === sceneId) continue;
        for (const event of scene.events) {
          if (event.type === 'goto' && event.goto === sceneId) {
            fail('scene_in_use', `${sourceSceneId}/${event.id} points to ${sceneId}`);
          }
          if (event.type === 'choice') {
            for (const option of event.options) {
              if (option.goto === sceneId) {
                fail('scene_in_use', `${sourceSceneId}/${event.id}/${option.id} points to ${sceneId}`);
              }
            }
          }
        }
      }
      delete next.scenes[sceneId];
    });
  }

  function addCharacter(document, characterId, name, expressionId, assetId, validateStory) {
    const id = requireEditorId(characterId, 'characterId');
    const expression = requireEditorId(expressionId, 'expressionId');
    const displayName = requireEditorText(name, 'character name', 40);
    return mutateValidated(document, validateStory, (next) => {
      if (next.characters[id]) fail('duplicate_character_id', `character ${id} already exists`);
      requireImageAsset(next, assetId);
      next.characters[id] = {
        name: displayName,
        expressions: { [expression]: assetId },
      };
    });
  }

  function setCharacterName(document, characterId, name, validateStory) {
    const displayName = requireEditorText(name, 'character name', 40);
    return mutateValidated(document, validateStory, (next) => {
      requireCharacter(next, characterId).name = displayName;
    });
  }

  function setCharacterExpression(document, characterId, expressionId, assetId, validateStory) {
    const expression = requireEditorId(expressionId, 'expressionId');
    return mutateValidated(document, validateStory, (next) => {
      const character = requireCharacter(next, characterId);
      requireImageAsset(next, assetId);
      character.expressions[expression] = assetId;
    });
  }

  function addCharacterExpression(document, characterId, expressionId, assetId, validateStory) {
    const expression = requireEditorId(expressionId, 'expressionId');
    return mutateValidated(document, validateStory, (next) => {
      const character = requireCharacter(next, characterId);
      if (Object.prototype.hasOwnProperty.call(character.expressions, expression)) {
        fail('duplicate_expression_id', `expression ${characterId}.${expression} already exists`);
      }
      requireImageAsset(next, assetId);
      character.expressions[expression] = assetId;
    });
  }

  function removeCharacterExpression(document, characterId, expressionId, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      const character = requireCharacter(next, characterId);
      requireEditorId(expressionId, 'expressionId');
      if (!Object.prototype.hasOwnProperty.call(character.expressions, expressionId)) {
        fail('expression_not_found', `expression ${characterId}.${expressionId} does not exist`);
      }
      if (Object.keys(character.expressions).length <= 1) {
        fail('last_character_expression', 'a character must keep at least one expression');
      }
      for (const [sceneId, scene] of Object.entries(next.scenes)) {
        for (const event of scene.events) {
          if (
            event.type === 'character' &&
            event.action === 'show' &&
            event.character === characterId &&
            event.expression === expressionId
          ) {
            fail('expression_in_use', `${sceneId}/${event.id} uses ${characterId}.${expressionId}`);
          }
        }
      }
      delete character.expressions[expressionId];
    });
  }

  function removeCharacter(document, characterId, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      requireCharacter(next, characterId);
      for (const [sceneId, scene] of Object.entries(next.scenes)) {
        for (const event of scene.events) {
          if (event.type === 'dialogue' && event.speaker === characterId) {
            fail('character_in_use', `${sceneId}/${event.id} uses ${characterId} as speaker`);
          }
          if (event.type === 'character' && event.action === 'show' && event.character === characterId) {
            fail('character_in_use', `${sceneId}/${event.id} shows ${characterId}`);
          }
        }
      }
      delete next.characters[characterId];
    });
  }

  function defaultEvent(document, sceneId, eventType) {
    if (!EVENT_TYPES.has(eventType)) {
      fail('unsupported_event_type', `unsupported event type ${eventType}`);
    }
    const id = nextEventId(document);
    switch (eventType) {
      case 'background':
        return { id, type: 'background', asset: firstAssetId(document, 'image') };
      case 'character': {
        const selection = firstCharacterSelection(document);
        return {
          id,
          type: 'character',
          action: 'show',
          slot: 'center',
          character: selection.characterId,
          expression: selection.expressionId,
        };
      }
      case 'dialogue':
        return { id, type: 'dialogue', text: '新しいセリフ' };
      case 'choice':
        return {
          id,
          type: 'choice',
          options: [{ id: 'option_001', label: '選択肢', goto: sceneId }],
        };
      case 'goto':
        return { id, type: 'goto', goto: sceneId };
      case 'bgm':
        return { id, type: 'bgm', action: 'play', asset: firstAssetId(document, 'audio'), loop: true };
      case 'se':
        return { id, type: 'se', asset: firstAssetId(document, 'audio') };
      case 'end':
        return { id, type: 'end', label: 'END' };
      default:
        fail('unsupported_event_type', `unsupported event type ${eventType}`);
    }
  }

  function addEvent(document, sceneId, eventType, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      const scene = requireScene(next, sceneId);
      const event = defaultEvent(next, sceneId, eventType);
      const last = scene.events[scene.events.length - 1];
      if (!last || !TERMINAL_EVENT_TYPES.has(last.type)) {
        fail('unterminated_scene', `scene ${sceneId} must have a terminal event before inserting`);
      }
      scene.events.splice(scene.events.length - 1, 0, event);
    });
  }

  function removeEvent(document, sceneId, eventId, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      const { scene, index } = findEvent(next, sceneId, eventId);
      if (scene.events.length <= 1) fail('last_event', 'a scene must keep at least one event');
      scene.events.splice(index, 1);
    });
  }

  function moveEvent(document, sceneId, eventId, direction, validateStory) {
    if (direction !== -1 && direction !== 1) {
      fail('invalid_move_direction', 'direction must be -1 or 1');
    }
    return mutateValidated(document, validateStory, (next) => {
      const { scene, index } = findEvent(next, sceneId, eventId);
      const target = index + direction;
      if (target < 0 || target >= scene.events.length) {
        fail('event_move_out_of_range', `event ${eventId} cannot move further`);
      }
      [scene.events[index], scene.events[target]] = [scene.events[target], scene.events[index]];
    });
  }

  function addChoiceOption(document, sceneId, eventId, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      const { event } = findEvent(next, sceneId, eventId);
      if (event.type !== 'choice') fail('event_type_mismatch', `${eventId} is not a choice event`);
      event.options.push({
        id: nextChoiceId(event),
        label: '選択肢',
        goto: sceneId,
      });
    });
  }

  function removeChoiceOption(document, sceneId, eventId, optionId, validateStory) {
    return mutateValidated(document, validateStory, (next) => {
      const { event } = findEvent(next, sceneId, eventId);
      if (event.type !== 'choice') fail('event_type_mismatch', `${eventId} is not a choice event`);
      requireEditorId(optionId, 'optionId');
      if (event.options.length <= 1) fail('last_choice_option', 'a choice must keep at least one option');
      const index = event.options.findIndex((option) => option.id === optionId);
      if (index < 0) fail('choice_not_found', `choice option ${optionId} does not exist`);
      event.options.splice(index, 1);
    });
  }

  function setCharacterEventAction(document, sceneId, eventId, action, validateStory) {
    if (action !== 'show' && action !== 'hide') {
      fail('invalid_editor_value', 'character action must be show or hide');
    }
    return mutateValidated(document, validateStory, (next) => {
      const { event } = findEvent(next, sceneId, eventId);
      if (event.type !== 'character') fail('event_type_mismatch', `${eventId} is not a character event`);
      event.action = action;
      if (action === 'hide') {
        delete event.character;
        delete event.expression;
        return;
      }
      const selection = firstCharacterSelection(next);
      event.character = selection.characterId;
      event.expression = selection.expressionId;
    });
  }

  function setBgmEventAction(document, sceneId, eventId, action, validateStory) {
    if (action !== 'play' && action !== 'stop') {
      fail('invalid_editor_value', 'BGM action must be play or stop');
    }
    return mutateValidated(document, validateStory, (next) => {
      const { event } = findEvent(next, sceneId, eventId);
      if (event.type !== 'bgm') fail('event_type_mismatch', `${eventId} is not a BGM event`);
      event.action = action;
      if (action === 'stop') {
        delete event.asset;
        delete event.loop;
        return;
      }
      event.asset = firstAssetId(next, 'audio');
      event.loop = true;
    });
  }

  return {
    FORMAT,
    NovelEditorContractError,
    createInitialDocument,
    validateProject,
    prepareDocumentSave,
    validateSaveResponse,
    validatePreviewResponse,
    validatePublishResponse,
    deepClone,
    addScene,
    removeScene,
    addCharacter,
    setCharacterName,
    setCharacterExpression,
    addCharacterExpression,
    removeCharacterExpression,
    removeCharacter,
    addEvent,
    removeEvent,
    moveEvent,
    addChoiceOption,
    removeChoiceOption,
    setCharacterEventAction,
    setBgmEventAction,
  };
});
