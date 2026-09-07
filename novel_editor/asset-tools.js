(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MinAppNovelAssetTools = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
  const SHA256_RE = /^[0-9a-f]{64}$/;
  const SERVER_ASSET_FIELDS = new Set([
    'path',
    'sha256',
    'bytes',
    'content_type',
    'revision',
  ]);
  const TYPES = Object.freeze({
    '.png': Object.freeze({ mime: 'image/png', kind: 'image' }),
    '.jpg': Object.freeze({ mime: 'image/jpeg', kind: 'image' }),
    '.jpeg': Object.freeze({ mime: 'image/jpeg', kind: 'image' }),
    '.gif': Object.freeze({ mime: 'image/gif', kind: 'image' }),
    '.webp': Object.freeze({ mime: 'image/webp', kind: 'image' }),
    '.mp3': Object.freeze({ mime: 'audio/mpeg', kind: 'audio' }),
    '.m4a': Object.freeze({ mime: 'audio/mp4', kind: 'audio' }),
    '.ogg': Object.freeze({ mime: 'audio/ogg', kind: 'audio' }),
    '.wav': Object.freeze({ mime: 'audio/wav', kind: 'audio' }),
  });

  class NovelAssetError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'NovelAssetError';
      this.code = code;
    }
  }

  function fail(code, message) {
    throw new NovelAssetError(code, message);
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function requireExactFields(value, expected, context) {
    if (!isObject(value)) fail('invalid_authoring_asset_metadata', `${context} must be an object`);
    const actual = Object.keys(value);
    if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
      fail('invalid_authoring_asset_metadata', `${context} fields are invalid`);
    }
  }

  function requireAssetId(value) {
    if (typeof value !== 'string' || !ID_RE.test(value)) {
      fail('invalid_asset_id', '素材IDは英数字で始まる64文字以内のIDにしてください');
    }
    return value;
  }

  function fileSpec(fileName) {
    if (typeof fileName !== 'string' || fileName.length === 0) {
      fail('invalid_asset_file', '素材ファイル名が不正です');
    }
    const base = fileName.split(/[\\/]/).pop();
    const dot = base.lastIndexOf('.');
    const extension = dot < 0 ? '' : base.slice(dot).toLowerCase();
    const spec = TYPES[extension];
    if (!spec) {
      fail('unsupported_asset_type', `未対応の素材形式です: ${extension || '(拡張子なし)'}`);
    }
    return Object.freeze({ extension, mime: spec.mime, kind: spec.kind });
  }

  function descriptor(assetId, fileName, previous) {
    const id = requireAssetId(assetId);
    const spec = fileSpec(fileName);
    const result = {
      kind: spec.kind,
      src: `assets/${id}${spec.extension}`,
      mime: spec.mime,
    };
    if (spec.kind === 'image' && previous && typeof previous.alt === 'string') {
      result.alt = previous.alt;
    }
    return result;
  }

  function validateServerAssets(serverAssets) {
    if (!Array.isArray(serverAssets)) {
      fail('invalid_authoring_asset_metadata', 'Authoring Project assets must be a list');
    }
    const seen = new Set();
    for (const asset of serverAssets) {
      requireExactFields(asset, SERVER_ASSET_FIELDS, 'Authoring asset metadata');
      if (typeof asset.path !== 'string' || asset.path.length === 0 || asset.path.length > 256) {
        fail('invalid_authoring_asset_metadata', 'Authoring asset path is invalid');
      }
      if (seen.has(asset.path)) {
        fail('invalid_authoring_asset_metadata', `Authoring asset path is duplicated: ${asset.path}`);
      }
      seen.add(asset.path);
      const spec = fileSpec(asset.path);
      if (asset.content_type !== spec.mime) {
        fail('invalid_authoring_asset_metadata', `Authoring asset MIME is invalid: ${asset.path}`);
      }
      if (typeof asset.sha256 !== 'string' || !SHA256_RE.test(asset.sha256)) {
        fail('invalid_authoring_asset_metadata', `Authoring asset SHA-256 is invalid: ${asset.path}`);
      }
      if (!Number.isInteger(asset.bytes) || asset.bytes < 1) {
        fail('invalid_authoring_asset_metadata', `Authoring asset byte size is invalid: ${asset.path}`);
      }
      if (!Number.isInteger(asset.revision) || asset.revision < 1) {
        fail('invalid_authoring_asset_metadata', `Authoring asset revision is invalid: ${asset.path}`);
      }
    }
    return serverAssets;
  }

  function serverAssetByPath(serverAssets, path) {
    validateServerAssets(serverAssets);
    return serverAssets.find((asset) => asset.path === path) || null;
  }

  function missingStoredPaths(story, serverAssets) {
    validateServerAssets(serverAssets);
    if (!story || !isObject(story.assets)) return [];
    const stored = new Set(serverAssets.map((asset) => asset.path));
    return [...new Set(
      Object.values(story.assets)
        .filter((asset) => isObject(asset) && typeof asset.src === 'string')
        .map((asset) => asset.src)
        .filter((path) => !stored.has(path)),
    )].sort();
  }

  function references(story, assetId) {
    requireAssetId(assetId);
    const result = [];
    if (!story || typeof story !== 'object') return result;
    const characters = isObject(story.characters) ? story.characters : {};
    for (const [characterId, character] of Object.entries(characters)) {
      const expressions = character && isObject(character.expressions) ? character.expressions : {};
      for (const [expressionId, value] of Object.entries(expressions)) {
        if (value === assetId) result.push(`character:${characterId}.${expressionId}`);
      }
    }
    const scenes = isObject(story.scenes) ? story.scenes : {};
    for (const [sceneId, scene] of Object.entries(scenes)) {
      const events = scene && Array.isArray(scene.events) ? scene.events : [];
      for (const event of events) {
        if (!event || typeof event !== 'object') continue;
        if ((event.type === 'background' || event.type === 'se') && event.asset === assetId) {
          result.push(`scene:${sceneId}/${event.id}`);
        }
        if (event.type === 'bgm' && event.action === 'play' && event.asset === assetId) {
          result.push(`scene:${sceneId}/${event.id}`);
        }
      }
    }
    return result;
  }

  function pathUsedByOtherDescriptor(story, excludedAssetId, path) {
    if (!story || !isObject(story.assets)) return false;
    return Object.entries(story.assets).some(([assetId, asset]) =>
      assetId !== excludedAssetId && asset && asset.src === path
    );
  }

  return Object.freeze({
    NovelAssetError,
    requireAssetId,
    fileSpec,
    descriptor,
    validateServerAssets,
    serverAssetByPath,
    missingStoredPaths,
    references,
    pathUsedByOtherDescriptor,
  });
});
