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
