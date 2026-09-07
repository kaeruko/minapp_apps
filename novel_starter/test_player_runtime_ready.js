'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const playerSource = fs.readFileSync(path.join(__dirname, 'player.js'), 'utf8');
assert.match(playerSource, /case 'goto':[\s\S]*sceneId = event\.goto;[\s\S]*eventIndex = 0;/);
assert.match(playerSource, /automatic_event_loop/);

function element() {
  const listeners = new Map();
  return {
    textContent: '',
    hidden: false,
    disabled: false,
    style: {},
    src: '',
    alt: '',
    onclick: null,
    className: '',
    type: '',
    classList: {
      add() {},
      remove() {},
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async fire(type) {
      const listener = listeners.get(type);
      if (listener) await listener();
    },
    replaceChildren() {},
    appendChild() {},
    removeAttribute(name) {
      if (name === 'src') this.src = '';
    },
  };
}

function makeHarness({ hostedChannel }) {
  const ids = new Map();
  for (const id of [
    'title',
    'save-status',
    'stage',
    'speaker',
    'text',
    'choices',
    'end',
    'start-overlay',
    'start-button',
    'continue-button',
    'fatal',
    'fatal-message',
    'reset-save-button',
  ]) {
    ids.set(id, element());
  }

  const story = {
    content_format: 'minapp/novel@1',
    schema_version: 1,
    content_revision: 1,
    title: 'test',
    start_scene: 'start',
    assets: {},
    characters: {},
    scenes: {
      start: {
        id: 'start',
        events: [{ id: 'end', type: 'end' }],
      },
    },
  };
  const storyElement = element();
  storyElement.textContent = JSON.stringify(story);
  ids.set('minapp-novel-story', storyElement);

  const slots = {
    left: element(),
    center: element(),
    right: element(),
  };
  const windowListeners = new Map();
  const windowObject = {
    MinAppNovelFormat: {
      FORMAT: 'minapp/novel@1',
      validateStory(value) {
        return value;
      },
    },
    addEventListener(type, listener) {
      windowListeners.set(type, listener);
    },
    async dispatch(type) {
      const listener = windowListeners.get(type);
      if (listener) await listener();
    },
  };
  if (hostedChannel) {
    windowObject.MinAppNativeBridge = { postMessage() {} };
  }

  const documentObject = {
    getElementById(id) {
      return ids.get(id) || null;
    },
    querySelector(selector) {
      const match = selector.match(/data-character-slot="(left|center|right)"/);
      return match ? slots[match[1]] : null;
    },
    createElement() {
      return element();
    },
  };

  const context = {
    window: windowObject,
    document: documentObject,
    console,
    Audio: function Audio() {
      return {
        loop: false,
        currentTime: 0,
        async play() {},
        pause() {},
      };
    },
  };
  vm.runInNewContext(playerSource, context, { filename: 'player.js' });
  return { ids, windowObject };
}

async function flush() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function testHostedWaitsForMinAppReady() {
  const { ids, windowObject } = makeHarness({ hostedChannel: true });
  await flush();

  assert.strictEqual(ids.get('save-status').textContent, 'ホスト接続待ち');
  assert.strictEqual(ids.get('start-button').disabled, true);

  let getCalls = 0;
  windowObject.minapp = {
    version: 1,
    userState: {
      async get() {
        getCalls += 1;
        const error = new Error('not found');
        error.code = 'state_not_found';
        throw error;
      },
      async set() {},
      async delete() {},
    },
  };
  await windowObject.dispatch('minappready');
  await flush();

  assert.strictEqual(getCalls, 1);
  assert.strictEqual(ids.get('save-status').textContent, 'はじめから');
  assert.strictEqual(ids.get('start-button').disabled, false);
  assert.strictEqual(ids.get('continue-button').hidden, true);
}

async function testStandaloneDoesNotWaitForHost() {
  const { ids } = makeHarness({ hostedChannel: false });
  await flush();

  assert.strictEqual(ids.get('save-status').textContent, '単体プレビュー: セーブなし');
  assert.strictEqual(ids.get('start-button').disabled, false);
}

(async () => {
  await testHostedWaitsForMinAppReady();
  await testStandaloneDoesNotWaitForHost();
  console.log('Novel Player runtime readiness tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
