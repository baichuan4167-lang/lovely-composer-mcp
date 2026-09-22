# Lovely Composer MCP

[![CI](https://github.com/baichuan4167-lang/lovely-composer-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/baichuan4167-lang/lovely-composer-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent **compose
chiptune music in [Lovely Composer](https://store.steampowered.com/app/1604480/Lovely_Composer/)**
on your own machine.

It is a zero-dependency Node.js server speaking the stdio transport. It works by
reading and writing Lovely Composer's `.jsonl` project files, so an agent can
create songs, write melodies / bass / drums / chords, change tempo and loop
points — and you just open the folder in Lovely Composer to listen to it, edit
it, or export it.

*[中文说明见 README.zh-CN.md](README.zh-CN.md)*

## Why this approach

Driving a GUI is brittle: window focus, timing, and whatever else you are doing
on the computer all get in the way. Lovely Composer stores a song as a plain
two-line JSON file, so this server edits the data directly. That means:

- no GUI automation, no window focus, no interference with your desktop;
- the agent gets a precise, inspectable data model instead of pixels;
- the files it writes are the exact files Lovely Composer itself writes — see
  [Verification](#verification) for how that is proven.

## Requirements

- Node.js 18 or newer (for `TextDecoder` with CJK codecs).
- Lovely Composer installed. It is auto-detected in the usual Steam locations
  and in `Documents\LovelyComposer`; override with `LC_MUSIC_ROOT`.

## Install

Clone it anywhere and point your MCP client at `src/server.js`.

```bash
git clone https://github.com/baichuan4167-lang/lovely-composer-mcp.git
cd lovely-composer-mcp
node test/smoke.js     # optional: prove it works on your machine
```

There is nothing to `npm install` — the server has no dependencies.

### Generic MCP client configuration

Most clients take the same stdio server block:

```json
{
  "mcpServers": {
    "lovelycomposer": {
      "command": "node",
      "args": ["/absolute/path/to/lovely-composer-mcp/src/server.js"]
    }
  }
}
```

For Claude Desktop that goes in `claude_desktop_config.json`. Some hosts add a
`cwd` and a `failOnStartupError` flag; both are harmless here.

### Environment variables

| Variable | Used by | Purpose |
|---|---|---|
| `LC_MUSIC_ROOT` | server | Force the music library root instead of auto-detecting it. |
| `LC_MCP_PROTOCOL_VERSION` | server | Pin the negotiated MCP protocol revision (default `2025-06-18`). |
| `LC_SAMPLE_PATH` | `test/smoke.js` | Path to a real `.jsonl` song for the integration checks. |
| `LC_APP_DIR` | `tools/*.py` | Path to `<LovelyComposer>/app`, for the validators below. |

Then just talk to your agent:

> Use Lovely Composer to write me a 16-bar 8-bit loop in A minor with a melody,
> a bass line and drums.

> Read song 00 in the DSH folder and raise page 2's melody by an octave.

## Tools

| Tool | What it does |
|---|---|
| `lc_status` | Reports the install path, music root, writability and the data model. Call this first. |
| `lc_list_folders` | Lists the song folders in the music library. |
| `lc_list_songs` | Lists songs in a folder (title / speed / pages / notes per channel). |
| `lc_read_song` | Reads a song and prints each channel as compact per-page patterns. |
| `lc_create_song` | Creates an empty song (and the `lcdata.jsonl` a new folder needs). |
| `lc_write_page` | **The main composing tool.** Writes one page of one channel from a pattern string. |
| `lc_set_notes` | Places notes at exact `(channel, page, tick)`, including chord-track chords. |
| `lc_clear_pages` | Erases the given channels and pages. |
| `lc_set_song_options` | Title, author, speed, page count, ticks per page, loop points, scale. |
| `lc_list_instruments` | Every instrument preset, effect letter and scale. |
| `lc_copy_song` | Copies a song (handy to start from an existing tune). |
| `lc_delete_song` | Deletes a song file; requires `force=true`. |

### Pattern string syntax

`lc_write_page` takes one whitespace-separated token per tick, starting at tick
0, up to 32 ticks per page:

```
C5@25 . . E5 . G5@25 . . - . . .     C5 with preset 25; "." empty; "-" hold
```

| Token | Meaning |
|---|---|
| `.` / `R` | empty tick |
| `-` | hold: extend the previous note |
| `<` / `>` | hold with fade-in / fade-out |
| `C4` | note using the page's default instrument |
| `C4@25` | note with instrument preset 25 |
| `C4@flute` | instrument by name |
| `C4@16*7+D^A~8%3` | plus volume `*`0-7, effect `+`, expression `^`0-F, pan `~`0-F, envelope `%`0-F |
| `C4:S4NC00::2` | a raw Lovely Composer voice string, used verbatim |

**Common presets** (full list via `lc_list_instruments`):
`0` pulse · `1` triangle · `2` square · `3` noise · `4` piano · `7` drum ·
`16` sawtooth · `25` flute · `30` stomp (kick) · `33` punch (snare) ·
`35` short-freq noise (hat) · `47` low-reso triangle (bass) · `56` bell ·
`68` fast arpeggio.

**Effect letters:** `N` none · `S` slur/slide · `V` vibrato · `F` fade out ·
`I` fade in · `D` drop · `H` hop · `A` fast arpeggio · `P` phaser, and more.

## Data model

A song is one folder entry, `<music>/<FOLDER>/<NN>.jsonl` (`NN` = `00`..`99`):

- **5 channels**: 0–3 melodic, 4 = the chord track.
- Each song has `pages` pages, each page up to **32 ticks**.
- Every page carries its own length (`ticksPerPage`) and speed.
- Default `barsPerPage=4`: 4 bars per page, 8 ticks per bar.
- Scientific pitch notation: `C4` is middle C, range A0–C8.
- Tempo: `bpm = 900 × barsPerPage / speed`, so **lower `speed` means a faster
  song**. `speed=30, bars=4` gives 120 BPM.

Chord-track notes use Lovely Composer's chord encoding:
`id = ((type + velocity<<4 + seventh<<6 + ninth<<8) << 16) + 65536`, where type
is 1=major, 2=minor, 3=sus4, 4=aug, 5=dim. With `lc_set_notes` you just write
`chord: "minor"`.

## ⚠️ Lovely Composer rewrites the whole folder on save

This matters more than anything else in this README:

- Lovely Composer reads the entire folder when it opens it and **rewrites all 100
  song files** when it saves. Reload the folder (or restart LC) to see what the
  agent wrote.
- If LC currently has the folder open, **do not press save in LC** before
  reloading, or it will overwrite what the agent just wrote.
- Songs LC marks as write-protected (`write_protected_flag`; all the bundled
  sample songs are) are refused by default. Pass `force=true` to override.

## The file format

The serialization is a straight `obj.__dict__` dump tagged with the class name:

```json
{"__LCVoice__": true, "n": 60, "t": 1, "v": 4, "f": 0, "id": 2, "x": 12, "p": 0, "e": 0}
```

`n` pitch (`null` empty, `-1` rest) · `t` oscillator · `v` volume 0-7 ·
`f` effect · `id` instrument preset · `x` expression · `p` pan · `e` envelope.

**The `__LCVoice__` tag has to be the first key.** LC's `json_loader_hook` walks
the dict and rebuilds a real object from the first key that names a class it
knows; without the tag the voice degrades to a plain dict and LC then breaks on
attribute access.

A song file is exactly two lines (CRLF-separated, no trailing newline after the
second — matching what LC writes):

```
{"__LCMusicDataHeader__": true, ...}
{"__LCMusic__": true, "speed":…, "channels":{…}, "rhythms":{…}, …}
```

LC builds a default instance and merges the loaded dict over it, so **omitted
keys keep LC's own defaults**. This implementation writes only the keys it
actually needs and lets LC supply wave memory, sampling modulators and the rest.

Container hierarchy: `LCMusic` → `LCChannelList.channels[5]` →
`LCSoundList.sl[pages]` → `LCSound.vl[32]` → `LCVoice`.

### ⚠️ Encoding: LC reads files with the system ANSI code page, not UTF-8

LC reads and writes project files with Python's `open(path)` and **no explicit
encoding**, so it uses the locale default — **GBK/cp936** on a Chinese Windows,
cp932 on a Japanese one.

A UTF-8 file with a non-ASCII title makes LC raise `UnicodeDecodeError`, so
`load_music()` fails and **the song simply will not open**. The trap is subtle
because LC's own sample songs have pure-ASCII titles.

How this project handles it:

- **Writing** — every non-ASCII character is escaped to `\uXXXX`, so the file is
  **pure ASCII** on disk. Pure ASCII decodes identically under GBK and UTF-8, so
  it works on any locale.
- **Reading** — try strict UTF-8 first, then fall back through GB18030 / GBK /
  Big5 / Shift_JIS, taking the first result that `JSON.parse` accepts (LC stores
  non-ASCII as raw GBK bytes when it saves).

### Tempo and grid: `barsPerPage` drives both BPM and resolution

`bpm = 900 × barsPerPage / speed`, and a page always plays `ticksPerPage` ticks,
so **changing `barsPerPage` changes both the tempo and the editable resolution**:

| barsPerPage | ticksPerPage | ticks per bar | finest note | for 180 BPM use |
|---|---|---|---|---|
| 4 (default) | 32 | 8 | eighth note | speed 30 → 120 BPM |
| 2 | 32 | 16 | sixteenth note | speed 10 |
| **1** | 32 | 32 | **thirty-second note** | **speed 5** |

For J-core / denpa sixteenth-note runs, use `barsPerPage=1, ticksPerPage=32`:
one page is then one bar, and 1 tick = a 32nd note.

Instrument preset parameters come from the game's `app/lcl/common.py`
(`VOICE_STR_LIST`, after LC's own expression/pan post-processing) and were
checked entry by entry against real project files.

## Verification

The claim "the files it writes are real Lovely Composer files" is tested with the
game's own code, not just with this project's parser:

```powershell
$py = "<LovelyComposer>\app\python\python.exe"

# Full validation: model types, containers, and an LCJSONEncoder round trip
& $py -u tools/validate_with_lc.py "<music>\DSH\01.jsonl"

# Replay lcl.load_music() stage by stage, next to an LC sample song
& $py -u tools/diagnose_load.py "<music>\DSH\01.jsonl"
```

With `LC_APP_DIR` unset these search the usual Steam locations; set it to
`<LovelyComposer>\app` if your install lives somewhere unusual.

`diagnose_load.py` prints every stage of LC opening a song. A generated song
reaches exactly the same stages as an LC sample:

```
[1] read+parse            OK  header=LCMusicDataHeader music=LCMusic title='…'
[2] trim channels         OK  5 remain
[3] version check         OK  16 <= 16
[4] _old_lcmusic_data_updater  OK
[5] model usable          OK  pages=48 speed=5 bpm=181 notes=2158
[6] set_wave_memory_from_lcmusic_settings ... (doxel audio layer, needs a writable game dir)
```

> Stage 6 aborts the process: doxel insists on writing its log inside the game
> install directory and calls `os._exit()` when that is denied, e.g. under a
> restricted sandbox. That is unrelated to the data format — LC's own sample
> songs stop at the same point in the same environment.

## Included demos

Two songs were written with this server and live in the `DSH` folder of the
author's library:

| # | Title | Notes |
|---|---|---|
| `00` | Neon Loop | 8-bar beginner loop, A minor, melody / bass / drums / chords. |
| `01` | 配信中毒 - STREAM OVERDOSE | 48-bar piece, 180 BPM, F# minor, denpa / J-core, 2158 notes. |

`compositions/stream-overdose.js` regenerates the second one.

## Development

```bash
node test/smoke.js            # 36 self-checks: round trips, encoding fallback, DSL
node test/demo-song.js        # compose a demo song into .tmp-test/DEMO
node test/demo-song.js DSH 1  # write straight into a real library folder
node src/server.js < test/protocol-probe.jsonl   # exercise the JSON-RPC layer
```

The self-test covers note-name conversion, the instrument table, chord encoding,
the pattern DSL, full song round trips, write protection and the GBK fallback.
When a real Lovely Composer install is present it also round-trips a song the
game wrote — and silently skips that part when there is none, so CI stays green.

## Files

| File | Purpose |
|---|---|
| `src/lc.js` | Format engine: constants, note/instrument/chord conversion, pattern parsing, project file I/O and encoding. |
| `src/tools.js` | The 12 MCP tool definitions and their implementations. |
| `src/server.js` | stdio JSON-RPC MCP server (zero dependencies, hand-written protocol layer). |
| `compositions/stream-overdose.js` | Full composition generator (denpa / J-core, 48 bars, 2158 notes). |
| `test/smoke.js` | Self-test suite. |
| `test/demo-song.js` | Demo composer that goes through the tool handlers. |
| `test/protocol-probe.jsonl` | JSON-RPC probe requests. |
| `tools/validate_with_lc.py` | Validates a file with the game's own `lcl` module. |
| `tools/diagnose_load.py` | Replays LC's `load_music()` step by step. |
| `tools/lcenv.py` | Finds the game install so the validators can import `lcl`. |
| `tools/check-encoding.js` | Flags song files containing non-ASCII bytes. |
| `tools/analyze_lc.py` | Structural analyzer used during reverse engineering. |

## Known limitations

- **It can only write project files; it cannot trigger an export.** Export to
  WAV/MIDI from Lovely Composer itself, or set up an LC addon to do it.
- It does not drive LC's GUI, so it never depends on window focus.
- Wave memory and sampling modulator parameters are left to LC's defaults and
  are not editable here.
- The rhythm track (`rhythms`) uses LC's new-song defaults; there is no editing
  interface for it yet.

## License

[MIT](LICENSE)
