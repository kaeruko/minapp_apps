'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1, 'The app must remain a single self-contained HTML file.');

function harness() {
  class Element {
    constructor() {
      this.value = '';
      this.disabled = false;
      this.textContent = '';
      this.className = '';
      this.listeners = new Map();
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const elements = Object.fromEntries(ids.map((id) => [id, new Element()]));
  elements.track.value = 'jupiter';
  const oscillators = [];
  const sources = [];
  const errors = [];
  const intervals = new Map();
  let intervalId = 0;
  let micCalls = 0;
  let streamStops = 0;
  let decodeCalls = 0;
  let resumeCalls = 0;
  let clockMilliseconds = 10000;
  function node() {
    return {
      starts: [], stops: [], disconnected: false, listeners: new Map(),
      connect(destination) { return destination; },
      disconnect() { this.disconnected = true; },
      start(when) { this.starts.push(when); },
      stop(when) { this.stops.push(when); },
      addEventListener(name, callback) { this.listeners.set(name, callback); },
    };
  }
  function parameter() {
    return { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  }
  const context = {
    state: 'running', currentTime: 10, destination: {},
    async resume() { resumeCalls += 1; this.state = 'running'; },
    createOscillator() {
      const oscillator = node();
      oscillator.frequency = {
        setValueAtTime(value) { oscillator.hz = value; },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain() { return { ...node(), gain: parameter() }; },
    createBufferSource() {
      const source = node();
      sources.push(source);
      return source;
    },
    async decodeAudioData(encoded) {
      decodeCalls += 1;
      assert.ok(encoded.byteLength > 0);
      return { duration: 40.6 };
    },
  };
  class Recorder {
    constructor() { this.mimeType = 'audio/webm'; this.state = 'inactive'; this.listeners = new Map(); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    start() { this.state = 'recording'; }
    stop() {
      assert.equal(this.state, 'recording');
      this.state = 'inactive';
      this.listeners.get('dataavailable')({ data: new Blob(['voice'], { type: this.mimeType }) });
      this.listeners.get('stop')();
    }
  }
  const navigator = { mediaDevices: { async getUserMedia(constraints) {
    micCalls += 1;
    assert.deepEqual(JSON.parse(JSON.stringify(constraints)), { audio: true, video: false });
    return { getTracks: () => [{ stop() { streamStops += 1; } }] };
  } } };
  const window = {
    AudioContext: function () { return context; },
    MediaRecorder: Recorder,
    addEventListener() {},
  };
  const sandbox = vm.createContext({
    window, navigator, MediaRecorder: Recorder, Blob, HTMLElement: Element,
    document: { getElementById: (id) => elements[id] },
    console: { error(error) { errors.push(error); } },
    performance: { now: () => clockMilliseconds },
    setInterval(callback) { intervals.set(++intervalId, callback); return intervalId; },
    clearInterval(id) { intervals.delete(id); },
  });
  vm.runInContext(scripts[0][1], sandbox, { filename: 'sing_along/index.html' });
  return {
    run: (code) => vm.runInContext(code, sandbox),
    elements, oscillators, sources, errors, context, navigator, intervals,
    counts: () => ({ micCalls, streamStops, decodeCalls, resumeCalls }),
    tick(time, audioTime = time) {
      clockMilliseconds = time * 1000;
      context.currentTime = audioTime;
      for (const callback of [...intervals.values()]) callback();
    },
  };
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const hz = (note) => 440 * 2 ** ((note - 69) / 12);

test('Jupiter is selectable, fits one minute, and uses matching melody/accompaniment lengths', () => {
  const app = harness();
  assert.match(html, /<option value="jupiter">木星/);
  assert.equal(app.run('scoreBeats(TRACKS.jupiter)'), 49);
  near(app.run('trackDurationSeconds()'), 51 * 60 / 76 + 0.15);
  assert.match(app.elements.limit.textContent, /00:41/);
  assert.equal(app.counts().micCalls, 0);
  assert.equal(app.errors.length, 0);
});

test('Jupiter schedules the original pickup and dotted rhythm after two cues, ending on Eb', async () => {
  const app = harness();
  const start = await app.run('startBgm()');
  const beat = 60 / 76;
  const melody = app.oscillators.filter((oscillator) => oscillator.type === 'triangle');
  for (const [index, note] of [55, 58, 60, 63, 62, 58].entries()) near(melody[index].hz, hz(note));
  near(melody[0].starts[0], start + 2 * beat);
  near(melody[2].starts[0], start + 3 * beat);
  near(melody[3].starts[0] - melody[2].starts[0], 1.5 * beat);
  near(melody[5].starts[0] - melody[4].starts[0], 0.75 * beat);
  near(melody.at(-1).hz, hz(63));
  const end = start + app.run('trackDurationSeconds()');
  for (const oscillator of app.oscillators) {
    assert.ok(Number.isFinite(oscillator.hz) && oscillator.hz > 0);
    assert.ok(oscillator.starts[0] >= start);
    assert.ok(oscillator.stops[0] <= end, 'No scheduled tone may extend beyond the song.');
  }
});

test('Mozart 25 keeps the score syncopation, arpeggio and three repeats within its duration', async () => {
  const app = harness();
  assert.match(html, /<option value="mozart-25">交響曲第25番/);
  app.elements.track.value = 'mozart-25';
  app.run('updateTrackInfo()');
  assert.equal(app.run('scoreBeats(currentTrack())'), 64);
  near(app.run('trackDurationSeconds()'), 32.025);
  assert.match(app.elements.limit.textContent, /00:33/);

  const start = await app.run('startBgm()');
  const beat = 60 / 128;
  const melody = app.oscillators.filter((oscillator) => oscillator.type === 'triangle');
  // IMSLP's opening five bars, down one octave: G4, D4, Eb4, F#3,
  // then G3-Bb3-D4-G4-Bb4-A4-G4-F#4-G4.
  assert.equal(melody.length, 88);
  for (let repeat = 0; repeat < 3; repeat += 1) {
    const offset = repeat * 29;
    const phraseStart = start + (4 + repeat * 20) * beat;
    for (const [bar, note] of [67, 62, 63, 54].entries()) {
      for (const [index, onset] of [0, 0.5, 1.5, 2.5, 3.5].entries()) {
        const tone = melody[offset + bar * 5 + index];
        near(tone.hz, hz(note));
        near(tone.starts[0], phraseStart + (bar * 4 + onset) * beat);
      }
    }
    const notes = [55, 58, 62, 67, 70, 69, 67, 66, 67];
    const onsets = [0, 0.5, 1, 1.5, 2, 2.25, 2.5, 2.75, 3];
    for (const [index, note] of notes.entries()) {
      near(melody[offset + 20 + index].hz, hz(note));
      near(melody[offset + 20 + index].starts[0], phraseStart + (16 + onsets[index]) * beat);
    }
  }
  near(melody.at(-1).hz, hz(67));
  near(melody.at(-1).starts[0], start + 64 * beat);
  const end = start + app.run('trackDurationSeconds()');
  for (const oscillator of app.oscillators) {
    assert.ok(oscillator.starts[0] >= start);
    assert.ok(oscillator.stops[0] <= end, 'All tones must finish before the Mozart recording limit.');
  }
  assert.equal(app.counts().micCalls, 0);
  assert.equal(app.errors.length, 0);
});

test('Mozart recording uses its own song limit and keeps that song until the take is deleted', async () => {
  const app = harness();
  app.elements.track.value = 'mozart-25';
  app.run('updateTrackInfo()');
  await app.run('startRecording()');
  app.tick(42);
  assert.equal(app.run('recorder.state'), 'recording');
  app.tick(43);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.run('recorder.state'), 'inactive');
  assert.equal(app.counts().streamStops, 1);
  assert.equal(app.elements.track.disabled, true);
  assert.equal(app.elements.play.disabled, false);
  assert.equal(app.intervals.size, 0);
  app.run('deleteRecording()');
  assert.equal(app.elements.track.disabled, false);
  app.elements.track.value = 'jupiter';
  app.run('updateTrackInfo()');
  near(app.run('trackDurationSeconds()'), 51 * 60 / 76 + 0.15);
  assert.equal(app.errors.length, 0);
});

test('Clair de lune preserves the opening rest, tied melody and duplets after three compound pulses', async () => {
  const app = harness();
  assert.match(html, /<option value="clair-de-lune">月の光/);
  app.elements.track.value = 'clair-de-lune';
  app.run('updateTrackInfo()');
  assert.equal(app.run('scoreBeats(currentTrack())'), 37.5);
  near(app.run('trackDurationSeconds()'), 35.15);
  assert.match(app.elements.limit.textContent, /00:36/);

  const start = await app.run('startBgm()');
  const beat = 60 / 72;
  const cues = app.oscillators.filter((tone) => tone.hz === hz(79));
  assert.equal(cues.length, 3);
  for (const [index, cue] of cues.entries()) near(cue.starts[0], start + index * 1.5 * beat);

  const melody = app.oscillators.filter((tone) => tone.type === 'triangle');
  // Upper voice, bars 1-4, one octave lower. Cross-bar ties and the
  // bar-3 duplets make several note lengths cross the usual beat grid.
  const pitches = [56, 68, 65, 63, 65, 63, 61, 63, 61, 65, 61, 60, 61, 60];
  const onsets = [0.5, 1, 3, 5, 5.5, 6, 9.5, 10, 10.5, 11.25, 12.75, 14, 14.5, 15];
  assert.equal(melody.length, 29, 'Rests must advance time without creating an oscillator.');
  for (let repeat = 0; repeat < 2; repeat += 1) {
    for (const [index, pitch] of pitches.entries()) {
      const tone = melody[repeat * pitches.length + index];
      near(tone.hz, hz(pitch));
      near(tone.starts[0], start + (4.5 + repeat * 18 + onsets[index]) * beat);
    }
  }
  near(melody[2].stops[0], melody[2].starts[0] + 2 * beat * 0.96 + 0.03);
  near(melody[5].stops[0], melody[5].starts[0] + 3.5 * beat * 0.96 + 0.03);
  near(melody.at(-1).hz, hz(61));
  near(melody.at(-1).starts[0], start + 40.5 * beat);

  const music = app.oscillators.filter((tone) => !cues.includes(tone));
  const end = start + app.run('trackDurationSeconds()');
  for (const tone of music) {
    assert.ok(tone.starts[0] >= start + 5 * beat, 'Both parts must honor the opening rest.');
    assert.ok(tone.stops[0] <= end, 'No note may exceed the song end.');
  }
  assert.equal(app.counts().micCalls, 0);
  assert.equal(app.errors.length, 0);
});

test('Clair de lune recording stops at its own duration and replays the selected song', async () => {
  const app = harness();
  app.elements.track.value = 'clair-de-lune';
  app.run('updateTrackInfo()');
  await app.run('startRecording()');
  app.tick(45.1);
  assert.equal(app.run('recorder.state'), 'recording');
  app.tick(45.3);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.run('recorder.state'), 'inactive');
  assert.equal(app.counts().streamStops, 1);
  assert.equal(app.elements.track.disabled, true);
  assert.equal(app.elements.play.disabled, false);
  const previousTones = app.oscillators.length;
  await app.run('playRecording()');
  const voiceStart = app.sources[0].starts[0];
  const cueStart = app.oscillators[previousTones].starts[0];
  near(cueStart - voiceStart, 0.05);
  const replayMelody = app.oscillators.slice(previousTones).filter((tone) => tone.type === 'triangle');
  near(replayMelody[0].hz, hz(56));
  near(replayMelody[0].starts[0], cueStart + 5 * 60 / 72);
  app.sources[0].listeners.get('ended')();
  assert.equal(app.elements.stop.disabled, true);
  app.run('deleteRecording()');
  assert.equal(app.elements.track.disabled, false);
  assert.equal(app.errors.length, 0);
});

test('only explicit null rests and valid count-in pulse lengths are accepted', () => {
  const app = harness();
  assert.equal(app.run('scoreBeats({ ...TRACKS.jupiter, melody: [[null, 1]], harmony: [[null, 1]] })'), 1);
  for (const mutation of [
    'melody: [[undefined, 1]]',
    'melody: [["rest", 1]]',
    'melody: [[null, 0]]',
    'harmony: [[[], 1]]',
    'harmony: [[[null], 1]]',
    'countInPulseBeats: null',
    'countInPulseBeats: 0',
    'countInPulseBeats: NaN',
    'countInPulseBeats: "1.5"',
    'leadInBeats: 1.25',
  ]) assert.throws(() => app.run(`trackDurationSeconds({ ...TRACKS.jupiter, ${mutation} })`));
  assert.equal(app.oscillators.length, 0);
  assert.equal(app.counts().micCalls, 0);
});

test('preview stops at the song end without opening the microphone', async () => {
  const app = harness();
  await app.run('previewBgm()');
  assert.equal(app.elements.track.disabled, true);
  app.tick(50);
  assert.equal(app.elements.stop.disabled, false);
  app.tick(51);
  assert.equal(app.elements.stop.disabled, true);
  assert.equal(app.elements.track.disabled, false);
  assert.equal(app.intervals.size, 0);
  assert.ok(app.oscillators.every((oscillator) => oscillator.disconnected));
  assert.equal(app.counts().micCalls, 0);
});

test('the three existing backing tracks retain their 60-second loops', async () => {
  for (const id of ['sparkle', 'after-school', 'idol-step']) {
    const app = harness();
    app.elements.track.value = id;
    app.run('updateTrackInfo()');
    assert.equal(app.run('trackDurationSeconds()'), 60);
    await app.run('previewBgm()');
    const root = app.run('currentTrack().root');
    near(app.oscillators[0].hz, hz(root));
    app.tick(69);
    assert.equal(app.elements.stop.disabled, false);
    app.tick(71);
    assert.equal(app.elements.stop.disabled, true);
    assert.equal(app.errors.length, 0);
  }
});

test('the time limit still stops recording if the audio clock suspends', async () => {
  const app = harness();
  await app.run('startRecording()');
  app.context.state = 'suspended';
  app.tick(51, 10);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.run('recorder.state'), 'inactive');
  assert.equal(app.counts().streamStops, 1);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.errors.length, 0);
});

test('recording stops at the song end and replay preserves the voice/BGM offset', async () => {
  const app = harness();
  await app.run('startRecording()');
  near(app.run('recordingBgmOffsetSeconds'), 0.05);
  app.tick(51);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(app.counts(), { micCalls: 1, streamStops: 1, decodeCalls: 1, resumeCalls: 0 });
  assert.equal(app.elements.play.disabled, false);
  assert.equal(app.elements.track.disabled, true, 'A recording must keep its original song.');
  const previousTones = app.oscillators.length;
  await app.run('playRecording()');
  const voiceStart = app.sources[0].starts[0];
  const bgmStart = app.oscillators[previousTones].starts[0];
  near(bgmStart - voiceStart, 0.05);
  app.sources[0].listeners.get('ended')();
  assert.equal(app.elements.stop.disabled, true);
  app.run('deleteRecording()');
  assert.equal(app.elements.track.disabled, false);
  assert.equal(app.elements.play.disabled, true);
  assert.equal(app.errors.length, 0);
});

test('invalid score data fails before audio scheduling or microphone access', async () => {
  const app = harness();
  for (const mutation of [
    'melody: [[NaN, 1]]',
    'melody: [[128, 1]]',
    'melody: [[60, 0]]',
    'harmony: [[[60], 1]]',
    'bpm: 0',
    'bpm: 1',
    'leadInBeats: -1',
  ]) assert.throws(() => app.run(`trackDurationSeconds({ ...TRACKS.jupiter, ${mutation} })`));
  assert.throws(() => app.run('trackDurationSeconds({ kind: "unknown" })'), /Unknown track kind/);
  app.elements.track.value = 'missing';
  await app.run('startRecording()');
  assert.equal(app.oscillators.length, 0);
  assert.equal(app.counts().micCalls, 0);
  assert.equal(app.errors.length, 1);
  assert.match(app.elements.status.textContent, /Unknown track: missing/);
});

test('an audio error is preserved and stops playback without another backend', async () => {
  const app = harness();
  const original = new Error('Synthetic audio device failure');
  app.context.state = 'suspended';
  app.context.resume = async () => { throw original; };
  await app.run('previewBgm()');
  assert.equal(app.errors[0], original);
  assert.match(app.elements.status.textContent, /Synthetic audio device failure/);
  assert.equal(app.oscillators.length, 0);
  assert.equal(app.intervals.size, 0);
  assert.equal(app.counts().micCalls, 0);
});
