'use strict';
/**
 * Self-test for the Lovely Composer format engine and tool handlers.
 * Runs entirely in-process (no child processes) and writes only inside this repo.
 *
 *   node test/smoke.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const lc = require('../src/lc');
const { callTool } = require('../src/tools');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  FAIL ${name}\n       ${(error && error.message) || error}`);
  }
}

const sandbox = path.join(__dirname, '..', '.tmp-test');
fs.rmSync(sandbox, { recursive: true, force: true });
fs.mkdirSync(sandbox, { recursive: true });

console.log('\nnote names');
check('C4 is 60 (LC octave convention)', () => assert.strictEqual(lc.noteNameToNumber('C4'), 60));
check('A4 is 69', () => assert.strictEqual(lc.noteNameToNumber('A4'), 69));
check('F#5 is 78', () => assert.strictEqual(lc.noteNameToNumber('F#5'), 78));
check('Bb3 is flat-aware (58)', () => assert.strictEqual(lc.noteNameToNumber('Bb3'), 58));
check('R is a rest (-1)', () => assert.strictEqual(lc.noteNameToNumber('R'), -1));
check('round trip C5', () => assert.strictEqual(lc.noteNumberToName(72), 'C5'));
check('round trip A#5', () => assert.strictEqual(lc.noteNumberToName(82), 'A#5'));
check('null renders as R', () => assert.strictEqual(lc.noteNumberToName(null), 'R'));

console.log('\ninstrument presets (verified against real project files)');
check('preset 2 is square, vol 4, fx N', () => {
  const v = lc.voiceFromPreset(2, 60);
  assert.strictEqual(lc.toneName(v.t), 'S');
  assert.strictEqual(v.v, 4);
  assert.strictEqual(v.f, 0);
  assert.strictEqual(v.id, 2);
  assert.strictEqual(v.x, 12);
});
check('preset 30 matches file tuple (t=T,v=4,f=D,e=3)', () => {
  const v = lc.voiceFromPreset(30, 60);
  assert.strictEqual(lc.toneName(v.t), 'T');
  assert.strictEqual(v.v, 4);
  assert.strictEqual(lc.effectName(v.f), 'D');
  assert.strictEqual(v.e, 3);
});
check('preset 47 matches file tuple (t=L,v=4,f=N,e=0)', () => {
  const v = lc.voiceFromPreset(47, 60);
  assert.strictEqual(lc.toneName(v.t), 'L');
  assert.strictEqual(v.e, 0);
});
check('preset 128 is the extension line', () => {
  const v = lc.extensionVoice();
  assert.strictEqual(v.id, 128);
  assert.strictEqual(v.t, 12);
  assert.strictEqual(v.x, null);
});
check('names resolve', () => {
  assert.strictEqual(lc.resolveInstrument('flute'), 25);
  assert.strictEqual(lc.resolveInstrument('Square wave'), 2);
  assert.strictEqual(lc.resolveInstrument('7'), 7);
});

console.log('\nchord ids');
check('major encodes to 131072 (seen in real files)', () => {
  assert.strictEqual(lc.encodeChordId('major'), 131072);
});
check('decode round trip', () => {
  const d = lc.decodeChordId(131072);
  assert.strictEqual(d.type, 'major');
  assert.strictEqual(d.power, 0);
});
check('chord labels read like music', () => {
  assert.strictEqual(lc.chordLabel(lc.noteNameToNumber('F2'), lc.encodeChordId('major')), 'F');
  assert.strictEqual(lc.chordLabel(lc.noteNameToNumber('A2'), lc.encodeChordId('minor')), 'Am');
  assert.strictEqual(lc.chordLabel(lc.noteNameToNumber('G2'), lc.encodeChordId('major', { seventh: 1 })), 'G7');
  assert.strictEqual(lc.chordLabel(lc.noteNameToNumber('C4'), lc.encodeChordId('major')), 'C');
});

console.log('\npattern DSL');
check('notes, rests and holds', () => {
  const p = (t, inst) => lc.parsePatternToken(t, { instrument: inst });
  assert.strictEqual(p('.', 2).kind, 'rest');
  assert.strictEqual(p('R', 2).kind, 'rest');
  assert.strictEqual(p('-', 2).voice.id, 128);
  assert.strictEqual(p('C5', 2).voice.n, 72);
  assert.strictEqual(p('C5@25', null).voice.id, 25);
  assert.strictEqual(p('C5@flute', null).voice.id, 25);
});
check('modifiers', () => {
  const v = lc.parsePatternToken('C5@16*7+D^A~8%3', {}).voice;
  assert.strictEqual(v.v, 7);
  assert.strictEqual(lc.effectName(v.f), 'D');
  assert.strictEqual(v.x, 10);
  assert.strictEqual(v.p, 8);
  assert.strictEqual(v.e, 3);
});
check('effect letters that are not hex digits parse (+S slur, +V vibrato, +W)', () => {
  assert.strictEqual(lc.effectName(lc.parsePatternToken('C5@0+S', {}).voice.f), 'S');
  assert.strictEqual(lc.effectName(lc.parsePatternToken('C5@0+V', {}).voice.f), 'V');
  assert.strictEqual(lc.effectName(lc.parsePatternToken('C5@0+W', {}).voice.f), 'W');
});
check('tremolo (the * effect letter) is reachable as +*', () => {
  assert.strictEqual(lc.effectName(lc.parsePatternToken('C5@0+*', {}).voice.f), '*');
});
check('bad modifiers are rejected', () => {
  assert.throws(() => lc.parsePatternToken('C5@0+Q', {}), /effect/);
  assert.throws(() => lc.parsePatternToken('C5@0*9', {}), /volume/);
  assert.throws(() => lc.parsePatternToken('C5@0!x', {}), /modifier/);
});
check('native LC voice string', () => {
  const v = lc.parsePatternToken('C5:S4NC00::2', {}).voice;
  assert.strictEqual(lc.toneName(v.t), 'S');
  assert.strictEqual(v.v, 4);
  assert.strictEqual(v.id, 2);
});

console.log('\nsong file round trip');
const folder = path.join(sandbox, 'TESTBANK');
const args = {
  folder,
  song: 3,
  title: 'Smoke Test',
  editor: 'mcp',
  speed: 12,
  pages: 4,
  ticksPerPage: 32,
  barsPerPage: 4,
};
check('lc_create_song', () => {
  const res = callTool('lc_create_song', args);
  assert.ok(!res.isError, JSON.stringify(res));
  assert.ok(fs.existsSync(path.join(folder, '03.jsonl')));
});
check('file is two tagged JSON lines', () => {
  const text = fs.readFileSync(path.join(folder, '03.jsonl'), 'utf8');
  const lines = text.split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(JSON.parse(lines[0]).__LCMusicDataHeader__, true);
  assert.strictEqual(JSON.parse(lines[1]).__LCMusic__, true);
  assert.strictEqual(JSON.parse(lines[0]).data_version, 16);
});
check('structure mirrors LC: 5 channels x 4 pages x 32 voices', () => {
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  const chans = lc.channelList(music);
  assert.strictEqual(chans.length, 5);
  for (const ch of chans) {
    assert.strictEqual(ch.sl.length, 4);
    for (const s of ch.sl) {
      assert.strictEqual(s.vl.length, 32);
      assert.strictEqual(s.play_notes, 32);
      assert.strictEqual(s.play_speed, 12);
    }
  }
  assert.strictEqual(music.rhythms.rhythms.length, 4);
});
check('every voice carries the full LC key set and the class tag', () => {
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  const chans = lc.channelList(music);
  for (const ch of chans) {
    for (const s of ch.sl) {
      for (const v of s.vl) {
        // LC's json_loader_hook rebuilds an object from the first key naming a
        // known class; without the tag a voice would load as a plain dict.
        assert.strictEqual(Object.keys(v)[0], '__LCVoice__', `first key was ${Object.keys(v)[0]}`);
        assert.strictEqual(v.__LCVoice__, true);
        for (const k of ['n', 't', 'v', 'f', 'id', 'x', 'p', 'e']) {
          assert.ok(k in v, `missing key ${k}`);
        }
      }
    }
  }
  assert.strictEqual(music.__LCMusic__, true);
  assert.strictEqual(music.channels.__LCChannelList__, true);
  assert.strictEqual(chans[0].__LCSoundList__, true);
  assert.strictEqual(chans[0].sl[0].__LCSound__, true);
  assert.strictEqual(music.rhythms.__LCRhythmList__, true);
  assert.strictEqual(music.rhythms.rhythms[0].__LCRhythm__, true);
});
check('lc_write_page places notes', () => {
  const res = callTool('lc_write_page', {
    folder, song: 3, channel: 0, page: 1, instrument: 25,
    pattern: 'C5 . E5 . G5 . . . - . . . C6@2 . . . . . . . . . . . . . . . . . . .',
  });
  assert.ok(!res.isError, JSON.stringify(res));
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  const vl = lc.channelList(music)[0].sl[1].vl;
  assert.strictEqual(vl[0].n, 72, 'tick 0 = C5');
  assert.strictEqual(vl[0].id, 25, 'instrument preset');
  assert.strictEqual(vl[2].n, 76, 'tick 2 = E5');
  assert.strictEqual(vl[4].n, 79, 'tick 4 = G5');
  assert.strictEqual(vl[8].id, 128, 'tick 8 = hold');
  assert.strictEqual(vl[12].n, 84, 'tick 12 = C6');
  assert.strictEqual(vl[12].id, 2, 'inline @2 overrides the default instrument');
  assert.strictEqual(vl[1].n, null, 'tick 1 empty');
});
check('lc_set_notes places exact ticks and chords', () => {
  const res = callTool('lc_set_notes', {
    folder, song: 3,
    notes: [
      { channel: 3, page: 2, tick: 5, note: 'D#4', instrument: 'bass', volume: 6 },
      { channel: 4, page: 2, tick: 0, note: 'C4', chord: 'minor', seventh: '7' },
    ],
  });
  assert.ok(!res.isError, JSON.stringify(res));
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  const chans = lc.channelList(music);
  assert.strictEqual(chans[3].sl[2].vl[5].n, 63);
  assert.strictEqual(chans[3].sl[2].vl[5].v, 6);
  const chord = chans[4].sl[2].vl[0];
  assert.ok(chord.id >= lc.MIN_CHORD_VOICE_ID, 'chord id on the chord track');
  assert.strictEqual(lc.decodeChordId(chord.id).type, 'minor');
  assert.strictEqual(lc.decodeChordId(chord.id).seventh, 1);
});
check('lc_read_song renders patterns back', () => {
  const res = callTool('lc_read_song', { folder, song: 3, channels: [0], pages: [1] });
  assert.ok(!res.isError);
  const body = res.content[0].text;
  assert.ok(body.includes('C5@25'), body);
  assert.ok(body.includes('E5@25'), body);
});
check('lc_set_song_options resizes pages and keeps notes', () => {
  const res = callTool('lc_set_song_options', { folder, song: 3, pages: 8, speed: 20 });
  assert.ok(!res.isError, JSON.stringify(res));
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  assert.strictEqual(music.pages, 8);
  assert.strictEqual(music.channels.channels[0].sl.length, 8);
  assert.strictEqual(music.rhythms.rhythms.length, 8);
  assert.strictEqual(music.channels.channels[0].sl[1].vl[0].n, 72, 'notes survive a resize');
  assert.strictEqual(music.speed, 20);
  assert.strictEqual(music.channels.channels[0].sl[0].play_speed, 20);
});
check('lc_set_song_options shrinks pages', () => {
  const res = callTool('lc_set_song_options', { folder, song: 3, pages: 3 });
  assert.ok(!res.isError, JSON.stringify(res));
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  assert.strictEqual(music.pages, 3);
  assert.strictEqual(music.channels.channels[0].sl.length, 3);
});
check('lc_clear_pages erases', () => {
  const res = callTool('lc_clear_pages', { folder, song: 3, channels: [0], pages: [1] });
  assert.ok(!res.isError);
  const { music } = lc.readSongRaw(path.join(folder, '03.jsonl'));
  assert.strictEqual(music.channels.channels[0].sl[1].vl[0].n, null);
});
check('create refuses to overwrite without force', () => {
  const res = callTool('lc_create_song', args);
  assert.ok(res.isError, 'expected an error');
});
check('write protection is honoured', () => {
  const file = path.join(folder, '03.jsonl');
  const { header, music } = lc.readSongRaw(file);
  header.write_protected_flag = true;
  lc.writeSongRaw(file, header, music);
  const res = callTool('lc_write_page', { folder, song: 3, channel: 0, page: 0, instrument: 2, pattern: 'C5' });
  assert.ok(res.isError, 'expected write protection to block the write');
  const forced = callTool('lc_write_page', { folder, song: 3, channel: 0, page: 0, instrument: 2, pattern: 'C5', force: true });
  assert.ok(!forced.isError, JSON.stringify(forced));
});
check('lc_copy_song', () => {
  const res = callTool('lc_copy_song', { folder, song: 3, toFolder: folder, toSong: 4, title: 'Copy' });
  assert.ok(!res.isError, JSON.stringify(res));
  const { header } = lc.readSongRaw(path.join(folder, '04.jsonl'));
  assert.strictEqual(header.title, 'Copy');
  assert.strictEqual(header.write_protected_flag, false);
});
check('lc_list_songs', () => {
  const res = callTool('lc_list_songs', { folder });
  assert.ok(!res.isError);
  assert.ok(res.content[0].text.includes('Smoke Test'));
});

console.log('\nencoding (LC opens files with the platform locale codec, not UTF-8)');
check('non-ASCII titles are escaped, so the file is pure ASCII on disk', () => {
  const encFolder = path.join(sandbox, 'ENCTEST');
  const res = callTool('lc_create_song', { folder: encFolder, song: 0, title: '配信中毒', editor: 'テスト', pages: 1, force: true });
  assert.ok(!res.isError, JSON.stringify(res));
  const raw = fs.readFileSync(path.join(encFolder, '00.jsonl'));
  for (const b of raw) assert.ok(b < 128, `byte 0x${b.toString(16)} is not ASCII`);
  const { header } = lc.readSongRaw(path.join(encFolder, '00.jsonl'));
  assert.strictEqual(header.title, '配信中毒');
  assert.strictEqual(header.editor, 'テスト');
});
check('a GBK file (what LC writes on a Chinese Windows) still reads back', () => {
  const gbkTitle = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]); // "中文" encoded as GBK
  const head = Buffer.concat([
    Buffer.from('{"__LCMusicDataHeader__": true, "data_version": 16, "title": "', 'latin1'),
    gbkTitle,
    Buffer.from('"}', 'latin1'),
  ]);
  const body = Buffer.from('{"__LCMusic__": true, "speed": 30, "pages": 1}', 'latin1');
  const file = path.join(sandbox, 'gbk-encoded.jsonl');
  fs.writeFileSync(file, Buffer.concat([head, Buffer.from('\r\n', 'latin1'), body]));
  const { header, music } = lc.readSongRaw(file);
  assert.strictEqual(header.title, '中文');
  assert.strictEqual(music.speed, 30);
});

console.log('\nread a real Lovely Composer sample');
// Optional integration check: needs an actual Lovely Composer install. Point
// LC_SAMPLE_PATH at any song file, or just keep the shipped sample folder in
// your music library. Skipped silently when neither is available.
const SAMPLE_FOLDER = 'LC_SAMPLE_2.0';
const realSample = process.env.LC_SAMPLE_PATH
  || path.join(lc.detectLayout().musicRoot, SAMPLE_FOLDER, '00.jsonl');
if (fs.existsSync(realSample)) {
  check('parses the shipped sample without losing anything', () => {
    const { header, music } = lc.readSongRaw(realSample);
    assert.strictEqual(header.data_version, 16);
    assert.strictEqual(music.pages, 20);
    const summary = lc.summarizeSong(header, music);
    assert.strictEqual(summary.channels.length, 5);
    // Re-parsing our own serialization must reproduce the exact same model.
    const tmp = path.join(sandbox, 'roundtrip.jsonl');
    lc.writeSongRaw(tmp, header, music);
    const again = lc.readSongRaw(tmp);
    assert.deepStrictEqual(again.header, header);
    assert.deepStrictEqual(again.music, music);
  });
  check('LC sample uses CRLF between the two lines, like our writer', () => {
    const text = fs.readFileSync(realSample, 'utf8');
    const nl = text.indexOf('\n');
    assert.strictEqual(text[nl - 1], '\r', 'LC terminates line 1 with CRLF');
    const written = fs.readFileSync(path.join(sandbox, 'roundtrip.jsonl'), 'utf8');
    assert.strictEqual(written[written.indexOf('\n') - 1], '\r');
  });
  const sampleSong = Number(path.basename(realSample, '.jsonl'));
  const sampleFolder = path.basename(path.dirname(realSample));
  const inLibrary = path.dirname(path.dirname(realSample)) === path.resolve(lc.detectLayout().musicRoot);
  if (inLibrary && Number.isInteger(sampleSong)) {
    check('read a real song through the tool handler', () => {
      const res = callTool('lc_read_song', { folder: sampleFolder, song: sampleSong, channels: [0], pages: [1] });
      assert.ok(!res.isError, JSON.stringify(res));
      assert.ok(res.content[0].text.includes('A5@2'), res.content[0].text.slice(0, 400));
    });
  } else {
    console.log('  skip tool-handler check (sample is outside the music library)');
  }
} else {
  console.log(`  skip (no sample at ${realSample}; set LC_SAMPLE_PATH to enable)`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
