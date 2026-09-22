'use strict';
/**
 * Tool definitions and handlers for the Lovely Composer MCP server.
 */

const fs = require('fs');
const path = require('path');

const lc = require('./lc');

const SERVER_NOTE =
  'Lovely Composer is a chiptune tracker. A song file is a folder entry ' +
  '(`<music>/<FOLDER>/<NN>.jsonl`, NN = 00..99). A song has 5 channels ' +
  '(0-3 = melodic parts, 4 = chord track), `pages` pages, and each page holds up to 32 ticks. ' +
  'Lovely Composer reads the whole folder when it opens it and rewrites every song file when it saves, ' +
  'so ask the user to reload the folder (or close LC) after writing.';

// --------------------------------------------------------------- utilities

function text(s) {
  return { content: [{ type: 'text', text: s }] };
}

function fail(message) {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

function jsonBlock(value) {
  return JSON.stringify(value, null, 2);
}

function layout() {
  return lc.detectLayout();
}

function requireSongExists(layoutInfo, folder, song) {
  const filePath = lc.songFilePath(layoutInfo, folder, song);
  if (!fs.existsSync(filePath)) {
    throw new Error(`song ${song} not found in '${folder}' (${filePath}). Use lc_create_song first.`);
  }
  return filePath;
}

function loadSong(layoutInfo, folder, song) {
  const filePath = requireSongExists(layoutInfo, folder, song);
  const { header, music } = lc.readSongRaw(filePath);
  if (!music) throw new Error(`song file ${filePath} has no music body`);
  return { filePath, header, music };
}

function ensureWritable(header, filePath, force) {
  if (header && header.write_protected_flag && !force) {
    throw new Error(
      `${filePath} is write-protected by Lovely Composer ` +
      `("${header.title || ''}"). Pass force=true to overwrite it anyway.`,
    );
  }
}

/**
 * Lovely Composer only treats a directory as a song folder when it contains
 * `lcdata.jsonl` (lcl.is_lc_jsonl_dir). Create it with the exact payload LC writes.
 */
function ensureFolder(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const lcdataPath = path.join(dir, 'lcdata.jsonl');
  if (!fs.existsSync(lcdataPath)) {
    fs.writeFileSync(lcdataPath, '{}\r\n{"__LCData__": true, "enable_chord": true}', 'utf8');
    return true;
  }
  return false;
}

function clampInt(value, min, max, what) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) throw new Error(`${what} must be an integer`);
  if (n < min || n > max) throw new Error(`${what} must be between ${min} and ${max}`);
  return n;
}

function resolveChannel(value, { allowChord = true } = {}) {
  const ch = clampInt(value, 0, lc.USER_MUSIC_CHANNEL_COUNT - 1, 'channel');
  if (!allowChord && ch === lc.USER_MUSIC_CHORD_CHANNEL) {
    throw new Error(`channel ${lc.USER_MUSIC_CHORD_CHANNEL} is the chord track`);
  }
  return ch;
}

// ------------------------------------------------------------ tool handlers

function handleStatus() {
  const l = layout();
  const folders = [];
  if (fs.existsSync(l.musicRoot)) {
    for (const entry of fs.readdirSync(l.musicRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(l.musicRoot, entry.name);
      const count = fs.readdirSync(dir).filter((f) => /^\d{2}\.jsonl$/.test(f)).length;
      folders.push({ folder: entry.name, songs: count });
    }
  }
  const report = {
    musicRoot: l.musicRoot,
    musicRootWritable: isWritable(l.musicRoot),
    userDataDir: l.userDataDir,
    exportDir: l.exportDir,
    installDir: l.installDir,
    songFolders: folders,
    model: {
      channels: `${lc.USER_MUSIC_CHANNEL_COUNT} (0-3 melodic, ${lc.USER_MUSIC_CHORD_CHANNEL} = chord track)`,
      ticksPerPage: `up to ${lc.MAX_SOUND_LENGTH}`,
      defaultTicksPerPage: lc.MAX_SOUND_LENGTH,
      defaultPages: lc.DEFAULT_MUSIC_PAGES,
      defaultSpeed: lc.DEFAULT_MUSIC_SPEED,
      noteRange: `${lc.noteNumberToName(lc.USER_MIN_NOTE_KEY_CODE)}..${lc.noteNumberToName(lc.USER_MAX_NOTE_KEY_CODE)}`,
      bpmFormula: 'bpm = 900 * barsPerPage / speed  (LC: common.get_bpm; lower speed = faster song)',
    },
    note: SERVER_NOTE,
  };
  return text(jsonBlock(report));
}

function isWritable(dir) {
  try {
    const probe = path.join(dir, `.lc-mcp-probe-${process.pid}`);
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function handleListFolders() {
  const l = layout();
  if (!fs.existsSync(l.musicRoot)) return fail(`music root not found: ${l.musicRoot}`);
  const rows = [];
  for (const entry of fs.readdirSync(l.musicRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(l.musicRoot, entry.name);
    const songs = fs.readdirSync(dir).filter((f) => /^\d{2}\.jsonl$/.test(f));
    let titles = [];
    for (const f of songs) {
      try {
        const { header } = lc.readSongRaw(path.join(dir, f));
        if (header && header.title) titles.push(header.title);
      } catch { /* skip unreadable */ }
    }
    rows.push(`${entry.name}  (${songs.length} song${songs.length === 1 ? '' : 's'})${titles.length ? `\n    ${titles.slice(0, 6).join(' | ')}${titles.length > 6 ? ' | ...' : ''}` : ''}`);
  }
  return text(`Music root: ${l.musicRoot}\n\n${rows.join('\n') || '(no song folders)'}`);
}

function handleListSongs(args) {
  const l = layout();
  const dir = lc.resolveFolder(l, args.folder);
  if (!fs.existsSync(dir)) return fail(`folder not found: ${dir}`);

  const songs = [];
  for (let i = 0; i < lc.MAX_MUSIC_NUM; i += 1) {
    const filePath = path.join(dir, lc.songFileName(i));
    if (!fs.existsSync(filePath)) continue;
    try {
      const { header, music } = lc.readSongRaw(filePath);
      const summary = lc.summarizeSong(header, music);
      songs.push({
        song: i,
        title: summary.title,
        editor: summary.editor,
        speed: summary.speed,
        pages: summary.pages,
        ticksPerPage: summary.ticksPerPage,
        barsPerPage: summary.barsPerPage,
        writeProtected: summary.writeProtected,
        notesPerChannel: summary.channels.map((c) => c.notes),
      });
    } catch (error) {
      songs.push({ song: i, error: String(error.message || error) });
    }
  }

  const lines = songs.map((s) => {
    if (s.error) return `${String(s.song).padStart(2, '0')}  <unreadable: ${s.error}>`;
    const total = s.notesPerChannel.reduce((a, b) => a + b, 0);
    return `${String(s.song).padStart(2, '0')}  "${s.title}"${s.editor ? ` by ${s.editor}` : ''}` +
      `  speed=${s.speed} pages=${s.pages} ticks=${s.ticksPerPage} bars/page=${s.barsPerPage}` +
      `  notes/ch=[${s.notesPerChannel.join(',')}] total=${total}${s.writeProtected ? '  [protected]' : ''}`;
  });
  return text(`Folder: ${args.folder}  (${dir})\n\n${lines.join('\n') || '(empty folder)'}`);
}

function handleReadSong(args) {
  const l = layout();
  const { music, header } = loadSong(l, args.folder, args.song);
  const summary = lc.summarizeSong(header, music);
  const channels = lc.channelList(music) || [];

  const wantedChannels = Array.isArray(args.channels) && args.channels.length
    ? args.channels.map((c) => resolveChannel(c))
    : [...Array(channels.length).keys()];

  let pageFrom = 0;
  let pageTo = (music.pages || channels[0]?.sl?.length || 0) - 1;
  if (Array.isArray(args.pages) && args.pages.length) {
    pageFrom = Math.min(...args.pages);
    pageTo = Math.max(...args.pages);
  } else if (args.pages && typeof args.pages === 'object') {
    if (args.pages.from !== undefined) pageFrom = args.pages.from;
    if (args.pages.to !== undefined) pageTo = args.pages.to;
  }
  const pageFilter = Array.isArray(args.pages) && args.pages.length ? new Set(args.pages) : null;

  const out = [];
  out.push(`Folder: ${args.folder}   Song: ${String(args.song).padStart(2, '0')}.jsonl`);
  out.push(jsonBlock(summary));
  out.push('');
  out.push('Legend: "." = empty tick, "-" = hold/extension, "N@id" = note with instrument preset id');
  out.push(`Tick indices 0..${(music.play_notes || lc.MAX_SOUND_LENGTH) - 1}.`);

  const ticks = music.play_notes || lc.MAX_SOUND_LENGTH;
  for (const ch of wantedChannels) {
    const channel = channels[ch];
    if (!channel) continue;
    const rows = [];
    for (let p = pageFrom; p <= pageTo; p += 1) {
      if (pageFilter && !pageFilter.has(p)) continue;
      if (!lc.pageHasContent(channel, p) && !args.includeEmptyPages) continue;
      const rendered = lc.renderPage(channel, p, channel.sl[p]?.play_notes || ticks);
      rows.push(`  p${String(p).padStart(2, '0')}  ${rendered}`);
    }
    const insts = summary.channels[ch]?.instruments || [];
    const instText = insts.length
      ? insts.map((id) => `${id}=${lc.INSTRUMENTS.get(id)?.name || (id >= lc.MIN_CHORD_VOICE_ID ? 'chord' : '?')}`).join(', ')
      : '(none)';
    out.push('');
    out.push(`── channel ${ch}${ch === lc.USER_MUSIC_CHORD_CHANNEL ? ' (CHORD TRACK)' : ''} — instruments: ${instText}`);
    out.push(rows.length ? rows.join('\n') : '  (no notes)');
  }
  return text(out.join('\n'));
}

function handleCreateSong(args) {
  const l = layout();
  const song = clampInt(args.song, 0, lc.MAX_MUSIC_NUM - 1, 'song');
  const filePath = lc.songFilePath(l, args.folder, song);

  const pages = args.pages === undefined ? lc.DEFAULT_MUSIC_PAGES : clampInt(args.pages, 1, 256, 'pages');
  const ticksPerPage = args.ticksPerPage === undefined ? lc.MAX_SOUND_LENGTH : clampInt(args.ticksPerPage, 1, lc.MAX_SOUND_LENGTH, 'ticksPerPage');
  const speed = args.speed === undefined ? lc.DEFAULT_MUSIC_SPEED : clampInt(args.speed, 1, lc.MAX_TEMPO_SPEED, 'speed');
  const barsPerPage = args.barsPerPage === undefined ? 4 : clampInt(args.barsPerPage, 1, 32, 'barsPerPage');

  let scaleId = 0;
  if (args.scale !== undefined) {
    if (typeof args.scale === 'number') scaleId = clampInt(args.scale, 0, lc.SCALE_NAMES.length - 1, 'scale');
    else {
      const want = String(args.scale).toLowerCase().replace(/\s+/g, ' ').trim();
      const idx = lc.SCALE_NAMES.findIndex((s) => s.replace(/\s+/g, ' ').trim() === want || s.replace(/\s+/g, '') === want.replace(/\s+/g, ''));
      if (idx < 0) throw new Error(`unknown scale '${args.scale}'`);
      scaleId = idx;
    }
  }
  const scaleKey = args.scaleKey === undefined ? 0 : clampInt(args.scaleKey, 0, 11, 'scaleKey');

  if (fs.existsSync(filePath) && !args.force) {
    const { header } = lc.readSongRaw(filePath);
    ensureWritable(header, filePath, false);
    throw new Error(
      `${filePath} already exists ("${header?.title || ''}"). ` +
      'Pass force=true to overwrite, or pick another song number.',
    );
  }

  const header = lc.headerObject({
    title: args.title === undefined ? '' : String(args.title),
    editor: args.editor === undefined ? '' : String(args.editor),
    exFilename: args.title === undefined ? '' : String(args.title),
    writeProtected: false,
  });
  const music = lc.musicObject({
    speed,
    pages,
    ticksPerPage,
    barsPerPage,
    notesByPage: args.notesByPage === undefined ? true : Boolean(args.notesByPage),
    tempoByPage: args.tempoByPage === undefined ? false : Boolean(args.tempoByPage),
    title: header.title,
    editor: header.editor,
    exFilename: header.ex_filename,
    scaleId,
    scaleKey,
    enableLoop: args.enableLoop === undefined ? true : Boolean(args.enableLoop),
    loopStartBar: args.loopStartBar === undefined ? null : clampInt(args.loopStartBar, 0, pages - 1, 'loopStartBar'),
    loopEndBar: args.loopEndBar === undefined ? null : clampInt(args.loopEndBar, 0, pages - 1, 'loopEndBar'),
  });

  lc.writeSongRaw(filePath, header, music);
  const createdFolder = ensureFolder(path.dirname(filePath));
  const bpm = bpmOf(speed, barsPerPage);
  return text(
    `Created ${filePath}\n` +
    (createdFolder ? `Created a new song folder (added the lcdata.jsonl Lovely Composer needs).\n` : '') +
    `title="${header.title}" speed=${speed} pages=${pages} ticksPerPage=${ticksPerPage} ` +
    `barsPerPage=${barsPerPage} scale=${lc.SCALE_NAMES[scaleId]} (~${bpm} BPM)\n\n` +
    `Write notes with lc_write_page (pattern strings) or lc_set_notes (exact ticks).\n` +
    `In Lovely Composer: open the "<${args.folder}>" folder and pick song ${String(song).padStart(2, '0')}.`,
  );
}

/**
 * LC's own tempo formula (common.py get_bpm): bpm = 30 * (30 / speed) * bars_per_page.
 * Lower `speed` therefore means a faster song; the default speed 30 with 4 bars/page is 120 BPM.
 */
function bpmOf(speed, barsPerPage) {
  if (!speed) return null;
  return Math.round((900 * barsPerPage) / speed);
}

function writePatternIntoChannel(channel, channelIdx, page, pattern, defaultInstrument, ticksLimit) {
  const tokens = String(pattern).trim().split(/\s+/).filter((t) => t !== '');
  if (tokens.length > lc.MAX_SOUND_LENGTH) {
    throw new Error(`pattern has ${tokens.length} tokens but a page holds at most ${lc.MAX_SOUND_LENGTH}`);
  }
  const sound = channel.sl[page];
  const vl = sound.vl;

  // Reset the page, then lay the pattern down from tick 0.
  for (let t = 0; t < vl.length; t += 1) {
    const blank = lc.blankVoice();
    // LC leaves the expression unset on the chord track (see LCMusic.clear()).
    if (channelIdx === lc.USER_MUSIC_CHORD_CHANNEL) blank.x = null;
    vl[t] = blank;
  }
  let placed = 0;
  for (let t = 0; t < tokens.length; t += 1) {
    const parsed = lc.parsePatternToken(tokens[t], { instrument: defaultInstrument });
    if (parsed.kind === 'rest') continue;
    vl[t] = parsed.voice;
    placed += 1;
  }
  if (ticksLimit !== undefined && ticksLimit !== null) sound.play_notes = ticksLimit;
  return placed;
}

function handleWritePage(args) {
  const l = layout();
  const { filePath, header, music } = loadSong(l, args.folder, args.song);
  ensureWritable(header, filePath, args.force);

  const channelIdx = resolveChannel(args.channel);
  const page = clampInt(args.page, 0, (music.pages || 1) - 1, 'page');
  const channel = lc.channelList(music)[channelIdx];
  if (!channel || !channel.sl[page]) return fail(`page ${page} does not exist on channel ${channelIdx}`);

  const defaultInstrument = args.instrument === undefined ? null : lc.resolveInstrument(args.instrument);
  if (defaultInstrument === null && !String(args.pattern).includes('@') && !String(args.pattern).includes(':')) {
    return fail('no instrument given: pass instrument=<preset id or name> or annotate notes as C4@25');
  }

  const ticksLimit = args.ticksPerPage === undefined ? channel.sl[page].play_notes : clampInt(args.ticksPerPage, 1, lc.MAX_SOUND_LENGTH, 'ticksPerPage');
  const placed = writePatternIntoChannel(channel, channelIdx, page, args.pattern, defaultInstrument, ticksLimit);
  if (ticksLimit > (music.play_notes || 0)) music.play_notes = ticksLimit;

  lc.writeSongRaw(filePath, header, music);
  return text(
    `channel ${channelIdx} page ${page}: wrote ${placed} note(s).\n` +
    `  ${lc.renderPage(channel, page, ticksLimit)}\n\n` +
    `Saved ${filePath}. Reload the folder in Lovely Composer to hear it.`,
  );
}

function handleSetNotes(args) {
  const l = layout();
  const { filePath, header, music } = loadSong(l, args.folder, args.song);
  ensureWritable(header, filePath, args.force);

  const events = Array.isArray(args.notes) ? args.notes : [];
  if (!events.length) return fail('notes must be a non-empty array');

  const channels = lc.channelList(music);
  let applied = 0;
  const problems = [];

  for (const ev of events) {
    try {
      const ch = resolveChannel(ev.channel);
      const page = clampInt(ev.page, 0, (music.pages || 1) - 1, 'page');
      const tick = clampInt(ev.tick, 0, lc.MAX_SOUND_LENGTH - 1, 'tick');
      const sound = channels[ch]?.sl?.[page];
      if (!sound) throw new Error(`page ${page} does not exist`);

      if (ev.clear) {
        sound.vl[tick] = lc.blankVoice();
        applied += 1;
        continue;
      }

      const noteNumber = lc.noteNameToNumber(ev.note);
      if (noteNumber === null) throw new Error(`bad note '${ev.note}'`);

      let voice;
      if (ev.chord) {
        const chordId = lc.encodeChordId(ev.chord, {
          power: ev.chordPower ? 1 : 0,
          seventh: ev.seventh === 'M7' ? 2 : (ev.seventh ? 1 : 0),
          ninth: ev.ninth === 'b9' ? 2 : (ev.ninth ? 1 : 0),
        });
        voice = lc.blankVoice();
        voice.n = noteNumber;
        voice.id = chordId;
        voice.t = 0;
        voice.v = ev.volume === undefined ? 5 : clampInt(ev.volume, 0, lc.VOICE_MAX_VOLUME, 'volume');
        voice.f = 0;
        voice.x = ev.expression === undefined ? 10 : clampInt(ev.expression, 0, lc.VOICE_MAX_EXPRESSION, 'expression');
        voice.p = ev.pan === undefined ? 0 : clampInt(ev.pan, 0, 15, 'pan');
        voice.e = ev.envelope === undefined ? 0 : clampInt(ev.envelope, 0, 15, 'envelope');
      } else {
        const presetId = ev.instrument === undefined ? null : lc.resolveInstrument(ev.instrument);
        if (presetId === null) throw new Error('event needs instrument=<preset> or chord=<type>');
        voice = lc.voiceFromPreset(presetId, noteNumber, {
          volume: ev.volume === undefined ? undefined : clampInt(ev.volume, 0, lc.VOICE_MAX_VOLUME, 'volume'),
          expression: ev.expression === undefined ? undefined : clampInt(ev.expression, 0, lc.VOICE_MAX_EXPRESSION, 'expression'),
          pan: ev.pan === undefined ? undefined : clampInt(ev.pan, 0, 15, 'pan'),
          envelope: ev.envelope === undefined ? undefined : clampInt(ev.envelope, 0, 15, 'envelope'),
        });
        if (ev.effect !== undefined) {
          const fx = lc.EFFECT_NAMES.indexOf(String(ev.effect).toUpperCase());
          if (fx < 0) throw new Error(`bad effect '${ev.effect}'`);
          voice.f = fx;
        }
      }
      sound.vl[tick] = voice;
      applied += 1;
    } catch (error) {
      problems.push(String(error.message || error));
    }
  }

  lc.writeSongRaw(filePath, header, music);
  const lines = [`Applied ${applied}/${events.length} note event(s) to ${filePath}.`];
  if (problems.length) lines.push(`Skipped ${problems.length}:\n  - ${problems.slice(0, 10).join('\n  - ')}`);
  lines.push('Reload the folder in Lovely Composer to hear it.');
  return problems.length && !applied ? fail(lines.join('\n')) : text(lines.join('\n'));
}

function handleSetSongOptions(args) {
  const l = layout();
  const { filePath, header, music } = loadSong(l, args.folder, args.song);
  ensureWritable(header, filePath, args.force);

  const changed = [];
  if (args.title !== undefined) { header.title = String(args.title); music.title = String(args.title); changed.push(`title="${args.title}"`); }
  if (args.editor !== undefined) { header.editor = String(args.editor); music.editor = String(args.editor); changed.push(`editor="${args.editor}"`); }
  if (args.speed !== undefined) {
    music.speed = clampInt(args.speed, 1, lc.MAX_TEMPO_SPEED, 'speed');
    if (!music.tempo_by_page) for (const ch of lc.channelList(music)) for (const s of ch.sl) s.play_speed = music.speed;
    changed.push(`speed=${music.speed}`);
  }
  if (args.pages !== undefined) {
    const pages = clampInt(args.pages, 1, 256, 'pages');
    resizePages(music, pages, args.ticksPerPage);
    changed.push(`pages=${pages}`);
  }
  if (args.ticksPerPage !== undefined) {
    const ticks = clampInt(args.ticksPerPage, 1, lc.MAX_SOUND_LENGTH, 'ticksPerPage');
    music.play_notes = ticks;
    for (const ch of lc.channelList(music)) for (const s of ch.sl) s.play_notes = ticks;
    changed.push(`ticksPerPage=${ticks}`);
  }
  if (args.barsPerPage !== undefined) { music.bars_number_per_page = clampInt(args.barsPerPage, 1, 32, 'barsPerPage'); changed.push(`barsPerPage=${music.bars_number_per_page}`); }
  if (args.enableLoop !== undefined) { music.enable_loop = Boolean(args.enableLoop); changed.push(`enableLoop=${music.enable_loop}`); }
  if (args.loopStartBar !== undefined) { music.loop_start_bar = args.loopStartBar === null ? null : clampInt(args.loopStartBar, 0, 255, 'loopStartBar'); changed.push(`loopStartBar=${music.loop_start_bar}`); }
  if (args.loopEndBar !== undefined) { music.loop_end_bar = args.loopEndBar === null ? null : clampInt(args.loopEndBar, 0, 255, 'loopEndBar'); changed.push(`loopEndBar=${music.loop_end_bar}`); }
  if (args.scale !== undefined) {
    let scaleId;
    if (typeof args.scale === 'number') scaleId = clampInt(args.scale, 0, lc.SCALE_NAMES.length - 1, 'scale');
    else {
      const want = String(args.scale).toLowerCase().replace(/\s+/g, '');
      const idx = lc.SCALE_NAMES.findIndex((s) => s.replace(/\s+/g, '') === want);
      if (idx < 0) throw new Error(`unknown scale '${args.scale}'`);
      scaleId = idx;
    }
    music.sel_scale_id = scaleId;
    changed.push(`scale=${lc.SCALE_NAMES[scaleId]}`);
  }
  if (args.scaleKey !== undefined) { music.sel_scale_key = clampInt(args.scaleKey, 0, 11, 'scaleKey'); changed.push(`scaleKey=${music.sel_scale_key}`); }

  if (!changed.length) return fail('no options given');
  lc.writeSongRaw(filePath, header, music);
  return text(`Updated ${filePath}:\n  ${changed.join('\n  ')}\n\nReload the folder in Lovely Composer to see it.`);
}

function resizePages(music, pages, ticksPerPage) {
  const channels = lc.channelList(music);
  const oldPages = channels[0].sl.length;
  for (const ch of channels) {
    if (pages < ch.sl.length) ch.sl = ch.sl.slice(0, pages);
    else {
      for (let p = ch.sl.length; p < pages; p += 1) {
        const voices = [];
        for (let t = 0; t < lc.MAX_SOUND_LENGTH; t += 1) voices.push(lc.blankVoice());
        ch.sl.push(lc.soundObject(voices, ticksPerPage || music.play_notes || lc.MAX_SOUND_LENGTH, music.speed));
      }
    }
  }
  const rhythms = music.rhythms && Array.isArray(music.rhythms.rhythms) ? music.rhythms.rhythms : [];
  if (pages < rhythms.length) music.rhythms.rhythms = rhythms.slice(0, pages);
  else {
    while (music.rhythms.rhythms.length < pages) music.rhythms.rhythms.push(lc.rhythmObject());
  }
  music.pages = pages;
  if (music.loop_start_bar !== null && music.loop_start_bar >= pages) music.loop_start_bar = pages - 1;
  if (music.loop_end_bar !== null && music.loop_end_bar >= pages) music.loop_end_bar = pages - 1;
  void oldPages;
}

function handleClearPages(args) {
  const l = layout();
  const { filePath, header, music } = loadSong(l, args.folder, args.song);
  ensureWritable(header, filePath, args.force);

  const channels = lc.channelList(music);
  const targetChannels = Array.isArray(args.channels) && args.channels.length
    ? args.channels.map((c) => resolveChannel(c))
    : [...Array(channels.length).keys()];
  const targetPages = Array.isArray(args.pages) && args.pages.length
    ? args.pages.map((p) => clampInt(p, 0, (music.pages || 1) - 1, 'page'))
    : [...Array(music.pages || 0).keys()];

  let cleared = 0;
  for (const ch of targetChannels) {
    for (const p of targetPages) {
      const sound = channels[ch]?.sl?.[p];
      if (!sound) continue;
      for (let t = 0; t < sound.vl.length; t += 1) sound.vl[t] = lc.blankVoice();
      cleared += 1;
    }
  }
  lc.writeSongRaw(filePath, header, music);
  return text(`Cleared ${cleared} channel-page(s) in ${filePath}.`);
}

function handleListInstruments() {
  const rows = [...lc.INSTRUMENTS.values()].map((i) =>
    `${String(i.id).padStart(3)}  ${i.tone}  ${i.name}${i.envelope ? `  (env ${i.envelope})` : ''}  fx=${lc.EFFECT_INFO[i.effect] || i.effect}`);
  const lines = [];
  lines.push('Instrument presets — pass the id (or a name like "flute") as instrument=');
  lines.push('');
  lines.push(rows.join('\n'));
  lines.push('');
  lines.push('Also usable: 128 = hold/extension, 129 = fade-out hold, 130 = fade-in hold.');
  lines.push('');
  lines.push(`Extra note modifiers in lc_write_page: *volume(0-7)  +effect  ^expression(0-F)  ~pan(0-F)  %envelope(0-F)`);
  lines.push('');
  lines.push('Effects: ' + lc.EFFECT_NAMES.map((e) => `${e}=${lc.EFFECT_INFO[e]}`).join(', '));
  lines.push('');
  lines.push('Oscillators: ' + Object.entries(lc.OSCILLATOR_INFO).map(([k, v]) => `${k}=${v}`).join(', '));
  lines.push('');
  lines.push('Scales (scale= in lc_create_song / lc_set_song_options):');
  lines.push('  ' + lc.SCALE_NAMES.map((s, i) => `${i}=${s}`).join(', '));
  lines.push('');
  lines.push('Chord track (channel 4) accepts lc_set_notes events with chord="major|minor|sus4|aug|dim"');
  lines.push('plus optional seventh="7"|"M7", ninth="9"|"b9", chordPower=true.');
  return text(lines.join('\n'));
}

function handleCopySong(args) {
  const l = layout();
  const fromPath = requireSongExists(l, args.folder, args.song);
  const toPath = lc.songFilePath(l, args.toFolder, args.toSong);
  if (fromPath === toPath) return fail('source and destination are the same file');
  if (fs.existsSync(toPath) && !args.force) {
    const { header } = lc.readSongRaw(toPath);
    ensureWritable(header, toPath, false);
    throw new Error(`${toPath} already exists. Pass force=true to overwrite.`);
  }
  const { header, music } = lc.readSongRaw(fromPath);
  const newHeader = { ...header, write_protected_flag: false, title: args.title === undefined ? header.title : String(args.title) };
  if (args.title !== undefined) { music.title = String(args.title); music.ex_filename = String(args.title); }
  lc.writeSongRaw(toPath, newHeader, music);
  ensureFolder(path.dirname(toPath));
  return text(`Copied ${fromPath}\n    -> ${toPath}\nTitle: "${newHeader.title}". Write protection cleared.`);
}

function handleDeleteSong(args) {
  const l = layout();
  const filePath = requireSongExists(l, args.folder, args.song);
  const { header } = lc.readSongRaw(filePath);
  ensureWritable(header, filePath, args.force);
  if (!args.force) {
    return fail(
      `Refusing to delete ${filePath} ("${header?.title || ''}") without force=true. ` +
      'Lovely Composer has no undo for a removed song file.',
    );
  }
  fs.unlinkSync(filePath);
  return text(`Deleted ${filePath}.`);
}

// ------------------------------------------------------------ tool schemas

const TOOLS = [
  {
    name: 'lc_status',
    description:
      'Report the detected Lovely Composer installation, music folder root, whether it is writable, ' +
      'and the song data model (channels, pages, ticks, note range). Call this first.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: handleStatus,
  },
  {
    name: 'lc_list_folders',
    description: 'List the song folders inside the Lovely Composer music root, with song counts and a few titles.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: handleListFolders,
  },
  {
    name: 'lc_list_songs',
    description: 'List the songs (00..99) in one folder with title, speed, page count and note counts per channel.',
    inputSchema: {
      type: 'object',
      properties: { folder: { type: 'string', description: 'Folder name under the music root (e.g. "BAICHUAN"), or an absolute path.' } },
      required: ['folder'],
      additionalProperties: false,
    },
    handler: handleListSongs,
  },
  {
    name: 'lc_read_song',
    description:
      'Read a song and print its settings plus each channel as compact per-page patterns ' +
      '("C5@2 . . E5@2 ..."), so you can inspect and edit existing music.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name under the music root, or an absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99, description: 'Song number 00..99.' },
        channels: { type: 'array', items: { type: 'integer' }, description: 'Only these channels (default: all 5).' },
        pages: { description: 'A list of page indices, or {from,to}. Default: every page.' },
        includeEmptyPages: { type: 'boolean', description: 'Also print pages that contain no notes.' },
      },
      required: ['folder', 'song'],
      additionalProperties: false,
    },
    handler: handleReadSong,
  },
  {
    name: 'lc_create_song',
    description:
      'Create a new empty song file at <music>/<folder>/<NN>.jsonl. Fails if the song already exists ' +
      'unless force=true. Returns the usable tick range and an approximate BPM.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name under the music root, or an absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99, description: 'Song number 00..99.' },
        title: { type: 'string', description: 'Song title.' },
        editor: { type: 'string', description: 'Author name.' },
        speed: { type: 'integer', minimum: 1, maximum: 75, description: 'Tempo value (LC default 30).' },
        pages: { type: 'integer', minimum: 1, maximum: 256, description: 'Number of pages (default 16).' },
        ticksPerPage: { type: 'integer', minimum: 1, maximum: 32, description: 'Ticks actually played per page (default 32).' },
        barsPerPage: { type: 'integer', minimum: 1, maximum: 32, description: 'Musical bars a page spans (default 4).' },
        scale: { description: 'Scale name or index; see lc_list_instruments.' },
        scaleKey: { type: 'integer', minimum: 0, maximum: 11, description: 'Scale root as a semitone offset (0=C).' },
        enableLoop: { type: 'boolean', description: 'Loop the song (default true).' },
        loopStartBar: { type: ['integer', 'null'], description: 'Loop start page, or null.' },
        loopEndBar: { type: ['integer', 'null'], description: 'Loop end page, or null.' },
        force: { type: 'boolean', description: 'Overwrite an existing (and possibly write-protected) song.' },
      },
      required: ['folder', 'song'],
      additionalProperties: false,
    },
    handler: handleCreateSong,
  },
  {
    name: 'lc_write_page',
    description:
      'Write one page of one channel from a compact pattern string — the main composing tool. ' +
      'One whitespace-separated token per tick starting at tick 0: "." or "R" = empty, "-" = hold the previous note, ' +
      '"<"/">" = hold with fade-in/fade-out, "C5" = note, "C5@25" = note with instrument preset 25. ' +
      'Optional modifiers: *volume(0-7) +effect(letter, e.g. +S slur) ^expression(0-F) ~pan(0-F) %envelope(0-F). ' +
      'Example: "C5@25 . . E5 . G5@25 . . - . . ."  The page is replaced entirely.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name under the music root, or an absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99, description: 'Song number 00..99.' },
        channel: { type: 'integer', minimum: 0, maximum: 4, description: 'Channel: 0-3 melodic, 4 = chord track.' },
        page: { type: 'integer', minimum: 0, description: 'Page index (0-based).' },
        pattern: { type: 'string', description: 'The pattern string, one token per tick.' },
        instrument: { description: 'Default instrument preset id or name for bare notes in this pattern.' },
        ticksPerPage: { type: 'integer', minimum: 1, maximum: 32, description: 'How many ticks of this page play (default: unchanged).' },
        force: { type: 'boolean', description: 'Overwrite a write-protected song.' },
      },
      required: ['folder', 'song', 'channel', 'page', 'pattern'],
      additionalProperties: false,
    },
    handler: handleWritePage,
  },
  {
    name: 'lc_set_notes',
    description:
      'Place individual notes at exact (channel, page, tick) positions — use when a pattern string is awkward. ' +
      'Each event needs channel/page/tick plus note and either instrument (preset id or name) or chord ' +
      '(major/minor/sus4/aug/dim, chord track only). Optional volume/effect/expression/pan/envelope, ' +
      'or clear=true to empty that tick. Events that fail are reported and skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name under the music root, or an absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99, description: 'Song number 00..99.' },
        notes: {
          type: 'array',
          description: 'Note events.',
          items: {
            type: 'object',
            properties: {
              channel: { type: 'integer', minimum: 0, maximum: 4 },
              page: { type: 'integer', minimum: 0 },
              tick: { type: 'integer', minimum: 0, maximum: 31 },
              note: { description: 'Note name such as C4, F#5, Bb3, or "R" for a rest.' },
              instrument: { description: 'Instrument preset id or name.' },
              chord: { type: 'string', description: 'Chord type for the chord track (channel 4).' },
              seventh: { type: 'string', description: '"7" or "M7".' },
              ninth: { type: 'string', description: '"9" or "b9".' },
              chordPower: { type: 'boolean', description: 'Power-chord variant.' },
              volume: { type: 'integer', minimum: 0, maximum: 7 },
              effect: { type: 'string', description: 'Effect letter, e.g. N S V F I D H T A W O P * - + E.' },
              expression: { type: 'integer', minimum: 0, maximum: 15 },
              pan: { type: 'integer', minimum: 0, maximum: 15 },
              envelope: { type: 'integer', minimum: 0, maximum: 15 },
              clear: { type: 'boolean', description: 'Empty this tick instead of writing a note.' },
            },
            required: ['channel', 'page', 'tick'],
            additionalProperties: false,
          },
        },
        force: { type: 'boolean', description: 'Overwrite a write-protected song.' },
      },
      required: ['folder', 'song', 'notes'],
      additionalProperties: false,
    },
    handler: handleSetNotes,
  },
  {
    name: 'lc_clear_pages',
    description: 'Erase every note in the given channels and pages (defaults to all of them).',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name under the music root, or an absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99 },
        channels: { type: 'array', items: { type: 'integer' }, description: 'Channels to clear (default: all 5).' },
        pages: { type: 'array', items: { type: 'integer' }, description: 'Pages to clear (default: all pages).' },
        force: { type: 'boolean', description: 'Overwrite a write-protected song.' },
      },
      required: ['folder', 'song'],
      additionalProperties: false,
    },
    handler: handleClearPages,
  },
  {
    name: 'lc_set_song_options',
    description: 'Change song-level settings: title, editor, speed, page count, ticks per page, loop points, scale.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Folder name under the music root, or an absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99 },
        title: { type: 'string' },
        editor: { type: 'string' },
        speed: { type: 'integer', minimum: 1, maximum: 75 },
        pages: { type: 'integer', minimum: 1, maximum: 256, description: 'Growing keeps existing notes; shrinking drops the tail.' },
        ticksPerPage: { type: 'integer', minimum: 1, maximum: 32 },
        barsPerPage: { type: 'integer', minimum: 1, maximum: 32 },
        enableLoop: { type: 'boolean' },
        loopStartBar: { type: ['integer', 'null'] },
        loopEndBar: { type: ['integer', 'null'] },
        scale: { description: 'Scale name or index.' },
        scaleKey: { type: 'integer', minimum: 0, maximum: 11 },
        force: { type: 'boolean', description: 'Overwrite a write-protected song.' },
      },
      required: ['folder', 'song'],
      additionalProperties: false,
    },
    handler: handleSetSongOptions,
  },
  {
    name: 'lc_list_instruments',
    description:
      'List every instrument preset (id + name), the note modifier syntax, the effect letters, ' +
      'and the available scales. Call this before composing so you pick real presets.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: handleListInstruments,
  },
  {
    name: 'lc_copy_song',
    description: 'Copy a song to another folder/slot (useful to start from an existing tune). Clears write protection.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string', description: 'Source folder name or absolute path.' },
        song: { type: 'integer', minimum: 0, maximum: 99, description: 'Source song number.' },
        toFolder: { type: 'string', description: 'Destination folder name or absolute path.' },
        toSong: { type: 'integer', minimum: 0, maximum: 99, description: 'Destination song number.' },
        title: { type: 'string', description: 'Rename the copy.' },
        force: { type: 'boolean' },
      },
      required: ['folder', 'song', 'toFolder', 'toSong'],
      additionalProperties: false,
    },
    handler: handleCopySong,
  },
  {
    name: 'lc_delete_song',
    description: 'Delete a song file. Requires force=true; there is no undo.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        song: { type: 'integer', minimum: 0, maximum: 99 },
        force: { type: 'boolean', description: 'Must be true to actually delete.' },
      },
      required: ['folder', 'song'],
      additionalProperties: false,
    },
    handler: handleDeleteSong,
  },
];

function callTool(name, args) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`unknown tool '${name}'`);
  try {
    return tool.handler(args || {});
  } catch (error) {
    return fail(String((error && error.message) || error));
  }
}

module.exports = { TOOLS, callTool, SERVER_NOTE };
