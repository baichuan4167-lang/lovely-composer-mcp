'use strict';
/**
 * Lovely Composer (.jsonl) format engine.
 *
 * Reverse-engineered from the shipped application sources:
 *   app/lcl/__init__.py   -> data model, LCJSONEncoder, json_loader_hook
 *   app/lcl/common.py     -> VOICE_STR_LIST / VOICE_NAME_DICT / SCALE_NAME_LIST
 *
 * Serialization is a literal `obj.__dict__` dump tagged with the class name:
 *   {"__LCVoice__": true, "n": 60, "t": 1, "v": 4, "f": 0, "id": 2, "x": 12, "p": 0, "e": 0}
 * On load LC builds a default instance and merges the dict over it
 * (`obj.__dict__ |= dic`), so omitted keys keep LC's own defaults.
 *
 * A song file holds exactly two lines:
 *   line 1 -> LCMusicDataHeader   {"__LCMusicDataHeader__": true, ...}
 *   line 2 -> LCMusic             {"__LCMusic__": true, ...}
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------- constants

const LC_DATA_VERSION = 16;
const LC_APP_VERSION = '2.0.0';
const LC_APP_NAME = 'Lovely Composer';

const MAX_MUSIC_NUM = 100;
const MAX_SOUND_LENGTH = 32; // ticks in one page
const DEFAULT_MUSIC_PAGES = 16;
const DEFAULT_MUSIC_SPEED = 30;
const MAX_TEMPO_SPEED = 75;

const USER_MUSIC_NORMAL_CHANNEL_COUNT = 4;
const USER_MUSIC_CHORD_CHANNEL_COUNT = 1;
const USER_MUSIC_CHANNEL_COUNT = 5;
const USER_MUSIC_CHORD_CHANNEL = 4; // channel index of the chord track

const USER_MIN_NOTE_KEY_CODE = 21; // A0
const USER_MAX_NOTE_KEY_CODE = 108; // C8
const SYSTEM_MIN_NOTE_KEY_CODE = 12;
const SYSTEM_MAX_NOTE_KEY_CODE = 127;

const VOICE_MAX_VOLUME = 7;
const VOICE_MAX_EXPRESSION = 15;
const VOICE_DEFAULT_VOLUME = 5;
const VOICE_DEFAULT_PAN = 0;
const VOICE_DEFAULT_ENVELOPE = 0;
const EXPRESSION_NORMAL_LEVEL = 12; // 'C'

const VOICE_ID_EXTENSION_LINE = 128;
const VOICE_ID_FADEOUT_EXTENSION = 129;
const VOICE_ID_FADEIN_EXTENSION = 130;
const MIN_CHORD_VOICE_ID = 65536;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_TO_SHARP = { CB: 'B', DB: 'C#', EB: 'D#', FB: 'E', GB: 'F#', AB: 'G#', BB: 'A#' };

/** Oscillator letters, indexed by LCVoice.t (TONE_NAME_LIST). */
const TONE_NAMES = ['T', 'S', 'P', 'N', 'A', 'I', 'F', 'U', 'L', 'D', 'O', 'H',
  '=', '>', '<', 'W', 'X', 'Y', 'Z'];

/** Effect letters, indexed by LCVoice.f (EFFECT_NAME_LIST). */
const EFFECT_NAMES = ['N', 'S', 'V', 'F', 'I', 'D', 'H', 'T', 'A', 'W', 'O', 'P', '*', '-', '+', 'E'];
const EFFECT_INFO = {
  N: 'none', S: 'slur (slide into next note)', V: 'vibrato', F: 'fade out', I: 'fade in',
  D: 'drop', H: 'hop', T: 'twice drop', A: 'fast arpeggio', W: 'twice fade out',
  O: 'orchestra hit', P: 'phaser', '*': 'tremolo', '-': 'slow drop', '+': 'slow hop', E: 'user edit',
};

const HEX_NAMES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

const OSCILLATOR_INFO = {
  P: 'pulse 25%', S: 'square', T: 'triangle', N: 'noise', A: 'sawtooth', I: 'sine',
  F: 'short-freq noise', U: 'pulse 12.5%', L: 'low-reso triangle', D: 'tilted saw',
  O: 'organ-like', H: 'phaser triangle', '=': 'stretch/extend', '>': 'stretch fade-out',
  '<': 'stretch fade-in', W: 'wave memory A', X: 'wave memory B', Y: 'wave memory C', Z: 'wave memory D',
};

/** Chord kinds accepted on the chord channel; index matches LC's CHORD_NAME_LIST. */
const CHORD_TYPES = {
  mute: 0, major: 1, minor: 2, sus4: 3, aug: 4, dim: 5,
  maj: 1, min: 2, m: 2,
};

/**
 * Instrument presets: LCVoice.id -> its default parameters.
 * Derived from `VOICE_STR_LIST` after LC's own expression/pan post-processing:
 *   ":T4N0::30" becomes ":T4N" + "C" + "0" + "0::30"  ->  tone T, vol 4, fx N, expr C, pan 0, env 0
 * Verified against real project files.
 * Fields: [tone, volume, effect, envelope, display name]
 */
const INSTRUMENT_TABLE = [
  [0, 'P', 4, 'N', 0, 'Pulse wave'],
  [1, 'T', 3, 'N', 0, 'Triangle wave'],
  [2, 'S', 4, 'N', 0, 'Square wave'],
  [3, 'N', 4, 'N', 0, 'Noise'],
  [4, 'P', 5, 'F', 1, 'Piano like'],
  [5, 'T', 3, 'F', 1, 'Xylophone like'],
  [6, 'S', 5, 'F', 1, 'Ice'],
  [7, 'N', 4, 'F', 3, 'Drum like'],
  [8, 'P', 4, 'V', 0, 'Strings like'],
  [9, 'T', 3, 'V', 0, 'Vocal like'],
  [10, 'S', 5, 'V', 0, 'UFO'],
  [11, 'N', 4, 'V', 0, 'unused (11)'],
  [12, 'P', 4, 'S', 0, 'Slide pulse'],
  [13, 'T', 3, 'S', 0, 'Slide triangle'],
  [14, 'S', 4, 'S', 0, 'Slide square'],
  [15, 'N', 4, 'S', 0, 'Slide noise'],
  [16, 'A', 4, 'N', 0, 'Sawtooth wave'],
  [17, 'A', 5, 'F', 1, 'Synth piano'],
  [18, 'A', 4, 'V', 0, 'Brass like'],
  [19, 'A', 4, 'S', 0, 'Slide sawtooth'],
  [20, 'I', 3, 'N', 0, 'Sine wave'],
  [21, 'I', 3, 'F', 1, 'Orgel like'],
  [22, 'I', 3, 'V', 0, 'Ghost'],
  [23, 'I', 3, 'S', 0, 'Slide sine'],
  [24, 'S', 4, 'I', 5, 'Fish'],
  [25, 'T', 3, 'I', 5, 'Flute like'],
  [26, 'P', 4, 'I', 5, 'Slow string like'],
  [27, 'A', 4, 'I', 5, 'Saxophone like'],
  [28, 'I', 3, 'I', 5, 'Ocarina like'],
  [29, 'N', 4, 'I', 7, 'Seashore like'],
  [30, 'T', 4, 'D', 3, 'Stomp'],
  [31, 'T', 3, 'T', 0, 'Twin stomp'],
  [32, 'N', 4, 'W', 0, 'Twin drum'],
  [33, 'N', 4, 'H', 3, 'Punch'],
  [34, 'P', 5, 'O', 3, 'Orchestra hit'],
  [35, 'F', 4, 'N', 0, 'Short freq noise'],
  [36, 'F', 4, 'F', 3, 'Hammer'],
  [37, 'F', 4, 'I', 5, 'Robot'],
  [38, 'F', 4, 'S', 0, 'Slide s-freq noise'],
  [39, 'U', 4, 'N', 0, '12.5% pulse'],
  [40, 'U', 4, 'F', 1, 'Lo-fi piano'],
  [41, 'U', 4, 'I', 5, 'Fiddle'],
  [42, 'U', 4, 'S', 0, 'Slide 12.5% pulse'],
  [43, 'P', 4, 'D', 3, 'Dog'],
  [44, 'U', 4, 'D', 0, 'Dog2'],
  [45, 'S', 4, 'D', 3, 'Robo stomp'],
  [46, 'U', 4, 'V', 0, 'Pulse brass'],
  [47, 'L', 4, 'N', 0, 'Low-reso triangle'],
  [48, 'L', 4, 'F', 1, 'Low-reso xylophone'],
  [49, 'L', 4, 'V', 0, 'Low-reso vocal'],
  [50, 'L', 4, 'S', 0, 'Slide low-reso triangle'],
  [51, 'L', 4, 'I', 5, 'Low-reso flute'],
  [52, 'D', 4, 'N', 0, 'Tilted sawtooth'],
  [53, 'O', 4, 'N', 0, 'Organ like wave'],
  [54, 'H', 4, 'N', 0, 'Phaser triangle'],
  [55, 'D', 4, 'F', 1, 'Banjo like'],
  [56, 'O', 4, 'F', 1, 'Bell like'],
  [57, 'H', 4, 'F', 1, 'Star'],
  [58, 'D', 4, 'V', 0, 'Oboe like'],
  [59, 'O', 4, 'V', 0, 'Opera choir like'],
  [60, 'D', 4, 'I', 5, 'Country home'],
  [61, 'O', 4, 'I', 5, 'Accordion like'],
  [62, 'H', 4, 'I', 5, 'Planet'],
  [63, 'L', 3, 'H', 0, 'Bubble'],
  [64, 'O', 4, 'S', 0, 'Slide organ like'],
  [65, 'D', 4, 'S', 0, 'Slide tilted saw'],
  [66, 'L', 4, '-', 3, 'Alien'],
  [67, 'T', 4, '-', 3, 'Melodic tom'],
  [68, 'S', 4, 'A', 0, 'Fast arp. square'],
  [69, 'P', 4, 'A', 0, 'Fast arp. pulse'],
  [70, 'U', 4, 'A', 0, 'Fast arp. 12.5% pulse'],
  [71, 'L', 3, 'A', 0, 'Fast arp. low-reso triangle'],
  [72, 'I', 3, 'A', 0, 'Fast arp. sine'],
  [73, 'D', 4, 'A', 0, 'Fast arp. tilted saw'],
  [74, 'N', 4, 'A', 0, 'Fast arp. noise'],
  [120, 'W', 4, 'N', 0, 'Edit tone A (wave memory)'],
  [121, 'X', 4, 'N', 0, 'Edit tone B (wave memory)'],
  [122, 'Y', 4, 'N', 0, 'Edit tone C (wave memory)'],
  [123, 'Z', 4, 'N', 0, 'Edit tone D (wave memory)'],
];

const INSTRUMENTS = new Map(); // id -> { id, tone, volume, effect, envelope, name }
for (const [id, tone, volume, effect, envelope, name] of INSTRUMENT_TABLE) {
  INSTRUMENTS.set(id, { id, tone, volume, effect, envelope, name });
}

/** Normalized name -> id, so `@flute` works as well as `@25`. */
const INSTRUMENT_BY_NAME = new Map();
for (const inst of INSTRUMENTS.values()) {
  const key = inst.name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!INSTRUMENT_BY_NAME.has(key)) INSTRUMENT_BY_NAME.set(key, inst);
  INSTRUMENT_BY_NAME.set(String(inst.id), inst);
}
// A few ergonomic aliases for the most useful sounds.
const INSTRUMENT_ALIASES = {
  piano: 4, epiano: 4, bass: 47, lead: 0, square: 2, pulse: 0, triangle: 1, sine: 20,
  saw: 16, sawtooth: 16, noise: 3, drum: 7, kick: 30, snare: 33, hat: 35, tom: 67,
  strings: 8, string: 8, brass: 18, flute: 25, organ: 21, bell: 56, guitar: 55,
  banjo: 55, oboe: 58, sax: 27, accordion: 61, choir: 59, vocal: 9, alien: 66,
  bubble: 63, robot: 37, seashore: 29, arp: 68, fastarp: 68,
};
for (const [alias, id] of Object.entries(INSTRUMENT_ALIASES)) {
  if (!INSTRUMENT_BY_NAME.has(alias)) INSTRUMENT_BY_NAME.set(alias, INSTRUMENTS.get(id));
}

const SCALE_NAMES = [
  'scale lock off', 'white keys only', 'black keys only', 'major scale', 'minor scale',
  'ryukyu scale', 'gagaku scale', 'whole tone scale', 'chord key only', 'magical scale 1',
  'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'harmonic minor',
  'melodic minor', 'major pentatonic', 'minor pentatonic', 'diminished',
  'combination of dim.', 'major blues', 'minor blues',
];

// ------------------------------------------------------------ note helpers

/** 'C4' -> 60 (LC's get_note_name uses note//12 - 1 as the octave, so C4 = 60). */
function noteNameToNumber(input) {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') return input;
  let s = String(input).trim();
  if (s === '') return null;
  if (/^r(est)?$/i.test(s)) return -1;

  let octave = 0;
  const m = /^(.*?)(-?\d+)$/.exec(s);
  let letter = s;
  if (m) {
    letter = m[1];
    octave = parseInt(m[2], 10) + 1;
  }
  const upper = letter.toUpperCase();
  const normalized = FLAT_TO_SHARP[upper] || upper;
  const idx = NOTE_NAMES.indexOf(normalized);
  if (idx < 0) return null;
  return Math.max(idx + octave * 12, -1);
}

/** 60 -> 'C4'; null / -1 -> 'R'. */
function noteNumberToName(n) {
  if (n === null || n === undefined || n === -1) return 'R';
  if (n < 0) return 'R';
  const octave = Math.floor(n / 12) - 1;
  return NOTE_NAMES[n % 12] + String(octave);
}

function toneName(t) {
  return t === null || t === undefined ? 'T' : (TONE_NAMES[t] || '?');
}
function effectName(f) {
  return f === null || f === undefined ? 'N' : (EFFECT_NAMES[f] || '?');
}
function hexName(v) {
  return v === null || v === undefined ? '0' : (HEX_NAMES[v] || '?');
}

/** Encode a chord type + options into LC's chord voice id. */
function encodeChordId(typeName, { power = 0, seventh = 0, ninth = 0 } = {}) {
  const key = String(typeName || '').toLowerCase().replace(/\s+/g, '');
  const typeIndex = CHORD_TYPES[key];
  if (typeIndex === undefined) {
    throw new Error(`unknown chord type '${typeName}'; use one of: ${Object.keys(CHORD_TYPES).filter((k) => k.length > 2).join(', ')}`);
  }
  const pickers = [power, seventh, ninth];
  let num = typeIndex;
  for (let i = 0; i < pickers.length; i += 1) num += pickers[i] << (i * 2 + 4);
  return (num << 16) + MIN_CHORD_VOICE_ID;
}

/** Decode a chord voice id back into { type, power, seventh, ninth }; null when it is not a chord. */
function decodeChordId(id) {
  if (typeof id !== 'number' || id < MIN_CHORD_VOICE_ID) return null;
  let n = Math.floor((id - MIN_CHORD_VOICE_ID) / MIN_CHORD_VOICE_ID);
  const typeIndex = n % 16;
  n = Math.floor(n / 16);
  const parts = [];
  for (let i = 0; i < 3; i += 1) { parts.push(n % 4); n = Math.floor(n / 4); }
  const typeName = ['mute', 'major', 'minor', 'sus4', 'aug', 'dim'][typeIndex] || `type${typeIndex}`;
  return { type: typeName, typeIndex, power: parts[0], seventh: parts[1], ninth: parts[2] };
}

// ---------------------------------------------------------- voice building

/**
 * Blank voice exactly as LC serializes it.
 * The `__LCVoice__` tag must come first: LC's `json_loader_hook` walks the dict
 * and rebuilds a real object from the first key that names a known class, so a
 * voice without it would come back as a plain dict and break LC.
 */
function blankVoice() {
  return { __LCVoice__: true, n: null, t: 0, v: 0, f: 0, id: null, x: EXPRESSION_NORMAL_LEVEL, p: 0, e: 0 };
}

function voiceFromPreset(presetId, noteNumber, overrides = {}) {
  const preset = INSTRUMENTS.get(presetId);
  if (!preset) throw new Error(`unknown instrument preset ${presetId}`);
  return {
    __LCVoice__: true,
    n: noteNumber,
    t: TONE_NAMES.indexOf(preset.tone),
    v: overrides.volume !== undefined ? overrides.volume : preset.volume,
    f: EFFECT_NAMES.indexOf(preset.effect),
    id: presetId,
    x: overrides.expression !== undefined ? overrides.expression : EXPRESSION_NORMAL_LEVEL,
    p: overrides.pan !== undefined ? overrides.pan : VOICE_DEFAULT_PAN,
    e: overrides.envelope !== undefined ? overrides.envelope : preset.envelope,
  };
}

/** Extension/hold voice that continues the previous note (LC's VOICE_ID_EXTENSION_LINE). */
function extensionVoice(dir) {
  let id = VOICE_ID_EXTENSION_LINE;
  if (dir === 'fadeout') id = VOICE_ID_FADEOUT_EXTENSION;
  if (dir === 'fadein') id = VOICE_ID_FADEIN_EXTENSION;
  const preset = INSTRUMENTS.get(id);
  return {
    __LCVoice__: true,
    n: null,
    t: TONE_NAMES.indexOf('='),
    v: preset ? preset.volume : 4,
    f: EFFECT_NAMES.indexOf(preset ? preset.effect : 'N'),
    id,
    x: null,
    p: 0,
    e: 0,
  };
}

function resolveInstrument(token) {
  if (token === null || token === undefined || token === '') return null;
  if (typeof token === 'number') {
    if (!INSTRUMENTS.has(token)) throw new Error(`unknown instrument preset ${token}`);
    return token;
  }
  const raw = String(token).trim();
  if (/^\d+$/.test(raw)) return resolveInstrument(parseInt(raw, 10));
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const hit = INSTRUMENT_BY_NAME.get(key);
  if (hit) return hit.id;
  throw new Error(`unknown instrument '${token}'`);
}

// --------------------------------------------------------- pattern parsing

/**
 * Parse one token of the compact pattern DSL.
 *
 *   R  .                  rest
 *   -                     hold: extend the previous note
 *   <                     hold with fade-in
 *   >                     hold with fade-out
 *   C4                    note with the channel/page default instrument
 *   C4@25                 note with instrument preset 25 (numeric id or name)
 *   C4@flute*6+D          ... volume 6, effect D
 *   C4:S4NC00::25         LC's own native voice string (used verbatim)
 *
 * Modifiers: *volume(0-7) +effect(letter) ^expression(0-F) ~pan(0-F) %envelope(0-F)
 */
function parsePatternToken(token, defaults = {}) {
  const raw = String(token).trim();
  if (raw === '' || raw === '.' || /^r(est)?$/i.test(raw)) return { kind: 'rest' };

  if (raw === '-') return { kind: 'voice', voice: extensionVoice(null), hold: true };
  if (raw === '<') return { kind: 'voice', voice: extensionVoice('fadein'), hold: true };
  if (raw === '>') return { kind: 'voice', voice: extensionVoice('fadeout'), hold: true };

  // Native LC voice string, e.g. "C4:S4NC00::25" or ":P4NC00::0"
  if (raw.includes(':')) {
    const parsed = parseNativeVoiceString(raw);
    if (!parsed) throw new Error(`cannot parse voice string '${token}'`);
    return { kind: 'voice', voice: parsed };
  }

  const m = /^([A-Ga-g][#b]?-?\d+)(.*)$/.exec(raw);
  if (!m) throw new Error(`cannot parse token '${token}'`);
  const noteNumber = noteNameToNumber(m[1]);
  if (noteNumber === null) throw new Error(`bad note name '${m[1]}'`);

  let rest = m[2] || '';
  let presetId = defaults.instrument;
  const at = /^@([A-Za-z0-9_]+)/.exec(rest);
  if (at) {
    presetId = resolveInstrument(at[1]);
    rest = rest.slice(at[0].length);
  }
  if (presetId === null || presetId === undefined) {
    throw new Error(`token '${token}' has no instrument; pass instrument=... or use note@preset`);
  }

  const overrides = readModifiers(rest, token);

  const voice = voiceFromPreset(presetId, noteNumber, overrides);
  if (overrides.effect !== undefined) {
    const fx = EFFECT_NAMES.indexOf(overrides.effect);
    if (fx < 0) throw new Error(`bad effect '${overrides.effect}' in token '${token}'`);
    voice.f = fx;
  }
  return { kind: 'voice', voice };
}

/**
 * Read the trailing modifiers of a note token, in any order:
 *   *0-7 volume   +L effect letter   ^0-F expression   ~0-F pan   %0-F envelope
 * `*` always means volume and must be followed by a digit, so the tremolo effect
 * letter `*` stays reachable as `+*`.
 */
function readModifiers(rest, token) {
  const out = {};
  let i = 0;
  const fail = (what) => { throw new Error(`bad ${what} in token '${token}'`); };
  while (i < rest.length) {
    const c = rest[i];
    const d = rest[i + 1];
    if (c === '*') {
      if (!/^[0-7]$/.test(d || '')) fail('volume (expected *0-*7)');
      out.volume = Number(d);
    } else if (c === '+') {
      const letter = (d || '').toUpperCase();
      if (!EFFECT_NAMES.includes(letter)) fail(`effect (expected +<${EFFECT_NAMES.join('|')}>)`);
      out.effect = letter;
    } else if (c === '^' || c === '~' || c === '%') {
      if (!/^[0-9A-Fa-f]$/.test(d || '')) fail('value (expected 0-F)');
      const value = parseInt(d, 16);
      if (c === '^') out.expression = value;
      else if (c === '~') out.pan = value;
      else out.envelope = value;
    } else {
      fail(`modifier '${rest.slice(i)}'`);
    }
    i += 2;
  }
  return out;
}

/** Parse LC's own `Note:ToneVolFxExprPanEnv::PresetId` form. */
function parseNativeVoiceString(s) {
  const parts = String(s).split(':');
  if (parts.length < 4) return null;
  const notePart = parts[0].trim();
  const props = parts[1] || '';
  const idPart = parts[3];

  const voice = blankVoice();
  voice.n = notePart === '' ? null : noteNameToNumber(notePart);
  if (props.length >= 1) voice.t = TONE_NAMES.indexOf(props[0].toUpperCase());
  if (props.length >= 2) voice.v = parseInt(props[1], 10);
  if (props.length >= 3) voice.f = EFFECT_NAMES.indexOf(props[2].toUpperCase());
  if (props.length >= 4) voice.x = HEX_NAMES.indexOf(props[3].toUpperCase());
  if (props.length >= 5) voice.p = HEX_NAMES.indexOf(props[4].toUpperCase());
  if (props.length >= 6) voice.e = HEX_NAMES.indexOf(props[5].toUpperCase());
  voice.id = idPart === '' || idPart === undefined ? null : parseInt(idPart, 10);
  if (Number.isNaN(voice.id)) voice.id = null;
  return voice;
}

/** Render a voice back into LC's native string (handy for readable output). */
function voiceToNativeString(v) {
  if (v.id !== null && v.id !== undefined && v.id >= MIN_CHORD_VOICE_ID) {
    return `${noteNumberToName(v.n)}:CHORD(${JSON.stringify(decodeChordId(v.id))})`;
  }
  if (v.id === VOICE_ID_EXTENSION_LINE || v.id === VOICE_ID_FADEOUT_EXTENSION || v.id === VOICE_ID_FADEIN_EXTENSION) {
    return '~hold~';
  }
  return `${noteNumberToName(v.n)}:${toneName(v.t)}${v.v}${effectName(v.f)}${hexName(v.x)}${hexName(v.p)}${hexName(v.e)}::${v.id}`;
}

// --------------------------------------------------------------- song model

function headerObject({ title = '', editor = '', exFilename = '', writeProtected = false } = {}) {
  return {
    __LCMusicDataHeader__: true,
    data_version: LC_DATA_VERSION,
    app_version: LC_APP_VERSION,
    app_name: LC_APP_NAME,
    write_protected_flag: writeProtected,
    title,
    editor,
    ex_filename: exFilename || title,
  };
}

function rhythmObject() {
  // Mirrors LCRhythm() defaults, i.e. exactly what LC creates for a brand-new song.
  return {
    __LCRhythm__: true,
    pattern: 0,
    sub_pattern: 0,
    enable_chordpart: true,
    enable_drum: true,
    enable_base: true,
    enable_melody: true,
    bar_rhythm_rate: 0,
    bar_arpeggio_rate: 0,
    arpeggio: 0,
    arpeggio_octave: 1,
    arpeggio_length: 0,
    arpeggio_reverse: false,
  };
}

function soundObject(voices, playNotes, playSpeed) {
  return {
    __LCSound__: true,
    vl: voices,
    play_notes: playNotes,
    play_speed: playSpeed,
  };
}

/**
 * Build an empty LCMusic exactly shaped like a file LC wrote itself.
 * Keys LC fills from its own defaults in __post_init__ (wave memory,
 * sampling modulator, ...) are intentionally omitted so LC supplies them.
 */
function musicObject({ speed, pages, ticksPerPage, barsPerPage, notesByPage, tempoByPage, title, editor, exFilename, scaleId, scaleKey, enableLoop, loopStartBar, loopEndBar }) {
  const channels = [];
  for (let ch = 0; ch < USER_MUSIC_CHANNEL_COUNT; ch += 1) {
    const sl = [];
    for (let p = 0; p < pages; p += 1) {
      const voices = [];
      for (let t = 0; t < MAX_SOUND_LENGTH; t += 1) {
        const v = blankVoice();
        // The chord channel leaves expression unset, matching LC's own clear().
        if (ch === USER_MUSIC_CHORD_CHANNEL) v.x = null;
        voices.push(v);
      }
      sl.push(soundObject(voices, ticksPerPage, speed));
    }
    channels.push({ __LCSoundList__: true, sl });
  }

  const rhythms = [];
  for (let p = 0; p < pages; p += 1) rhythms.push(rhythmObject());

  return {
    __LCMusic__: true,
    speed,
    loop_start_bar: loopStartBar,
    loop_end_bar: loopEndBar,
    enable_loop: enableLoop,
    sel_scale_id: scaleId,
    channels: { __LCChannelList__: true, channels },
    rhythms: { __LCRhythmList__: true, rhythms },
    bars_number_per_page: barsPerPage,
    pages,
    notes_by_page: notesByPage,
    tempo_by_page: tempoByPage,
    play_notes: ticksPerPage,
    pro_mode: 1,
    mixer_expression_list: [0, 0, 0, 0, 0],
    mixer_output_channel_list: [0, 0, 0, 0, 0],
    mixer_channel_switch_list: [0, 0, 0, 0, 0],
    ui_mixer_expression_list: [0, 0, 0, 0, 0],
    ui_mixer_output_channel_list: [0, 0, 0, 0, 0],
    mixer_transpose: 0,
    pan_law_type: 0,
    compatibility_mode: 0,
    sel_scale_key: scaleKey,
    title,
    editor,
    ex_filename: exFilename || title,
    abrepeat_a: null,
    abrepeat_b: null,
    pianoroll_display_mode: 0,
  };
}

// ------------------------------------------------------------- file access

function firstExisting(paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

/** Locate the user's Lovely Composer data directories. */
function detectLayout() {
  const home = process.env.USERPROFILE || os.homedir();
  const candidates = [];
  const push = (p) => { if (p && !candidates.includes(p)) candidates.push(p); };

  if (process.env.LC_MUSIC_ROOT) push(process.env.LC_MUSIC_ROOT);
  for (const docRoot of [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents')]) {
    push(path.join(docRoot, 'LovelyComposer', 'music'));
  }
  for (const steam of [
    'D:/SteamLibrary/steamapps/common/LovelyComposer',
    'C:/Program Files (x86)/Steam/steamapps/common/LovelyComposer',
    'C:/Program Files/Steam/steamapps/common/LovelyComposer',
  ]) {
    push(path.join(steam, 'app', 'music'));
  }

  const musicRoot = firstExisting(candidates) || candidates[0];

  // app_settings.json points at the real data dir even when Documents is redirected.
  let userDataDir = path.dirname(musicRoot);
  for (const docRoot of [path.join(home, 'Documents', 'LovelyComposer'), path.join(home, 'OneDrive', 'Documents', 'LovelyComposer')]) {
    if (fs.existsSync(path.join(docRoot, 'app_settings.json'))) { userDataDir = docRoot; break; }
  }

  let exportDir = path.join(userDataDir, 'export');
  try {
    const raw = fs.readFileSync(path.join(userDataDir, 'app_settings.json'), 'utf8');
    const settings = JSON.parse(raw);
    if (settings.export_dir_path) exportDir = settings.export_dir_path;
    if (settings.loading_lcdata_path) {
      const p = settings.loading_lcdata_path;
      if (fs.existsSync(p)) {
        // loading_lcdata_path may point at the folder or straight at a song file
        const guess = fs.statSync(p).isDirectory() ? path.dirname(p) : path.dirname(path.dirname(p));
        if (fs.existsSync(guess) && path.basename(guess) === 'music') return finishLayout(guess, userDataDir, exportDir);
      }
    }
  } catch { /* app_settings.json is optional */ }

  return finishLayout(musicRoot, userDataDir, exportDir);
}

function finishLayout(musicRoot, userDataDir, exportDir) {
  let installDir = null;
  for (const steam of [
    'D:/SteamLibrary/steamapps/common/LovelyComposer',
    'C:/Program Files (x86)/Steam/steamapps/common/LovelyComposer',
    'C:/Program Files/Steam/steamapps/common/LovelyComposer',
  ]) {
    if (fs.existsSync(path.join(steam, 'lovely_composer.exe'))) { installDir = steam; break; }
  }
  return { musicRoot, userDataDir, exportDir, installDir };
}

function assertSafeSegment(value, what) {
  const s = String(value);
  if (s.includes('\0')) throw new Error(`${what} contains a NUL byte`);
  return s;
}

/** Resolve a folder argument: a bare folder name under the music root, or an absolute path. */
function resolveFolder(layout, folder) {
  if (!folder) throw new Error('folder is required');
  const name = assertSafeSegment(folder, 'folder');
  if (path.isAbsolute(name)) return path.normalize(name);
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new Error(`folder '${folder}' must be a plain folder name or an absolute path`);
  }
  return path.join(layout.musicRoot, name);
}

function songFileName(songNumber) {
  return `${String(songNumber).padStart(2, '0')}.jsonl`;
}

function songFilePath(layout, folder, songNumber) {
  if (!Number.isInteger(songNumber) || songNumber < 0 || songNumber >= MAX_MUSIC_NUM) {
    throw new Error(`song must be an integer in 0..${MAX_MUSIC_NUM - 1}`);
  }
  return path.join(resolveFolder(layout, folder), songFileName(songNumber));
}

/**
 * Serialize to JSON using only ASCII, escaping every non-ASCII character as \uXXXX.
 *
 * Lovely Composer reads and writes song files with Python's `open(path)` and no
 * explicit encoding, so it uses the platform's locale encoding — GBK/cp936 on a
 * Chinese Windows, cp932 on a Japanese one. A UTF-8 file containing, say, a
 * Chinese title therefore raises UnicodeDecodeError inside LC and the song fails
 * to load (`load_music` returns LOAD_RESULT_CODE_FAILED). Pure-ASCII output
 * decodes identically under every one of those encodings, and `json.loads`
 * restores the real characters from the escapes.
 */
function jsonAscii(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (ch) =>
    `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * Decode a song file's bytes. LC may have written it in the locale encoding, so
 * try strict UTF-8 first and fall back to the common CJK codepages; the first
 * candidate whose lines parse as JSON wins.
 */
function decodeSongBuffer(buf) {
  const candidates = [];
  const push = (make) => { try { candidates.push(make()); } catch { /* unusable */ } };
  push(() => new TextDecoder('utf-8', { fatal: true }).decode(buf));
  for (const enc of ['gbk', 'gb18030', 'big5', 'shift_jis']) {
    push(() => new TextDecoder(enc, { fatal: true }).decode(buf));
  }
  push(() => buf.toString('utf8'));

  let lastError = null;
  for (const text of candidates) {
    const nl = text.indexOf('\n');
    const headerLine = nl >= 0 ? text.slice(0, nl) : text;
    const bodyLine = nl >= 0 ? text.slice(nl + 1) : '';
    try {
      const header = headerLine.trim() ? JSON.parse(headerLine) : null;
      const music = bodyLine.trim() ? JSON.parse(bodyLine) : null;
      return { header, music, bodyLine };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('could not decode song file');
}

/** Read the two raw lines of a song file. */
function readSongRaw(filePath) {
  return decodeSongBuffer(fs.readFileSync(filePath));
}

/**
 * Write a song file. LC itself opens the file in Python text mode on Windows, so
 * its files use CRLF and carry no trailing newline after the body line; match that.
 * Content is ASCII-escaped so the file survives any locale encoding (see jsonAscii).
 */
function writeSongRaw(filePath, header, music) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = `${jsonAscii(header)}\r\n${jsonAscii(music)}`;
  /* eslint-disable-next-line no-control-regex */
  if (/[^\x00-\x7f]/.test(payload)) throw new Error('internal error: song payload is not pure ASCII');
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, payload, 'latin1'); // byte-transparent for ASCII
  fs.renameSync(tmp, filePath);
}

function channelList(music) {
  if (!music || !music.channels || !Array.isArray(music.channels.channels)) return null;
  return music.channels.channels;
}

function voiceList(channel, page) {
  if (!channel || !Array.isArray(channel.sl) || page < 0 || page >= channel.sl.length) return null;
  const sound = channel.sl[page];
  return sound && Array.isArray(sound.vl) ? sound.vl : null;
}

/** Summarize a song without dumping the whole structure. */
function summarizeSong(header, music) {
  const channels = channelList(music) || [];
  const perChannel = channels.map((ch, idx) => {
    let notes = 0;
    let used = new Set();
    for (const sound of ch.sl || []) {
      for (const v of sound.vl || []) {
        if (v.n !== null && v.n !== undefined) {
          notes += 1;
          if (v.id !== null && v.id !== undefined && v.id < MIN_CHORD_VOICE_ID) used.add(v.id);
        }
      }
    }
    return { channel: idx, notes, instruments: [...used].sort((a, b) => a - b) };
  });
  return {
    title: (header && header.title) || music.title || '',
    editor: (header && header.editor) || music.editor || '',
    writeProtected: Boolean(header && header.write_protected_flag),
    dataVersion: header ? header.data_version : null,
    speed: music.speed,
    pages: music.pages,
    ticksPerPage: music.play_notes,
    barsPerPage: music.bars_number_per_page,
    notesByPage: music.notes_by_page,
    tempoByPage: music.tempo_by_page,
    enableLoop: music.enable_loop,
    loopStartBar: music.loop_start_bar,
    loopEndBar: music.loop_end_bar,
    scale: SCALE_NAMES[music.sel_scale_id] || `scale ${music.sel_scale_id}`,
    scaleId: music.sel_scale_id,
    scaleKey: music.sel_scale_key,
    channels: perChannel,
  };
}

/** Human-readable chord label for a chord-track voice, e.g. "Am", "G7", "C(p)". */
function chordLabel(noteNumber, chordId) {
  const info = decodeChordId(chordId);
  if (!info) return null;
  const short = ['', '', 'm', 'sus4', 'aug', 'dim'][info.typeIndex] ?? info.type;
  // Chord names conventionally omit the octave: the root letter is enough.
  let s = NOTE_NAMES[noteNumber % 12] + short;
  if (info.seventh >= 1) s += info.seventh === 1 ? '7' : 'M7';
  if (info.ninth >= 1) s += info.ninth === 1 ? '9' : 'b9';
  if (info.power >= 1) s += '(p)';
  return s;
}

/** Render one page as a compact one-line pattern. */
function renderPage(channel, page, ticksPerPage) {
  const vl = voiceList(channel, page);
  if (!vl) return null;
  const tokens = [];
  for (let t = 0; t < vl.length; t += 1) {
    if (ticksPerPage && t >= ticksPerPage) break;
    const v = vl[t];
    if (v.id === VOICE_ID_EXTENSION_LINE) tokens.push('-');
    else if (v.id === VOICE_ID_FADEOUT_EXTENSION) tokens.push('>');
    else if (v.id === VOICE_ID_FADEIN_EXTENSION) tokens.push('<');
    else if (v.n === null || v.n === undefined || v.n < 0) tokens.push('.');
    else if (typeof v.id === 'number' && v.id >= MIN_CHORD_VOICE_ID) tokens.push(chordLabel(v.n, v.id));
    else tokens.push(noteNumberToName(v.n) + (v.id !== null && v.id !== undefined ? `@${v.id}` : ''));
  }
  return tokens.join(' ');
}

function pageHasContent(channel, page) {
  const vl = voiceList(channel, page);
  if (!vl) return false;
  return vl.some((v) => v.n !== null && v.n !== undefined);
}

module.exports = {
  LC_DATA_VERSION, LC_APP_VERSION, LC_APP_NAME,
  MAX_MUSIC_NUM, MAX_SOUND_LENGTH, DEFAULT_MUSIC_PAGES, DEFAULT_MUSIC_SPEED, MAX_TEMPO_SPEED,
  USER_MUSIC_NORMAL_CHANNEL_COUNT, USER_MUSIC_CHORD_CHANNEL, USER_MUSIC_CHANNEL_COUNT,
  USER_MIN_NOTE_KEY_CODE, USER_MAX_NOTE_KEY_CODE,
  VOICE_MAX_VOLUME, VOICE_MAX_EXPRESSION, EXPRESSION_NORMAL_LEVEL,
  VOICE_ID_EXTENSION_LINE, VOICE_ID_FADEOUT_EXTENSION, VOICE_ID_FADEIN_EXTENSION, MIN_CHORD_VOICE_ID,
  NOTE_NAMES, TONE_NAMES, EFFECT_NAMES, EFFECT_INFO, OSCILLATOR_INFO, HEX_NAMES,
  INSTRUMENTS, INSTRUMENT_BY_NAME, SCALE_NAMES, CHORD_TYPES,
  noteNameToNumber, noteNumberToName, toneName, effectName, hexName,
  encodeChordId, decodeChordId, chordLabel,
  blankVoice, voiceFromPreset, extensionVoice, resolveInstrument,
  parsePatternToken, parseNativeVoiceString, voiceToNativeString,
  headerObject, musicObject, soundObject, rhythmObject,
  detectLayout, resolveFolder, songFilePath, songFileName,
  readSongRaw, writeSongRaw, jsonAscii, decodeSongBuffer, channelList, voiceList,
  summarizeSong, renderPage, pageHasContent,
};
