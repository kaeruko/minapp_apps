'use strict';

const assert = require('assert');
const tools = require('./asset-tools.js');

{
  const value = tools.descriptor('classroom', 'bg.PNG');
  assert.deepStrictEqual(value, {
    kind: 'image',
    src: 'assets/classroom.png',
    mime: 'image/png',
  });
}

{
  const value = tools.descriptor('theme', 'music.m4a');
  assert.deepStrictEqual(value, {
    kind: 'audio',
    src: 'assets/theme.m4a',
    mime: 'audio/mp4',
  });
}

assert.throws(
  () => tools.descriptor('../bad', 'x.png'),
  (error) => error && error.code === 'invalid_asset_id',
);
assert.throws(
  () => tools.descriptor('hero', 'x.exe'),
  (error) => error && error.code === 'unsupported_asset_type',
);

{
  const serverAssets = [
    {
      path: 'assets/classroom.png',
      sha256: 'a'.repeat(64),
      bytes: 123,
      content_type: 'image/png',
      revision: 3,
    },
  ];
  assert.strictEqual(
    tools.serverAssetByPath(serverAssets, 'assets/classroom.png').bytes,
    123,
  );
  assert.deepStrictEqual(
    tools.missingStoredPaths(
      { assets: { classroom: { src: 'assets/classroom.png' }, bell: { src: 'assets/bell.wav' } } },
      serverAssets,
    ),
    ['assets/bell.wav'],
  );
  assert.throws(
    () => tools.validateServerAssets([{ ...serverAssets[0], extra: true }]),
    (error) => error && error.code === 'invalid_authoring_asset_metadata',
  );
  assert.throws(
    () => tools.validateServerAssets([{ ...serverAssets[0], content_type: 'image/jpeg' }]),
    (error) => error && error.code === 'invalid_authoring_asset_metadata',
  );
}

{
  const story = {
    assets: {},
    characters: {
      akari: { expressions: { smile: 'akari_smile' } },
    },
    scenes: {
      start: {
        events: [
          { id: 'bg', type: 'background', asset: 'classroom' },
          { id: 'music', type: 'bgm', action: 'play', asset: 'theme' },
          { id: 'se', type: 'se', asset: 'bell' },
        ],
      },
    },
  };
  assert.deepStrictEqual(tools.references(story, 'akari_smile'), ['character:akari.smile']);
  assert.deepStrictEqual(tools.references(story, 'classroom'), ['scene:start/bg']);
  assert.deepStrictEqual(tools.references(story, 'theme'), ['scene:start/music']);
  assert.deepStrictEqual(tools.references(story, 'bell'), ['scene:start/se']);
}

{
  const story = {
    assets: {
      one: { src: 'assets/shared.png' },
      two: { src: 'assets/shared.png' },
    },
  };
  assert.strictEqual(
    tools.pathUsedByOtherDescriptor(story, 'one', 'assets/shared.png'),
    true,
  );
  assert.strictEqual(
    tools.pathUsedByOtherDescriptor(story, 'one', 'assets/other.png'),
    false,
  );
}

console.log('Novel asset tool tests passed.');
