'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const format = require('./story-validator.js');
const core = require('./editor-core.js');

function story() {
  return {
    content_format: 'minapp/novel@1',
    schema_version: 1,
    content_revision: 7,
    title: 'テスト作品',
    start_scene: 'start',
    assets: {},
    characters: {},
    scenes: {
      start: {
        id: 'start',
        events: [
          { id: 'line-1', type: 'dialogue', text: 'こんにちは' },
          { id: 'end-1', type: 'end', label: 'END' },
        ],
      },
    },
  };
}

function editableStory() {
  const result = story();
  result.assets = {
    face: { kind: 'image', src: 'assets/face.png', mime: 'image/png' },
    face_smile: { kind: 'image', src: 'assets/face_smile.png', mime: 'image/png' },
    bg: { kind: 'image', src: 'assets/bg.webp', mime: 'image/webp' },
    song: { kind: 'audio', src: 'assets/song.mp3', mime: 'audio/mpeg' },
    click: { kind: 'audio', src: 'assets/click.wav', mime: 'audio/wav' },
  };
  return result;
}

function project() {
  return {
    content_id: '1'.repeat(32),
    group_id: '2'.repeat(32),
    content_format: 'minapp/novel@1',
    status: 'draft',
    draft_revision: 12,
    assets: [],
    created_at: '2026-09-06T10:00:00Z',
    updated_at: '2026-09-06T10:10:00Z',
    document: story(),
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error && error.code === code);
}

{
  const loaded = project();
  const result = core.validateProject(loaded, format.validateStory);
  assert.strictEqual(result.contentId, loaded.content_id);
  assert.strictEqual(result.draftRevision, 12);
  assert.strictEqual(result.needsInitialization, false);
  assert.deepStrictEqual(result.document, loaded.document);
  assert.notStrictEqual(result.document, loaded.document);
}

{
  const empty = project();
  empty.document = {};
  const result = core.validateProject(empty, format.validateStory);
  assert.strictEqual(result.contentId, empty.content_id);
  assert.strictEqual(result.draftRevision, 12);
  assert.strictEqual(result.needsInitialization, true);
  assert.strictEqual(result.document, null);
}

{
  const malformed = project();
  malformed.document = { title: 'Host must not fill the schema' };
  assert.throws(() => core.validateProject(malformed, format.validateStory));
}

{
  const initial = core.createInitialDocument();
  const validated = format.validateStory(initial);
  assert.strictEqual(validated.content_format, 'minapp/novel@1');
  assert.strictEqual(validated.schema_version, 1);
  assert.strictEqual(validated.content_revision, 1);
  assert.strictEqual(validated.title, '新しいノベル');
  assert.strictEqual(validated.start_scene, 'scene_001');
  assert.strictEqual(validated.scenes.scene_001.events[0].type, 'dialogue');
  assert.strictEqual(validated.scenes.scene_001.events[1].type, 'end');
}

{
  const original = story();
  const saved = core.prepareDocumentSave(original, format.validateStory);
  assert.strictEqual(original.content_revision, 7);
  assert.strictEqual(
    saved.content_revision,
    7,
    'ordinary Draft saves must not invalidate per-user progress',
  );
  assert.strictEqual(saved.scenes.start.events[0].id, 'line-1');
}

{
  const response = {
    content_id: '1'.repeat(32),
    group_id: '2'.repeat(32),
    content_format: 'minapp/novel@1',
    status: 'draft',
    draft_revision: 13,
    assets: [],
    created_at: '2026-09-06T10:00:00Z',
    updated_at: '2026-09-06T10:11:00Z',
  };
  assert.strictEqual(
    core.validateSaveResponse(response, 12, '1'.repeat(32)),
    13,
  );
  expectCode(
    () => core.validateSaveResponse({ ...response, draft_revision: 14 }, 12, '1'.repeat(32)),
    'authoring_revision_changed',
  );
  expectCode(
    () => core.validateSaveResponse({ ...response, content_id: '3'.repeat(32) }, 12, '1'.repeat(32)),
    'authoring_scope_changed',
  );
}

{
  const preview = {
    content_format: 'minapp/novel@1',
    draft_revision: 13,
    player_app_id: '3'.repeat(32),
  };
  assert.strictEqual(
    core.validatePreviewResponse(preview, 13),
    '3'.repeat(32),
  );
  assert.strictEqual(core.validatePreviewResponse(null, 13), null);
  expectCode(
    () => core.validatePreviewResponse({ ...preview, draft_revision: 12 }, 13),
    'authoring_revision_changed',
  );
  expectCode(
    () => core.validatePreviewResponse({ ...preview, content_id: '1'.repeat(32) }, 13),
    'invalid_authoring_response',
  );
}

{
  const response = {
    content_id: '1'.repeat(32),
    group_id: '2'.repeat(32),
    content_format: 'minapp/novel@1',
    published_version: 4,
    source_revision: 13,
    published_app_id: '4'.repeat(32),
    player_app_id: '3'.repeat(32),
    player_source_version: 2,
    assets: [],
    published_at: '2026-09-06T10:12:00Z',
  };
  assert.strictEqual(
    core.validatePublishResponse(response, 13, '1'.repeat(32)),
    4,
  );
  expectCode(
    () => core.validatePublishResponse({ ...response, source_revision: 12 }, 13, '1'.repeat(32)),
    'authoring_revision_changed',
  );
  expectCode(
    () => {
      const oldResponse = { ...response };
      delete oldResponse.player_source_version;
      core.validatePublishResponse(oldResponse, 13, '1'.repeat(32));
    },
    'invalid_authoring_response',
  );
}

{
  const wrong = project();
  wrong.content_format = 'example/novel@1';
  expectCode(
    () => core.validateProject(wrong, format.validateStory),
    'unsupported_content_format',
  );
}

{
  const extra = project();
  extra.user_id = 'must-not-be-accepted';
  expectCode(
    () => core.validateProject(extra, format.validateStory),
    'invalid_authoring_response',
  );
}

// Full-schema construction helpers: start from a valid small story and build the
// characters / expressions / scenes / events that the browser UI exposes.
{
  let document = editableStory();
  format.validateStory(document);

  document = core.addCharacter(
    document,
    'akari',
    'あかり',
    'normal',
    'face',
    format.validateStory,
  );
  assert.deepStrictEqual(document.characters.akari.expressions, { normal: 'face' });

  document = core.addCharacterExpression(
    document,
    'akari',
    'smile',
    'face_smile',
    format.validateStory,
  );
  document = core.setCharacterExpression(
    document,
    'akari',
    'smile',
    'face',
    format.validateStory,
  );
  assert.strictEqual(document.characters.akari.expressions.smile, 'face');
  expectCode(
    () => core.addCharacterExpression(document, 'akari', 'smile', 'face_smile', format.validateStory),
    'duplicate_expression_id',
  );

  document = core.addScene(document, 'hall', format.validateStory);
  assert.strictEqual(document.scenes.hall.events.length, 1);
  assert.strictEqual(document.scenes.hall.events[0].type, 'end');

  for (const eventType of ['background', 'character', 'dialogue', 'choice', 'goto', 'bgm', 'se', 'end']) {
    document = core.addEvent(document, 'hall', eventType, format.validateStory);
  }
  format.validateStory(document);

  const eventIds = Object.values(document.scenes)
    .flatMap((scene) => scene.events.map((event) => event.id));
  assert.strictEqual(new Set(eventIds).size, eventIds.length, 'event IDs must stay globally unique');

  const characterEvent = document.scenes.hall.events.find((event) => event.type === 'character');
  document = core.setCharacterEventAction(
    document,
    'hall',
    characterEvent.id,
    'hide',
    format.validateStory,
  );
  const hidden = document.scenes.hall.events.find((event) => event.id === characterEvent.id);
  assert.strictEqual(hidden.action, 'hide');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(hidden, 'character'), false);
  document = core.setCharacterEventAction(
    document,
    'hall',
    characterEvent.id,
    'show',
    format.validateStory,
  );
  const shown = document.scenes.hall.events.find((event) => event.id === characterEvent.id);
  assert.strictEqual(shown.character, 'akari');
  assert.strictEqual(shown.expression, 'normal');

  const bgmEvent = document.scenes.hall.events.find((event) => event.type === 'bgm');
  document = core.setBgmEventAction(document, 'hall', bgmEvent.id, 'stop', format.validateStory);
  const stopped = document.scenes.hall.events.find((event) => event.id === bgmEvent.id);
  assert.deepStrictEqual(
    Object.keys(stopped).sort(),
    ['action', 'id', 'type'],
    'BGM stop must not retain play-only fields',
  );
  document = core.setBgmEventAction(document, 'hall', bgmEvent.id, 'play', format.validateStory);
  assert.strictEqual(document.scenes.hall.events.find((event) => event.id === bgmEvent.id).asset, 'song');

  const choiceEvent = document.scenes.hall.events.find((event) => event.type === 'choice');
  document = core.addChoiceOption(document, 'hall', choiceEvent.id, format.validateStory);
  assert.strictEqual(
    document.scenes.hall.events.find((event) => event.id === choiceEvent.id).options.length,
    2,
  );
  const addedOption = document.scenes.hall.events
    .find((event) => event.id === choiceEvent.id)
    .options[1];
  document = core.removeChoiceOption(
    document,
    'hall',
    choiceEvent.id,
    addedOption.id,
    format.validateStory,
  );
  expectCode(
    () => core.removeChoiceOption(document, 'hall', choiceEvent.id, 'option_001', format.validateStory),
    'last_choice_option',
  );

  const newEnd = document.scenes.hall.events.filter((event) => event.type === 'end')[0];
  const beforeMove = document.scenes.hall.events.findIndex((event) => event.id === newEnd.id);
  if (beforeMove > 0) {
    document = core.moveEvent(document, 'hall', newEnd.id, -1, format.validateStory);
    assert.strictEqual(
      document.scenes.hall.events.findIndex((event) => event.id === newEnd.id),
      beforeMove - 1,
    );
  }

  const seEvent = document.scenes.hall.events.find((event) => event.type === 'se');
  document = core.removeEvent(document, 'hall', seEvent.id, format.validateStory);
  assert.strictEqual(document.scenes.hall.events.some((event) => event.id === seEvent.id), false);

  expectCode(
    () => core.removeCharacter(document, 'akari', format.validateStory),
    'character_in_use',
  );
  expectCode(
    () => core.removeCharacterExpression(document, 'akari', 'normal', format.validateStory),
    'expression_in_use',
  );
  document = core.addEvent(document, 'start', 'goto', format.validateStory);
  const startGoto = document.scenes.start.events.find((event) => event.type === 'goto');
  startGoto.goto = 'hall';
  format.validateStory(document);
  expectCode(
    () => core.removeScene(document, 'hall', format.validateStory),
    'scene_in_use',
  );
}

// Dependency gaps fail explicitly; the helpers do not select another event kind
// or mutate the document through an alternate path.
{
  const noDependencies = story();
  expectCode(
    () => core.addEvent(noDependencies, 'start', 'character', format.validateStory),
    'missing_editor_dependency',
  );
  expectCode(
    () => core.addEvent(noDependencies, 'start', 'bgm', format.validateStory),
    'missing_editor_dependency',
  );
  expectCode(
    () => core.addCharacter(noDependencies, 'akari', 'あかり', 'normal', 'missing', format.validateStory),
    'asset_not_found',
  );
}

{
  const root = __dirname;
  const editorValidator = fs.readFileSync(path.join(root, 'story-validator.js'));
  const playerValidator = fs.readFileSync(path.join(root, '..', 'novel_starter', 'story-validator.js'));
  assert.deepStrictEqual(
    editorValidator,
    playerValidator,
    'Editor and Player packaged validators must remain byte-identical',
  );
}

console.log('Novel Editor core contract tests passed.');
