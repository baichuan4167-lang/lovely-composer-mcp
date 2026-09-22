"""Validate a generated .jsonl song with Lovely Composer's OWN deserializer.

Runs against the Python interpreter bundled with the game, so `import lcl`
gives us the real data model and the real `json_loader_hook`.

    <LC>/app/python/python.exe tools/validate_with_lc.py <song.jsonl>
"""
import json
import os
import sys

from lcenv import find_lc_app_dir

sys.path.insert(0, find_lc_app_dir())

import lcl  # noqa: E402


def main(path):
    print(f"LC data version: {lcl.LC_DATA_VERSION}  channels: {lcl.USER_MUSIC_CHANNEL_COUNT}"
          f"  max ticks/page: {lcl.MAX_SOUND_LENGTH}")
    print(f"file: {path}")
    print()

    with open(path, encoding="utf-8") as f:
        header_line = f.readline()
        body_line = f.readline()

    # Exactly what lcl.load_music() does internally.
    header = json.loads(header_line, object_hook=lcl.json_loader_hook)
    music = json.loads(body_line, object_hook=lcl.json_loader_hook)

    assert isinstance(header, lcl.LCMusicDataHeader), f"header type is {type(header)}"
    assert isinstance(music, lcl.LCMusic), f"body type is {type(music)}"
    print(f"OK  header -> {type(header).__name__}  title={header.title!r} "
          f"editor={header.editor!r} version={header.data_version}")
    print(f"OK  body   -> {type(music).__name__}  speed={music.speed} pages={music.pages} "
          f"bars/page={music.bars_number_per_page} ticks={music.play_notes}")

    # The channel/page/voice containers must behave like LC's own types.
    assert isinstance(music.channels, lcl.LCChannelList), type(music.channels)
    assert isinstance(music.rhythms, lcl.LCRhythmList), type(music.rhythms)
    assert len(music.channels) == lcl.USER_MUSIC_CHANNEL_COUNT
    print(f"OK  containers -> {type(music.channels).__name__}[{len(music.channels)}] "
          f"{type(music.rhythms).__name__}[{len(music.rhythms)}]")

    # Every voice must be a real LCVoice and readable through LC's accessors.
    total = 0
    print()
    for ch in range(len(music.channels)):
        sound_list = music.channels[ch]
        notes = 0
        instruments = set()
        for bar in range(len(sound_list)):
            snd = sound_list[bar]
            assert isinstance(snd, lcl.LCSound), type(snd)
            for tick in range(len(snd.vl)):
                v = snd.vl[tick]
                assert isinstance(v, lcl.LCVoice), type(v)
                if v.n is not None and v.n >= 0:
                    notes += 1
                    total += 1
                    if v.id is not None and v.id < lcl.MIN_CHORD_VOICE_ID:
                        instruments.add(v.id)
                    # Exercise LC's own note/tone formatters on our data.
                    v.note_name()
                    v.tone_char()
        print(f"  ch{ch}: pages={len(sound_list)} notes={notes} instruments={sorted(instruments)}")

    print(f"\nOK  {total} notes parsed as real LCVoice objects")

    # Re-serialize with LC's own encoder and re-parse: a full round trip.
    blob = json.dumps(music, cls=lcl.LCJSONEncoder)
    again = json.loads(blob, object_hook=lcl.json_loader_hook)
    assert isinstance(again, lcl.LCMusic)
    assert again.pages == music.pages
    assert again.speed == music.speed
    print(f"OK  LCJSONEncoder round trip ({len(blob)} bytes)")

    # Show a musical summary rendered by LC's own formatters.
    try:
        import lcl.common as lc_common
        name_dict = lc_common.VOICE_NAME_DICT
    except Exception:  # noqa: BLE001
        name_dict = {}

    print("\nFirst notes on channel 0, as LC renders them:")
    shown = 0
    for bar in range(len(music.channels[0])):
        for tick, v in enumerate(music.channels[0][bar].vl):
            if v.n is not None and v.n >= 0 and shown < 10:
                name = name_dict.get(v.id, "") if v.id is not None else ""
                print(f"  page {bar:>2} tick {tick:>2}  {v.voice_name()!r}  ({name})")
                shown += 1
    if shown == 0:
        print("  (channel 0 is empty)")

    print("\nVALIDATION PASSED (format, model types, LC encoder round trip)")

    # Last, because it can terminate the interpreter: lcl.load_music() logs through
    # doxel, which insists on writing its log inside the game install directory and
    # calls os._exit() when that write is denied (e.g. under a confined sandbox).
    # This needs no version migration for our files: the header carries
    # data_version == LC_DATA_VERSION, so LC's upgrade path is a no-op.
    song_id = int(os.path.splitext(os.path.basename(path))[0])
    st = lcl.LCStatus()
    print("\nProbing LC's own folder loader (may abort if doxel cannot log)...")
    try:
        ok = lcl.load_music(os.path.dirname(path), song_id, st)
        print(f"OK  lcl.load_music(dir, {song_id}) -> {bool(ok)}")
        if ok:
            assert isinstance(st.lcm, lcl.LCMusic)
            print(f"    LC read title={st.header.title!r} pages={st.lcm.pages}")
    except Exception as exc:  # noqa: BLE001
        print(f"NOTE lcl.load_music() raised {type(exc).__name__}: {exc}")


if __name__ == "__main__":
    main(sys.argv[1])
