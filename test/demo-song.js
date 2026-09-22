'use strict';
/**
 * Compose a short demo chiptune through the MCP tool handlers.
 *
 *   node test/demo-song.js [targetFolder]
 *
 * Defaults to ./.tmp-test/DEMO so nothing in the real music library is touched.
 * Pass a real folder name (e.g. BAICHUAN) to write into the Lovely Composer library.
 */

const path = require('path');
const { callTool } = require('../src/tools');

const folder = process.argv[2] || path.join(__dirname, '..', '.tmp-test', 'DEMO');
const song = Number(process.argv[3] || 0);

function run(name, args) {
  const res = callTool(name, args);
  const body = res.content.map((c) => c.text).join('\n');
  if (res.isError) {
    console.error(`FAIL ${name}: ${body}`);
    process.exit(1);
  }
  console.log(`> ${name} ${JSON.stringify(args).slice(0, 120)}`);
  console.log(body.split('\n').map((l) => `    ${l}`).join('\n'));
  return body;
}

// ---------------------------------------------------------------- the tune
// 4 pages x 4 bars = 16 bars, 8 ticks per bar, 4 ticks per beat group.
// Chord progression: C - G - Am - F  (2 bars each)

const MELODY = [
  'C5 . . . E5 . . . G5 . . . E5 . . .  F5 . . . A5 . . . G5 . . . E5 . . .',
  'D5 . . . F5 . . . A5 . . . F5 . . .  E5 . . . G5 . . . C6 . . . - . . .',
  'C5 . . . E5 . . . A5 . . . E5 . . .  D5 . . . F5 . . . A5 . . . F5 . . .',
  'E5 . . . G5 . . . C6 . . . G5 . . .  F5 . . . E5 . . . D5 . . . C5 . . .',
];

const HARMONY = [
  '. . . . . . . . E4 . . . C4 . . .  . . . . C4 . . . C4 . . . A3 . . .',
  '. . . . . A3 . . . F4 . . . D4 . .  . . . . C4 . . . E4 . . . G4 . . .',
  '. . . . . . . . A3 . . . E4 . . .  . . . . A3 . . . D4 . . . A3 . . .',
  '. . . . C4 . . . G4 . . . E4 . . .  . . . . A3 . . . G3 . . . E3 . . .',
];

const BASS = [
  'C3 . . . . . . . C3 . . . . . . .  G2 . . . . . . . G2 . . . . . . .',
  'G2 . . . . . . . G2 . . . . . . .  C3 . . . . . . . C3 . . . . . . .',
  'A2 . . . . . . . A2 . . . . . . .  F2 . . . . . . . F2 . . . . . . .',
  'C3 . . . . . . . C3 . . . . . . .  F2 . . . . . . . G2 . . . . . . .',
];

const DRUMS = [
  'K . h . S . h . K . h . S . h .  K . h . S . h . K . h . S . h h',
  'K . h . S . h . K . h . S . h .  K . h . S . h . K . h . S . h h',
  'K . h . S . h . K . h . S . h .  K . h . S . h . K . h . S . h h',
  'K . h . S . h . K . h . S . h .  K . h . S . h . K . S . h . . .',
];

/** Fail loudly if a pattern does not fit one 32-tick page. */
function assertPage(patterns, name) {
  patterns.forEach((p, i) => {
    const n = p.trim().split(/\s+/).length;
    if (n !== 32) throw new Error(`${name} page ${i} has ${n} tokens, expected 32`);
  });
  return patterns;
}

/** Expand the drum shorthand into the pattern DSL. */
function drums(pattern) {
  return pattern
    .split(/\s+/)
    .map((t) => {
      if (t === '.') return '.';
      if (t === 'K') return 'C3@30'; // stomp = kick
      if (t === 'S') return 'D3@33'; // punch = snare
      if (t === 'h') return 'F#4@35*3'; // short freq noise = hat, quieter
      return t;
    })
    .join(' ');
}

console.log('=== creating song ===');
run('lc_create_song', {
  folder,
  song,
  title: 'DSH Demo Loop',
  editor: 'DeepSeek Harness',
  speed: 24,
  pages: 4,
  ticksPerPage: 32,
  barsPerPage: 4,
  force: true,
});

console.log('\n=== channels 0-3 (pattern strings) ===');
const tracks = [
  { channel: 0, name: 'melody', instrument: 0, patterns: assertPage(MELODY, 'melody') },
  { channel: 1, name: 'harmony', instrument: 26, patterns: assertPage(HARMONY, 'harmony') },
  { channel: 2, name: 'bass', instrument: 47, patterns: assertPage(BASS, 'bass') },
  { channel: 3, name: 'drums', instrument: null, patterns: assertPage(DRUMS.map(drums), 'drums') },
];

for (const track of tracks) {
  for (let page = 0; page < track.patterns.length; page += 1) {
    const args = { folder, song, channel: track.channel, page, pattern: track.patterns[page], force: true };
    if (track.instrument !== null) args.instrument = track.instrument;
    run('lc_write_page', args);
  }
}

console.log('\n=== channel 4: chord progression (structured events) ===');
const CHORDS = ['major', 'major', 'minor', 'major']; // C G Am F
const chordNotes = ['C3', 'G2', 'A2', 'F2'];
const events = [];
for (let page = 0; page < 4; page += 1) {
  events.push({ channel: 4, page, tick: 0, note: chordNotes[page], chord: CHORDS[page], expression: 10 });
  events.push({ channel: 4, page, tick: 16, note: chordNotes[page], chord: CHORDS[page], expression: 10 });
}
run('lc_set_notes', { folder, song, notes: events, force: true });

console.log('\n=== result ===');
run('lc_read_song', { folder, song, channels: [0, 2] });
run('lc_list_songs', { folder });
