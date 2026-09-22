'use strict';
/**
 * "配信中毒 - STREAM OVERDOSE"
 * Denpa / J-core / happy-hardcore chiptune in the spirit of Needy Streamer Overload.
 *
 *   node compositions/stream-overdose.js [folder] [song]
 *
 * Musical identity:
 *   - 180 BPM, F# minor (harmonic-minor V for the anime cadence)
 *   - four-on-the-floor hardcore kick with busy 16th hats
 *   - relentless 16th-note arpeggio "supersaw" wall (ch1)
 *   - bright pulse/saw lead with big leaps and chromatic pickups (ch0)
 *   - octave-jumping driving bass with slur slides (ch2)
 *   - half-time breakdown, then a drop
 *
 * Grid: barsPerPage=1 and ticksPerPage=32, so one page IS one bar and
 *       one tick is a 32nd note at 180 BPM (16th = 2 ticks, 8th = 4, beat = 8).
 */

const lc = require('../src/lc');

const FOLDER = process.argv[2] || 'DSH';
const SONG = Number(process.argv[3] || 1);

const BARS = 48;
const SPEED = 5; // bpm = 900 * barsPerPage / speed = 900 * 1 / 5 = 180
const BARS_PER_PAGE = 1;
const TICKS = 32;

const LEAD = 0;
const ARP = 1;
const BASS = 2;
const DRUM = 3;
const CHORD = 4;

// --------------------------------------------------------------- harmony

const CHORDS = {
  'F#m': { type: 'minor', root: 'F#', iv: [0, 3, 7] },
  'D': { type: 'major', root: 'D', iv: [0, 4, 7] },
  'A': { type: 'major', root: 'A', iv: [0, 4, 7] },
  'E': { type: 'major', root: 'E', iv: [0, 4, 7] },
  'Bm': { type: 'minor', root: 'B', iv: [0, 3, 7] },
  'C#': { type: 'major', root: 'C#', iv: [0, 4, 7] }, // V of harmonic minor (E# = F)
};

/** Ascending chord stack across two octaves: [r4, t4, 5th4, r5, t5, 5th5]. */
function stack(name) {
  const c = CHORDS[name];
  const base = lc.noteNameToNumber(c.root + '4');
  const low = c.iv.map((i) => lc.noteNumberToName(base + i));
  const high = c.iv.map((i) => lc.noteNumberToName(base + 12 + i));
  return [...low, ...high];
}

// 48-bar form
const PROG = [];
const section = (bars, chords) => { for (let i = 0; i < bars; i += 1) PROG.push(chords[i % chords.length]); };
section(4, ['F#m', 'D', 'A', 'E']); //  0- 3 intro
section(4, ['F#m', 'D', 'A', 'E']); //  4- 7 build
section(8, ['F#m', 'D', 'A', 'E']); //  8-15 verse
section(8, ['F#m', 'D', 'A', 'E']); // 16-23 verse (lifted)
section(8, ['Bm', 'D', 'A', 'E', 'Bm', 'C#', 'F#m', 'F#m']); // 24-31 B section
section(4, ['F#m', 'D', 'A', 'E']); // 32-35 breakdown
section(8, ['F#m', 'D', 'A', 'E']); // 36-43 chorus
section(4, ['Bm', 'C#', 'F#m', 'F#m']); // 44-47 outro
if (PROG.length !== BARS) throw new Error(`progression is ${PROG.length} bars, expected ${BARS}`);

// ------------------------------------------------------------ sequences

/** "0:C#6/6 8:B5/2" -> [{tick, note, hold}] (hold = total ticks including the note) */
function seq(s) {
  return s.trim().split(/\s+/).filter(Boolean).map((tok) => {
    const m = /^(\d+):([A-Ga-g][#b]?-?\d)(?:\/(\d+))?$/.exec(tok);
    if (!m) throw new Error(`bad sequence token "${tok}"`);
    return { tick: Number(m[1]), note: m[2], hold: m[3] ? Number(m[3]) : 1 };
  });
}

/** Lay a sequence into a 32-token bar. */
function melodyBar(s, inst, mods = '') {
  const toks = new Array(TICKS).fill('.');
  for (const { tick, note, hold } of seq(s)) {
    if (tick >= TICKS) throw new Error(`tick ${tick} out of range in "${s}"`);
    toks[tick] = `${note}@${inst}${mods}`;
    for (let i = 1; i < hold && tick + i < TICKS; i += 1) toks[tick + i] = '-';
  }
  return toks;
}

/** Bar of 16th notes from a note list; `shape` picks which note lands on each 16th. */
function sixteenths(notes, shape, inst, mods = '') {
  const toks = new Array(TICKS).fill('.');
  for (let i = 0; i < 16; i += 1) toks[i * 2] = `${notes[shape[i]]}@${inst}${mods}`;
  return toks;
}

function drums(list) {
  const toks = new Array(TICKS).fill('.');
  for (const [t, note, inst, vol] of list) {
    toks[t] = `${note}@${inst}${vol === undefined ? '' : `*${vol}`}`;
  }
  return toks;
}

function bassBar(chordName, style) {
  const c = CHORDS[chordName];
  const lo = `${c.root}2`;
  const hi = `${c.root}3`;
  const toks = new Array(TICKS).fill('.');
  if (style === 'none') return toks;

  if (style === 'eighths') {
    const shape = [0, 0, 1, 0, 0, 0, 1, 0]; // 1 = octave up
    for (let i = 0; i < 8; i += 1) {
      const n = shape[i] ? hi : lo;
      const slur = i === 7 ? '+S' : ''; // slide out of the bar into the next chord
      toks[i * 4] = `${n}@47${slur}`;
    }
  } else if (style === 'sixteenths') {
    for (let i = 0; i < 16; i += 1) {
      const up = i % 4 === 2 || i === 13;
      toks[i * 2] = up ? `${hi}@47*4` : `${lo}@47*5`;
    }
  } else if (style === 'half') {
    toks[0] = `${lo}@47`;
    toks[16] = `${lo}@47`;
  }
  return toks;
}

// drum patterns -------------------------------------------------------------

const KICK = 30; // STOMP
const SNARE = 33; // PUNCH
const HAT = 35; // SHORT FREQ NOISE
const CRASH = 3; // NOISE
const TOM = 67; // MELODIC TOM

function drumBar(style) {
  switch (style) {
    case 'none': return drums([]);
    case 'kick': return drums([[0, 'C3', KICK], [16, 'C3', KICK]]);
    case 'half':
      return drums([[0, 'C3', KICK], [8, 'D3', SNARE], [16, 'C3', KICK], [24, 'D3', SNARE]]);
    case 'drive': {
      const out = [[0, 'C3', KICK], [8, 'C3', KICK], [16, 'C3', KICK], [24, 'C3', KICK]];
      for (const t of [4, 12, 20, 28]) out.push([t, 'A5', HAT, 4]);
      for (const t of [2, 6, 10, 14, 18, 22, 26, 30]) out.push([t, 'A5', HAT, 2]);
      return drums(out);
    }
    case 'driveFill': {
      const out = [[0, 'C3', KICK], [8, 'C3', KICK], [16, 'C3', KICK]];
      for (const t of [4, 12, 20]) out.push([t, 'A5', HAT, 4]);
      for (const t of [2, 6, 10, 14, 18, 22]) out.push([t, 'A5', HAT, 2]);
      for (let t = 24; t < 32; t += 1) out.push([t, 'D3', SNARE, t % 2 === 0 ? 4 : 2]);
      return drums(out);
    }
    case 'punch': {
      // harder backbeat: no hats, snare on 2 and 4
      const out = [[0, 'C3', KICK], [8, 'D3', SNARE, 5], [16, 'C3', KICK], [24, 'D3', SNARE, 5]];
      for (const t of [4, 12, 20, 28]) out.push([t, 'A5', HAT, 3]);
      return drums(out);
    }
    case 'roll':
      return drums([...Array(16).keys()].map((i) => [i * 2, 'D3', SNARE, 2 + (i % 4)]));
    case 'break':
      return drums([[0, 'C3', KICK], [12, 'A5', HAT, 3], [20, 'D3', SNARE, 4], [28, 'A5', HAT, 3]]);
    case 'tomFill': {
      const out = [[0, 'C3', KICK], [8, 'D3', SNARE]];
      const notes = ['A3', 'C4', 'D4', 'F#4', 'A4', 'C5', 'D5', 'F#5'];
      notes.forEach((n, i) => out.push([16 + i * 2, n, TOM, 4]));
      return drums(out);
    }
    case 'hit': // crash + kick on a downbeat
      return drums([[0, 'C6', CRASH, 5], [0, 'C3', KICK], [16, 'C3', KICK]]);
    default:
      throw new Error(`unknown drum style "${style}"`);
  }
}

// ---------------------------------------------------------------- melodies

// Verse hook, 8 bars over F#m D A E x2
const VERSE = [
  '0:C#6/6 8:B5/2 10:A5/2 12:F#5/10 24:A5/2 26:B5/2 28:C#6/4',
  '0:D6/4 6:C#6/2 8:A5/8 16:F#5/2 18:A5/2 20:D6/6 28:C#6/2 30:B5/2',
  '0:A5/4 6:C#6/2 8:E6/6 16:C#6/2 18:B5/2 20:A5/8 28:C#6/2 30:E6/2',
  '0:F#6/6 8:E6/2 10:B5/2 12:G#5/8 20:B5/2 22:C#6/2 24:D6/2 26:C#6/2 28:B5/4',
  '0:F#5/4 4:A5/2 6:C#6/2 8:B5/4 12:A5/4 16:F#5/4 20:A5/2 22:C#6/2 24:B5/2 26:A5/2 28:F#5/4',
  '0:D5/4 4:F#5/2 6:A5/2 8:D6/6 16:C#6/2 18:B5/2 20:A5/6 28:F#5/4',
  '0:A5/4 4:C#6/2 6:E6/2 8:D6/4 12:C#6/4 16:B5/4 20:A5/2 22:C#6/2 24:E6/4 28:D6/4',
  '0:E6/4 4:D6/2 6:C#6/2 8:B5/8 16:G#5/2 18:B5/2 20:E6/2 22:D6/2 24:C#6/2 26:B5/2 28:A5/2 30:G#5/2',
];

// Verse variation: 16th-note ornaments, chromatic pickups
const VERSE2 = [
  '0:C#6/2 2:D6/2 4:C#6/2 6:A5/2 8:B5/4 12:A5/2 14:G#5/2 16:F#5/8 24:C#6/2 26:D6/2 28:C#6/2 30:B5/2',
  '0:A5/2 2:B5/2 4:A5/2 6:F#5/2 8:D6/4 12:C#6/2 14:B5/2 16:A5/8 24:D6/2 26:E6/2 28:F#6/2 30:E6/2',
  '0:E6/2 2:C#6/2 4:A5/2 6:C#6/2 8:E6/4 12:A6/4 16:G#6/2 18:E6/2 20:C#6/4 24:B5/2 26:C#6/2 28:D6/2 30:E6/2',
  '0:B5/2 2:G#5/2 4:E5/2 6:G#5/2 8:B5/6 16:E6/2 18:D6/2 20:C#6/2 22:B5/2 24:A5/2 26:G#5/2 28:F#5/2 30:E5/2',
  '0:C#6/2 2:D6/2 4:E6/2 6:F#6/2 8:E6/4 12:C#6/4 16:A5/2 18:B5/2 20:C#6/2 22:D6/2 24:C#6/4 28:B5/4',
  '0:A5/2 2:B5/2 4:C#6/2 6:D6/2 8:E6/4 12:D6/4 16:C#6/2 18:B5/2 20:A5/2 22:F#5/2 24:A5/4 28:D6/4',
  '0:E6/2 2:D6/2 4:C#6/2 6:B5/2 8:A5/4 12:B5/4 16:C#6/2 18:D6/2 20:E6/2 22:F#6/2 24:E6/4 28:C#6/4',
  '0:B5/2 2:A5/2 4:G#5/2 6:F#5/2 8:E5/4 12:G#5/4 16:B5/2 18:D6/2 20:C#6/2 22:B5/2 24:A5/2 26:G#5/2 28:F#5/4',
];

// B section: anthemic, sits higher
const BRIDGE = [
  '0:F#5/4 4:B5/2 6:D6/2 8:C#6/4 12:B5/4 16:F#5/6 24:D6/2 26:C#6/2 28:B5/4',
  '0:A5/4 4:D6/2 6:F#6/2 8:E6/4 12:D6/4 16:A5/6 24:F#5/2 26:A5/2 28:D6/4',
  '0:C#6/4 4:E6/2 6:A6/2 8:G#6/4 12:E6/4 16:C#6/6 24:B5/2 26:C#6/2 28:E6/4',
  '0:B5/4 4:E6/2 6:G#6/2 8:F#6/4 12:E6/4 16:B5/6 24:G#5/2 26:B5/2 28:E6/4',
  '0:D6/2 2:C#6/2 4:B5/4 8:F#5/8 16:B5/2 18:C#6/2 20:D6/2 22:E6/2 24:F#6/4 28:E6/4',
  '0:F6/4 4:E6/2 6:D6/2 8:C#6/8 16:G#5/4 20:C#6/2 22:D6/2 24:E6/2 26:F6/2 28:G#6/4',
  '0:A6/6 8:G#6/2 10:F#6/2 12:C#6/8 20:A5/2 22:C#6/2 24:F#6/4 28:E6/4',
  '0:D6/4 4:C#6/2 6:B5/2 8:A5/4 12:G#5/4 16:F#5/8 24:C#6/4 28:F#6/4',
];

// Breakdown lead: sparse, exposed
const BREAK = [
  '0:C#6/8 12:B5/4 16:A5/8 28:G#5/4',
  '0:F#5/8 12:A5/4 16:D6/8 28:C#6/4',
  '0:E6/8 12:C#6/4 16:B5/8 28:A5/4',
  '0:G#5/2 2:A5/2 4:B5/2 6:C#6/2 8:D6/2 10:E6/2 12:F#6/4 20:G#6/4 24:A6/2 26:G#6/2 28:F#6/4',
];

// Outro: the hook, dissolving
const OUTRO = [
  '0:D6/8 12:C#6/4 16:B5/12 28:A5/4',
  '0:F6/8 12:E6/4 16:C#6/12 28:G#5/4',
  '0:A6/12 16:G#6/4 20:F#6/12',
  '0:F#6/16',
];

// ------------------------------------------------------------- arranging

const ARP_SHAPE_A = [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5];
const ARP_SHAPE_B = [0, 2, 1, 3, 2, 4, 3, 5, 4, 3, 2, 1, 0, 2, 4, 5];

/** Per-bar arrangement: [drumStyle, bassStyle, arpStyle|null, leadBar|null, leadInst] */
function arrange() {
  const rows = new Array(BARS);
  const set = (from, to, row) => { for (let i = from; i <= to; i += 1) rows[i] = row(i); };

  // intro: arp alone, then layers pile in
  set(0, 0, () => ['none', 'none', 'quiet', null]);
  set(1, 1, () => ['none', 'half', 'quiet', null]);
  set(2, 2, () => ['kick', 'eighths', 'quiet', null]);
  set(3, 3, () => ['half', 'eighths', 'quiet', null]);

  // build
  set(4, 6, () => ['drive', 'eighths', 'normal', null]);
  set(7, 7, () => ['driveFill', 'eighths', 'normal', null]);

  // verse
  set(8, 15, (i) => ['drive', 'eighths', 'normal', VERSE[i - 8], 0]);

  // verse, lifted: sawtooth lead an octave of energy up
  set(16, 23, (i) => ['drive', 'eighths', 'normal', VERSE2[i - 16], 16]);

  // B section
  set(24, 27, (i) => ['drive', 'eighths', 'normal', BRIDGE[i - 24], 2]);
  set(28, 30, (i) => ['drive', 'sixteenths', 'normal', BRIDGE[i - 24], 2]);
  set(31, 31, () => ['driveFill', 'sixteenths', 'normal', BRIDGE[7], 2]);

  // breakdown: everything drops to half-time
  set(32, 34, (i) => ['break', 'half', null, BREAK[i - 32], 8]);
  set(35, 35, () => ['tomFill', 'half', null, BREAK[3], 8]);

  // chorus: full power
  set(36, 43, (i) => ['drive', 'sixteenths', 'bright', VERSE[i - 36], 16]);
  set(43, 43, () => ['driveFill', 'sixteenths', 'bright', VERSE[7], 16]);

  // outro
  set(44, 46, (i) => ['half', 'half', 'quiet', OUTRO[i - 44], 16]);
  set(47, 47, () => ['none', 'half', 'quiet', OUTRO[3], 16]);

  return rows;
}

const ARRANGE = arrange();

// -------------------------------------------------------------- building

function blankAt(ch) {
  const v = lc.blankVoice();
  if (ch === CHORD) v.x = null;
  return v;
}

function layBar(music, ch, barIndex, toks, fallbackInst) {
  const sound = music.channels.channels[ch].sl[barIndex];
  for (let t = 0; t < TICKS; t += 1) sound.vl[t] = blankAt(ch);
  for (let t = 0; t < TICKS; t += 1) {
    const tok = toks[t];
    if (!tok || tok === '.') continue;
    const parsed = lc.parsePatternToken(tok, { instrument: fallbackInst });
    if (parsed.kind === 'rest') continue;
    sound.vl[t] = parsed.voice;
  }
}

function layChord(music, barIndex, tick, root, type) {
  const sound = music.channels.channels[CHORD].sl[barIndex];
  const v = blankAt(CHORD);
  v.n = lc.noteNameToNumber(root);
  v.id = lc.encodeChordId(type);
  v.t = 0;
  v.v = 4;
  v.f = 0;
  v.x = 10; // matches how LC writes chord voices
  v.p = 0;
  v.e = 0;
  sound.vl[tick] = v;
}

function main() {
  const title = '配信中毒 - STREAM OVERDOSE';
  const header = lc.headerObject({ title, editor: 'DeepSeek Harness', exFilename: title });
  const music = lc.musicObject({
    speed: SPEED,
    pages: BARS,
    ticksPerPage: TICKS,
    barsPerPage: BARS_PER_PAGE,
    notesByPage: true,
    tempoByPage: false,
    title,
    editor: 'DeepSeek Harness',
    exFilename: title,
    scaleId: 4, // minor scale
    scaleKey: 6, // F#
    enableLoop: true,
    loopStartBar: 8,
    loopEndBar: 43,
  });

  for (let bar = 0; bar < BARS; bar += 1) {
    const chordName = PROG[bar];
    const def = CHORDS[chordName];
    const [drumStyle, bassStyle, arpStyle, leadBar, leadInst] = ARRANGE[bar];

    layBar(music, DRUM, bar, drumBar(drumStyle));

    // Crash on the last 16th before every 8-bar boundary, so it leads INTO the
    // downbeat instead of stealing the tick-0 kick. Replaces a closed hat.
    if (bar < BARS - 1 && (bar + 1) % 8 === 0) {
      music.channels.channels[DRUM].sl[bar].vl[30] =
        lc.voiceFromPreset(CRASH, lc.noteNameToNumber('C6'), { volume: 5 });
    }

    layBar(music, BASS, bar, bassBar(chordName, bassStyle));

    // arpeggio wall: 16th notes through the chord tones
    if (arpStyle) {
      const notes = stack(chordName);
      const shape = bar >= 36 ? ARP_SHAPE_B : ARP_SHAPE_A;
      const inst = arpStyle === 'bright' ? 68 : 16;
      const vol = arpStyle === 'quiet' ? 2 : (arpStyle === 'bright' ? 4 : 3);
      layBar(music, ARP, bar, sixteenths(notes, shape, inst, `*${vol}`));
    }

    // lead
    if (leadBar) {
      const toks = melodyBar(leadBar, leadInst);
      // slur the last real note of each 4-bar phrase (never a '-' hold token)
      if (bar % 4 === 3) {
        for (let t = TICKS - 1; t >= 0; t -= 1) {
          if (toks[t].includes('@')) { toks[t] += '+S'; break; }
        }
      }
      layBar(music, LEAD, bar, toks, leadInst);
    }

    // chord track
    layChord(music, bar, 0, `${def.root}2`, def.type);
    if (bar >= 36 && bar <= 43) layChord(music, bar, 16, `${def.root}2`, def.type);
  }

  const fs = require('fs');
  const path = require('path');
  const file = lc.songFilePath(lc.detectLayout(), FOLDER, SONG);
  lc.writeSongRaw(file, header, music);

  // Lovely Composer only recognises a directory as a song folder when it holds lcdata.jsonl.
  const lcdata = path.join(path.dirname(file), 'lcdata.jsonl');
  if (!fs.existsSync(lcdata)) {
    fs.writeFileSync(lcdata, '{}\r\n{"__LCData__": true, "enable_chord": true}', 'utf8');
  }

  const notes = lc.channelList(music).map((ch) => ch.sl.reduce((n, s) => n + s.vl.filter((v) => v.n !== null && v.n >= 0).length, 0));
  console.log(`wrote ${file}`);
  console.log(`  "${title}"  ${BARS} bars @ ${Math.round((900 * BARS_PER_PAGE) / SPEED)} BPM  key F# minor`);
  console.log(`  notes per channel [lead, arp, bass, drum, chord] = [${notes.join(', ')}]  total ${notes.reduce((a, b) => a + b, 0)}`);
  console.log(`  size ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

main();
