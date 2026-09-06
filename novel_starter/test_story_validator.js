'use strict';

const assert = require('node:assert/strict');
const { FORMAT, NovelFormatError, validateStory } = require('./story-validator.js');

function validStory() {
  return {
    content_format: FORMAT,
    schema_version: 1,
    content_revision: 1,
    title: 'test',
    start_scene: 'start',
    assets: {
      face: { kind: 'image', src: 'face.jpg', mime: 'image/jpeg' },
    },
    characters: {
      ren: { name: 'レン', expressions: { normal: 'face' } },
    },
    scenes: {
      start: {
        id: 'start',
        events: [
          { id: 'show', type: 'character', action: 'show', slot: 'center', character: 'ren', expression: 'normal' },
          { id: 'line', type: 'dialogue', speaker: 'ren', text: 'こんにちは' },
          { id: 'end', type: 'end' },
        ],
      },
    },
  };
}

function expectCode(mutator, expectedCode) {
  const story = validStory();
  mutator(story);
  assert.throws(
    () => validateStory(story),
    (error) => error instanceof NovelFormatError && error.code === expectedCode,
    `expected ${expectedCode}`
  );
}

assert.equal(validateStory(validStory()).content_format, FORMAT);

expectCode((story) => { story.content_format = 'novel-v1'; }, 'unsupported_format');
expectCode((story) => { story.scenes.start.events[1].type = 'mystery'; }, 'unknown_event_type');
expectCode((story) => { story.scenes.start.events[2].id = 'line'; }, 'duplicate_event_id');
expectCode((story) => {
  story.scenes.start.events = [
    { id: 'choice', type: 'choice', options: [{ id: 'x', label: 'go', goto: 'missing' }] },
  ];
}, 'missing_scene');
expectCode((story) => { story.characters.ren.expressions.normal = 'missing'; }, 'missing_asset');
expectCode((story) => { story.assets.face.src = '../face.jpg'; }, 'unsafe_asset_path');
expectCode((story) => {
  story.scenes.start.events = [{ id: 'line', type: 'dialogue', text: 'falls through' }];
}, 'unterminated_scene');

console.log('novel story validator: PASS');
