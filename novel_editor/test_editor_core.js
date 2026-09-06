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
  assert.deepStrictEqual(result.document, loaded.document);
  assert.notStrictEqual(result.document, loaded.document);
}

{
  const original = story();
  const saved = core.prepareDocumentSave(original, format.validateStory);
  assert.strictEqual(original.content_revision, 7);
  assert.strictEqual(saved.content_revision, 8);
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
  const response = {
    content_id: '1'.repeat(32),
    group_id: '2'.repeat(32),
    content_format: 'minapp/novel@1',
    published_version: 4,
    source_revision: 13,
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
    'Editor and Player must use the exact same minapp/novel@1 validator',
  );
}

console.log('Novel Editor core contract tests passed.');
