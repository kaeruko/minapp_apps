(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MinAppNovelEditorResilience = api;
    api.install(root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHANNEL = 'minapp.novel-editor.recovery';
  const VERSION = 1;
  const CONTENT_ID_RE = /^[0-9a-f]{32}$/;
  const REQUEST_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const REQUEST_TIMEOUT_MS = 2000;
  const BACKUP_DEBOUNCE_MS = 1200;
  const BACKUP_INTERVAL_MS = 5000;

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function documentJson(value) {
    return JSON.stringify(value);
  }

  function positiveInteger(value, label) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${label} must be a positive integer`);
    }
    return value;
  }

  function validateContentId(value, label) {
    if (typeof value !== 'string' || !CONTENT_ID_RE.test(value)) {
      throw new Error(`${label} must be a 32-character lowercase hexadecimal id`);
    }
    return value;
  }

  function validateBackup(value, contentId) {
    if (value === null) return null;
    if (!isPlainObject(value)) {
      throw Object.assign(new Error('Recovery backup must be an object'), {
        code: 'recovery_store_invalid',
      });
    }
    const keys = Object.keys(value).sort().join(',');
    if (keys !== 'contentId,document,expectedRevision,savedAt') {
      throw Object.assign(new Error('Recovery backup fields are invalid'), {
        code: 'recovery_store_invalid',
      });
    }
    if (validateContentId(value.contentId, 'Recovery contentId') !== contentId) {
      throw Object.assign(new Error('Recovery backup content scope does not match'), {
        code: 'recovery_scope_mismatch',
      });
    }
    positiveInteger(value.expectedRevision, 'Recovery expectedRevision');
    if (!isPlainObject(value.document)) {
      throw Object.assign(new Error('Recovery document must be an object'), {
        code: 'recovery_store_invalid',
      });
    }
    if (typeof value.savedAt !== 'string' || value.savedAt.length === 0) {
      throw Object.assign(new Error('Recovery savedAt is invalid'), {
        code: 'recovery_store_invalid',
      });
    }
    return value;
  }

  function createRecoveryClient(rootObject) {
    const pending = new Map();
    let nextId = 1;

    function finish(id, callback) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      rootObject.clearTimeout(entry.timer);
      callback(entry);
    }

    rootObject.addEventListener('message', (event) => {
      if (event.source !== rootObject.parent) return;
      const response = event.data;
      if (!isPlainObject(response) ||
          response.channel !== CHANNEL ||
          response.version !== VERSION ||
          response.type !== 'response' ||
          typeof response.id !== 'string' ||
          !REQUEST_ID_RE.test(response.id)) {
        return;
      }
      if (response.ok === true) {
        finish(response.id, (entry) => entry.resolve(response.result));
        return;
      }
      if (response.ok !== false || !isPlainObject(response.error)) return;
      finish(response.id, (entry) => {
        const error = Object.assign(
          new Error(typeof response.error.message === 'string' ? response.error.message : 'Recovery bridge failed'),
          {
            code: typeof response.error.code === 'string' ? response.error.code : 'recovery_bridge_error',
          },
        );
        entry.reject(error);
      });
    });

    function post(method, payload, expectResponse) {
      const id = String(nextId++);
      if (!REQUEST_ID_RE.test(id)) {
        return Promise.reject(Object.assign(new Error('Recovery request id is invalid'), {
          code: 'recovery_request_id_exhausted',
        }));
      }
      const message = {
        channel: CHANNEL,
        version: VERSION,
        type: 'request',
        id,
        method,
        ...payload,
      };
      if (!expectResponse) {
        rootObject.parent.postMessage(message, '*');
        return Promise.resolve(null);
      }
      return new Promise((resolve, reject) => {
        const timer = rootObject.setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error('Recovery bridge did not respond'), {
            code: 'recovery_bridge_unavailable',
          }));
        }, REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
        rootObject.parent.postMessage(message, '*');
      });
    }

    return Object.freeze({
      load: (contentId) => post('load', { contentId }, true),
      save: (contentId, expectedRevision, document) => post(
        'save',
        { contentId, expectedRevision, document: deepClone(document) },
        true,
      ),
      clear: (contentId) => post('clear', { contentId }, true),
      saveBestEffort: (contentId, expectedRevision, document) => post(
        'save',
        { contentId, expectedRevision, document: deepClone(document) },
        false,
      ),
    });
  }

  function validateProjectEnvelope(payload) {
    if (!isPlainObject(payload)) throw new Error('Authoring load response must be an object');
    validateContentId(payload.content_id, 'Authoring content_id');
    positiveInteger(payload.draft_revision, 'Authoring draft_revision');
    if (!isPlainObject(payload.document)) throw new Error('Authoring document must be an object');
    return payload;
  }

  function validateMutationEnvelope(payload, expectedContentId, expectedRevision) {
    if (!isPlainObject(payload)) throw new Error('Authoring mutation response must be an object');
    if (validateContentId(payload.content_id, 'Authoring content_id') !== expectedContentId) {
      throw new Error('Authoring mutation response changed content scope');
    }
    if (positiveInteger(payload.draft_revision, 'Authoring draft_revision') !== expectedRevision + 1) {
      throw new Error('Authoring mutation response did not advance exactly one revision');
    }
    return payload;
  }

  function install(rootObject) {
    if (!rootObject || typeof rootObject !== 'object') return false;
    if (rootObject.parent === rootObject) return false;
    if (rootObject.__minappNovelEditorResilienceInstalled === true) return true;

    const minapp = rootObject.minapp;
    const formatApi = rootObject.MinAppNovelFormat;
    if (!minapp || minapp.version !== 1 || !minapp.authoring || !formatApi) return false;
    if (typeof formatApi.validateStory !== 'function') return false;
    if (typeof minapp.authoring.load !== 'function' || typeof minapp.authoring.save !== 'function') return false;

    const minappDescriptor = Object.getOwnPropertyDescriptor(rootObject, 'minapp');
    if (minappDescriptor && minappDescriptor.configurable !== true) return false;

    const recovery = createRecoveryClient(rootObject);
    const originalAuthoring = minapp.authoring;
    const originalValidateStory = formatApi.validateStory.bind(formatApi);

    let contentId = null;
    let draftRevision = null;
    let serverDocumentJson = null;
    let latestDocument = null;
    let backupTimer = null;

    function isDirtySnapshot() {
      return contentId !== null &&
        draftRevision !== null &&
        latestDocument !== null &&
        documentJson(latestDocument) !== serverDocumentJson;
    }

    async function persistRecovery() {
      if (!isDirtySnapshot()) return;
      await recovery.save(contentId, draftRevision, latestDocument);
    }

    function scheduleRecovery() {
      if (!isDirtySnapshot()) return;
      if (backupTimer !== null) rootObject.clearTimeout(backupTimer);
      backupTimer = rootObject.setTimeout(() => {
        backupTimer = null;
        void persistRecovery().catch((error) => {
          console.error('Novel recovery backup failed', error);
        });
      }, BACKUP_DEBOUNCE_MS);
    }

    formatApi.validateStory = function validateStoryWithRecovery(document) {
      const result = originalValidateStory(document);
      latestDocument = deepClone(document);
      scheduleRecovery();
      return result;
    };

    async function clearRecoveryBestEffort() {
      if (contentId === null) return;
      try {
        await recovery.clear(contentId);
      } catch (error) {
        console.error('Novel recovery cleanup failed', error);
      }
    }

    async function load() {
      const payload = validateProjectEnvelope(await originalAuthoring.load());
      contentId = payload.content_id;
      draftRevision = payload.draft_revision;
      latestDocument = deepClone(payload.document);
      serverDocumentJson = documentJson(payload.document);

      let backup;
      try {
        backup = validateBackup(await recovery.load(contentId), contentId);
      } catch (error) {
        if (error && error.code === 'recovery_bridge_unavailable') {
          console.warn('Novel recovery bridge is unavailable; continuing with server Draft.');
          return payload;
        }
        throw error;
      }
      if (backup === null) return payload;

      if (backup.expectedRevision < draftRevision) {
        await clearRecoveryBestEffort();
        return payload;
      }
      if (backup.expectedRevision > draftRevision) {
        throw Object.assign(
          new Error(
            `Recovery backup expects Draft r${backup.expectedRevision}, but server is Draft r${draftRevision}.`,
          ),
          { code: 'recovery_revision_ahead' },
        );
      }

      originalValidateStory(backup.document);
      const restored = validateMutationEnvelope(
        await originalAuthoring.save(backup.document, { expectedRevision: draftRevision }),
        contentId,
        draftRevision,
      );
      draftRevision = restored.draft_revision;
      latestDocument = deepClone(backup.document);
      serverDocumentJson = documentJson(backup.document);
      await clearRecoveryBestEffort();
      return { ...restored, document: deepClone(backup.document) };
    }

    async function save(data, options) {
      if (!isPlainObject(data)) return await originalAuthoring.save(data, options);
      const expectedRevision = positiveInteger(
        options && options.expectedRevision,
        'Authoring expectedRevision',
      );
      if (contentId !== null) {
        try {
          await recovery.save(contentId, expectedRevision, data);
        } catch (error) {
          if (!(error && error.code === 'recovery_bridge_unavailable')) throw error;
          console.warn('Novel recovery bridge is unavailable; saving server Draft without local recovery.');
        }
      }
      const response = contentId === null
        ? await originalAuthoring.save(data, options)
        : validateMutationEnvelope(
            await originalAuthoring.save(data, options),
            contentId,
            expectedRevision,
          );
      if (contentId !== null) {
        draftRevision = response.draft_revision;
        latestDocument = deepClone(data);
        serverDocumentJson = documentJson(data);
        if (backupTimer !== null) {
          rootObject.clearTimeout(backupTimer);
          backupTimer = null;
        }
        await clearRecoveryBestEffort();
      }
      return response;
    }

    function wrapRevisionMutation(methodName) {
      const original = originalAuthoring[methodName];
      if (typeof original !== 'function') return original;
      return async (...args) => {
        const response = await original(...args);
        if (contentId !== null && isPlainObject(response) && response.content_id === contentId) {
          draftRevision = positiveInteger(response.draft_revision, 'Authoring draft_revision');
        }
        return response;
      };
    }

    const wrappedAuthoring = Object.freeze({
      ...originalAuthoring,
      load,
      save,
      saveAsset: wrapRevisionMutation('saveAsset'),
      deleteAsset: wrapRevisionMutation('deleteAsset'),
    });
    Object.defineProperty(rootObject, 'minapp', {
      configurable: true,
      value: Object.freeze({ ...minapp, authoring: wrappedAuthoring }),
    });

    rootObject.setInterval(() => {
      void persistRecovery().catch((error) => {
        console.error('Novel recovery periodic backup failed', error);
      });
    }, BACKUP_INTERVAL_MS);

    rootObject.addEventListener('pagehide', () => {
      if (!isDirtySnapshot()) return;
      void recovery.saveBestEffort(contentId, draftRevision, latestDocument);
    });

    Object.defineProperty(rootObject, '__minappNovelEditorResilienceInstalled', {
      configurable: false,
      enumerable: false,
      value: true,
    });
    return true;
  }

  return Object.freeze({
    CHANNEL,
    VERSION,
    validateBackup,
    install,
  });
});
