(function (root) {
  'use strict';

  const VERSION = 1;
  const MAX_YEN = 100000;
  const MAX_STORES = 80;
  const MAX_HISTORY = 500;
  const GENRES = Object.freeze([
    Object.freeze({ id: 'ramen', label: 'ラーメン', image: 'food_ramen.png' }),
    Object.freeze({ id: 'curry', label: 'カレー', image: 'food_curry.png' }),
    Object.freeze({ id: 'gyudon', label: '牛丼', image: 'food_gyudon.png' }),
    Object.freeze({ id: 'soba_udon', label: 'そば・うどん', image: 'food_soba_udon.png' }),
    Object.freeze({ id: 'teishoku', label: '定食', image: 'food_teishoku.png' }),
    Object.freeze({ id: 'chinese', label: '町中華', image: 'food_chinese.png' }),
    Object.freeze({ id: 'yoshoku', label: '洋食', image: 'food_yoshoku.png' }),
    Object.freeze({ id: 'burger', label: 'バーガー', image: 'food_burger.png' }),
    Object.freeze({ id: 'convenience', label: 'コンビニ', image: 'food_convenience.png' }),
    Object.freeze({ id: 'other', label: 'その他', image: 'food_other.png' })
  ]);
  const IDS = Object.freeze(GENRES.map((genre) => genre.id));
  const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  function fail(message) { throw new Error(message); }
  function obj(value, name) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      fail(name + ' must be an object');
    }
    return value;
  }
  function exact(value, fields, name) {
    obj(value, name);
    const actual = Object.keys(value).sort();
    const expected = [...fields].sort();
    if (actual.length !== expected.length || actual.some((field, i) => field !== expected[i])) {
      fail(name + ' has unexpected or missing fields');
    }
    return value;
  }
  function text(value, name, maxLength, allowEmpty) {
    if (typeof value !== 'string' || value.length > maxLength ||
        (!allowEmpty && (!value.trim() || value !== value.trim()))) {
      fail(name + ' must be a valid string of at most ' + maxLength + ' characters');
    }
    return value;
  }
  function integer(value, name, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      fail(name + ' must be an integer between ' + min + ' and ' + max);
    }
    return value;
  }
  function genre(value) {
    if (!IDS.includes(value)) fail('Unknown genre: ' + value);
    return value;
  }
  function settings(value) {
    exact(value, ['minYen', 'maxYen', 'genreIds', 'avoid', 'mode'], 'settings');
    integer(value.minYen, 'minYen', 1, MAX_YEN);
    integer(value.maxYen, 'maxYen', 1, MAX_YEN);
    if (value.minYen > value.maxYen) fail('Minimum budget exceeds maximum budget');
    if (!['genre', 'store'].includes(value.mode)) fail('Unsupported draw mode');
    text(value.avoid, 'avoid', 120, true);
    if (!Array.isArray(value.genreIds) || value.genreIds.length < 1 ||
        value.genreIds.length > GENRES.length || new Set(value.genreIds).size !== value.genreIds.length) {
      fail('genreIds must be a non-empty list of unique genres');
    }
    value.genreIds.forEach(genre);
    return value;
  }
  function store(value) {
    exact(value, ['id', 'name', 'genreId', 'priceYen', 'query', 'note'], 'store');
    if (typeof value.id !== 'string' || !ID_RE.test(value.id)) fail('Invalid store id');
    text(value.name, 'store name', 50, false);
    genre(value.genreId);
    integer(value.priceYen, 'store price', 1, MAX_YEN);
    text(value.query, 'store map query', 100, true);
    text(value.note, 'store note', 120, true);
    return value;
  }
  function historyEntry(value) {
    exact(value, ['id', 'at', 'mode', 'genreId', 'label', 'storeId', 'priceYen'], 'history entry');
    if (typeof value.id !== 'string' || !ID_RE.test(value.id)) fail('Invalid history id');
    if (typeof value.at !== 'string' || !ISO_RE.test(value.at) ||
        !Number.isFinite(Date.parse(value.at)) ||
        new Date(value.at).toISOString() !== value.at) {
      fail('Invalid history timestamp');
    }
    genre(value.genreId);
    text(value.label, 'history label', 50, false);
    if (value.mode === 'genre') {
      if (value.storeId !== null || value.priceYen !== null) fail('Genre draw cannot include a store');
    } else if (value.mode === 'store') {
      if (typeof value.storeId !== 'string' || !ID_RE.test(value.storeId)) fail('Invalid history store id');
      integer(value.priceYen, 'history store price', 1, MAX_YEN);
    } else fail('Unsupported history mode');
    return value;
  }
  function newState() {
    return {
      version: VERSION,
      settings: {
        minYen: 800,
        maxYen: 1200,
        genreIds: IDS.slice(0, 8),
        avoid: '',
        mode: 'genre'
      },
      stores: [],
      history: []
    };
  }
  function validate(value) {
    exact(value, ['version', 'settings', 'stores', 'history'], 'Saved lunch roulette data');
    if (value.version !== VERSION) fail('Unsupported saved data version: ' + value.version);
    settings(value.settings);
    if (!Array.isArray(value.stores) || value.stores.length > MAX_STORES) fail('Invalid stores list');
    if (!Array.isArray(value.history) || value.history.length > MAX_HISTORY) fail('Invalid history list');
    const storeIds = new Set();
    for (const item of value.stores) {
      store(item);
      if (storeIds.has(item.id)) fail('Duplicate store id');
      storeIds.add(item.id);
    }
    const historyIds = new Set();
    for (const item of value.history) {
      historyEntry(item);
      if (historyIds.has(item.id)) fail('Duplicate history id');
      historyIds.add(item.id);
    }
    return value;
  }
  function setSettings(value, next) {
    validate(value);
    settings(next);
    return validate({ ...value, settings: { ...next, genreIds: [...next.genreIds] } });
  }
  function addStore(value, item) {
    validate(value);
    store(item);
    if (value.stores.length >= MAX_STORES) fail('Store limit reached (' + MAX_STORES + ')');
    if (value.stores.some((previous) => previous.id === item.id)) fail('Duplicate store id');
    return validate({ ...value, stores: [...value.stores, { ...item }] });
  }
  function deleteStore(value, id) {
    validate(value);
    if (typeof id !== 'string' || !value.stores.some((item) => item.id === id)) {
      fail('Store does not exist');
    }
    return validate({ ...value, stores: value.stores.filter((item) => item.id !== id) });
  }
  function candidates(value) {
    validate(value);
    const selected = new Set(value.settings.genreIds);
    if (value.settings.mode === 'genre') {
      return GENRES.filter((item) => selected.has(item.id)).map((item) => ({
        mode: 'genre', label: item.label, genreId: item.id, storeId: null,
        priceYen: null, query: item.label
      }));
    }
    return value.stores.filter((item) =>
      selected.has(item.genreId) &&
      item.priceYen >= value.settings.minYen &&
      item.priceYen <= value.settings.maxYen
    ).map((item) => ({
      mode: 'store', label: item.name, genreId: item.genreId,
      storeId: item.id, priceYen: item.priceYen,
      query: item.query.trim() || item.name
    }));
  }
  function choose(items, index) {
    if (!Array.isArray(items) || items.length === 0) fail('No candidates to spin');
    integer(index, 'draw index', 0, items.length - 1);
    return items[index];
  }
  function record(value, selection, id, at) {
    validate(value);
    if (value.history.length >= MAX_HISTORY) fail('History limit reached (' + MAX_HISTORY + ')');
    const validCandidates = candidates(value);
    if (!validCandidates.some((item) => Object.keys(item).every((key) => item[key] === selection[key]) &&
        Object.keys(item).length === Object.keys(selection).length)) {
      fail('Draw result is not a current eligible candidate');
    }
    const entry = historyEntry({
      id, at, mode: selection.mode, genreId: selection.genreId,
      label: selection.label, storeId: selection.storeId, priceYen: selection.priceYen
    });
    return validate({ ...value, history: [entry, ...value.history] });
  }
  function parseYen(value, name) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      fail(name + 'は1円以上の整数で入力してください');
    }
    return integer(Number(value), name, 1, MAX_YEN);
  }
  const api = Object.freeze({
    VERSION, MAX_YEN, MAX_STORES, MAX_HISTORY, GENRES, newState,
    validate, setSettings, addStore, deleteStore, candidates, choose, record, parseYen
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LunchRoulette = api;
})(typeof window === 'undefined' ? globalThis : window);
