'use strict';

const assert = require('node:assert/strict');
const resilience = require('./editor-resilience.js');

const contentId = 'a'.repeat(32);
const backup = {
  contentId,
  expectedRevision: 7,
  document: { content_format: 'minapp/novel@1' },
  savedAt: '2026-09-08T13:00:00Z',
};

assert.strictEqual(resilience.CHANNEL, 'minapp.novel-editor.recovery');
assert.strictEqual(resilience.VERSION, 1);
assert.strictEqual(resilience.validateBackup(null, contentId), null);
assert.deepStrictEqual(resilience.validateBackup(backup, contentId), backup);
assert.throws(
  () => resilience.validateBackup({ ...backup, contentId: 'b'.repeat(32) }, contentId),
  (error) => error && error.code === 'recovery_scope_mismatch',
);
assert.throws(
  () => resilience.validateBackup({ ...backup, unexpected: true }, contentId),
  (error) => error && error.code === 'recovery_store_invalid',
);

console.log('editor resilience tests passed');
