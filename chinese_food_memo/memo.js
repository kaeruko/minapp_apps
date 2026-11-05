(function (root) {
  'use strict';

  const VERSION = 1;
  const SLOT_COUNT = 8;
  const MAX_ENTRIES = 180;
  const MAX_SLOT_BYTES = 12 * 1024;
  const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const DATE_PATTERN = /^(20\d\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
  const ENTRY_KEYS = ['id', 'shop', 'area', 'dish', 'price', 'visitedAt', 'rating', 'favorite', 'note'];

  function fail(message) { throw new Error(message); }
  function object(value, where) {
    if (value === null || typeof value !== 'object' || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
      fail(where + ' must be a plain object');
    }
    return value;
  }
  function exactKeys(value, expected, where) {
    object(value, where);
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
      fail(where + ' has missing or unexpected fields');
    }
  }
  function shortText(value, name, min, max, allowNewlines = false) {
    const forbidden = allowNewlines ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if (typeof value !== 'string' || value.length < min || value.length > max ||
        value !== value.trim() || forbidden.test(value)) {
      fail(name + ' must be a trimmed text of ' + min + ' to ' + max + ' characters');
    }
    return value;
  }
  function date(value) {
    if (typeof value !== 'string' || !DATE_PATTERN.test(value)) fail('日付は2000〜2099年で入力してください');
    const parts = value.split('-').map(Number);
    const verified = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (verified.getUTCFullYear() !== parts[0] ||
        verified.getUTCMonth() !== parts[1] - 1 || verified.getUTCDate() !== parts[2]) {
      fail('存在しない日付です: ' + value);
    }
    return value;
  }
  function price(value) {
    if (value === null) return null;
    if (!Number.isSafeInteger(value) || value < 1 || value > 100000) {
      fail('価格は1〜100,000円の整数、または未入力にしてください');
    }
    return value;
  }
  function rating(value) {
    if (!Number.isInteger(value) || value < 1 || value > 5) fail('評価は1〜5にしてください');
    return value;
  }
  function validateEntry(entry) {
    exactKeys(entry, ENTRY_KEYS, '記録');
    if (typeof entry.id !== 'string' || !UUID_V4.test(entry.id)) fail('記録IDが不正です');
    shortText(entry.shop, '店名', 1, 40);
    shortText(entry.area, '場所', 0, 50);
    shortText(entry.dish, '料理名', 1, 50);
    price(entry.price);
    date(entry.visitedAt);
    rating(entry.rating);
    if (typeof entry.favorite !== 'boolean') fail('また行きたいフラグが不正です');
    shortText(entry.note, 'メモ', 0, 140, true);
    return entry;
  }
  function newSlot() { return { version: VERSION, entries: [] }; }
  function byteSize(value) {
    if (typeof TextEncoder !== 'function') fail('UTF-8サイズを検査できません');
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }
  function validateSlot(slot) {
    exactKeys(slot, ['version', 'entries'], '保存データ');
    if (slot.version !== VERSION) fail('未対応の保存データバージョンです: ' + slot.version);
    if (!Array.isArray(slot.entries) || slot.entries.length > MAX_ENTRIES) fail('保存された記録数が不正です');
    const ids = new Set();
    for (const entry of slot.entries) {
      validateEntry(entry);
      if (ids.has(entry.id)) fail('同じ記録IDが重複しています');
      ids.add(entry.id);
    }
    if (byteSize(slot) > MAX_SLOT_BYTES) fail('保存データが1ページあたりの容量上限を超えています');
    return slot;
  }
  function validateSlots(slots) {
    if (!Array.isArray(slots) || slots.length !== SLOT_COUNT) fail('記録ページ数が不正です');
    const ids = new Set();
    let count = 0;
    for (const slot of slots) {
      validateSlot(slot);
      for (const entry of slot.entries) {
        if (ids.has(entry.id)) fail('記録IDがページをまたいで重複しています');
        ids.add(entry.id);
        count += 1;
      }
    }
    if (count > MAX_ENTRIES) fail('記録は最大' + MAX_ENTRIES + '件までです');
    return slots;
  }
  function newSlots() {
    return Array.from({ length: SLOT_COUNT }, () => newSlot());
  }
  function allEntries(slots) {
    validateSlots(slots);
    return slots.flatMap((slot) => slot.entries);
  }
  function locate(slots, id) {
    const indexes = [];
    for (let i = 0; i < slots.length; i += 1) {
      if (slots[i].entries.some((entry) => entry.id === id)) indexes.push(i);
    }
    if (indexes.length !== 1) fail('対象の記録が見つかりません');
    return indexes[0];
  }
  function replaced(slots, slotIndex, nextSlot) {
    validateSlot(nextSlot);
    const next = [...slots];
    next[slotIndex] = nextSlot;
    validateSlots(next);
    return { slots: next, slotIndex: slotIndex };
  }
  function add(slots, entry) {
    validateSlots(slots);
    validateEntry(entry);
    if (allEntries(slots).some((existing) => existing.id === entry.id)) fail('同じ記録IDがあります');
    const candidates = slots.map((slot, i) => {
      const next = { version: VERSION, entries: [...slot.entries, entry] };
      return { i: i, next: next, size: byteSize(next), existingSize: byteSize(slot) };
    }).filter((item) => item.size <= MAX_SLOT_BYTES);
    if (!candidates.length) fail('保存容量の上限です。古い記録を整理してください');
    candidates.sort((a, b) => a.existingSize - b.existingSize || a.i - b.i);
    return replaced(slots, candidates[0].i, candidates[0].next);
  }
  function update(slots, entry) {
    validateSlots(slots);
    validateEntry(entry);
    const slotIndex = locate(slots, entry.id);
    const next = { version: VERSION, entries: slots[slotIndex].entries.map(
      (previous) => previous.id === entry.id ? entry : previous
    ) };
    return replaced(slots, slotIndex, next);
  }
  function remove(slots, id) {
    validateSlots(slots);
    const slotIndex = locate(slots, id);
    return replaced(slots, slotIndex, {
      version: VERSION, entries: slots[slotIndex].entries.filter((entry) => entry.id !== id)
    });
  }
  function toggleFavorite(slots, id) {
    validateSlots(slots);
    const slotIndex = locate(slots, id);
    return replaced(slots, slotIndex, {
      version: VERSION, entries: slots[slotIndex].entries.map((entry) =>
        entry.id === id ? { ...entry, favorite: !entry.favorite } : entry)
    });
  }
  function parsePrice(value) {
    if (value === '') return null;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
      fail('価格は半角数字で入力してください');
    }
    return price(Number(value));
  }
  function search(slots, query, favoritesOnly, sort) {
    const entries = allEntries(slots);
    if (typeof query !== 'string') fail('検索文字列が不正です');
    if (typeof favoritesOnly !== 'boolean') fail('絞り込み指定が不正です');
    if (sort !== 'recent' && sort !== 'rating') fail('並び順が不正です');
    const keyword = query.trim().normalize('NFKC').toLocaleLowerCase('ja');
    const filtered = entries.filter((entry) => {
      if (favoritesOnly && !entry.favorite) return false;
      return [entry.shop, entry.area, entry.dish, entry.note]
        .join(' ').normalize('NFKC').toLocaleLowerCase('ja').includes(keyword);
    });
    filtered.sort((a, b) => sort === 'rating'
      ? b.rating - a.rating || b.visitedAt.localeCompare(a.visitedAt) || b.id.localeCompare(a.id)
      : b.visitedAt.localeCompare(a.visitedAt) || b.id.localeCompare(a.id));
    return filtered;
  }
  function stats(slots) {
    const entries = allEntries(slots);
    return {
      visits: entries.length,
      shops: new Set(entries.map((entry) => entry.shop)).size,
      favorites: entries.filter((entry) => entry.favorite).length
    };
  }
  const api = Object.freeze({
    VERSION, SLOT_COUNT, MAX_ENTRIES, MAX_SLOT_BYTES, newSlots, validateEntry, validateSlot,
    validateSlots, allEntries, add, update, remove, toggleFavorite, parsePrice, search, stats, date
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChukaMemo = api;
})(typeof window === 'undefined' ? globalThis : window);
