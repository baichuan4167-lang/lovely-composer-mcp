"""Replay lcl.load_music()'s steps on any song file, step by step.

The final stage (set_wave_memory_from_lcmusic_settings) calls into doxel's audio
layer, which insists on writing its log next to the game install and kills the
interpreter when that is denied. It runs last so every data step is reported
first. Run this on a stock Lovely Composer sample and on a generated file: if
both reach the same final stage, the generated file is data-equivalent.

    <LC>/app/python/python.exe tools/diagnose_load.py <song.jsonl>
"""
import json
import os
import sys
import traceback

from lcenv import find_lc_app_dir

sys.path.insert(0, find_lc_app_dir())
import lcl  # noqa: E402
import lcl.common as lc_common  # noqa: E402

path = sys.argv[1]
song_id = int(os.path.splitext(os.path.basename(path))[0])
folder = os.path.dirname(path)

print(f"file      : {path}")
print(f"new path  : {lcl.get_music_file_path(folder, song_id)}")
print(f"old path  : {lcl.get_music_file_path(folder, song_id, old_version=True)}")
print()

with open(path, encoding="utf-8") as f:
    header_line = f.readline()
    music_line = f.readline()

st = lcl.LCStatus()
st.header = json.loads(header_line, object_hook=lcl.json_loader_hook)
st.lcm = json.loads(music_line, object_hook=lcl.json_loader_hook)
print(f"[1] read+parse            OK  header={type(st.header).__name__} "
      f"music={type(st.lcm).__name__} title={st.header.title!r}")

del st.lcm.channels.channels[lcl.USER_MUSIC_CHANNEL_COUNT:]
print(f"[2] trim channels         OK  {len(st.lcm.channels.channels)} remain")

if st.header.data_version > lcl.LC_DATA_VERSION:
    print(f"[3] version check         FAIL version {st.header.data_version} > {lcl.LC_DATA_VERSION}")
    sys.exit(1)
print(f"[3] version check         OK  {st.header.data_version} <= {lcl.LC_DATA_VERSION}")

try:
    lcl._old_lcmusic_data_updater(st)
    print("[4] _old_lcmusic_data_updater  OK")
except Exception:
    print("[4] _old_lcmusic_data_updater  RAISED")
    traceback.print_exc()
    sys.exit(1)

pages = st.lcm.pages
notes = sum(
    1
    for ch in st.lcm.channels
    for snd in ch
    for v in snd.vl
    if v.n is not None and v.n >= 0
)
print(f"[5] model usable          OK  pages={pages} speed={st.lcm.speed} "
      f"bpm={lc_common.get_bpm(st.lcm.speed, st.lcm.bars_number_per_page):.0f} notes={notes}")

print("[6] set_wave_memory_from_lcmusic_settings ... (needs doxel audio + game dir writable)")
try:
    lcl.set_wave_memory_from_lcmusic_settings(st)
    print("[6] set_wave_memory_from_lcmusic_settings  OK")
except Exception:
    print("[6] set_wave_memory_from_lcmusic_settings  RAISED")
    traceback.print_exc()
    sys.exit(1)

print("\nALL DATA STAGES PASSED")
