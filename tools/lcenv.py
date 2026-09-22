"""Locate a Lovely Composer installation so the game's bundled `lcl` package
can be imported.

The validation helpers in this folder import `lcl` from the copy of the game
that is installed on the machine, which gives them the *real* data model, the
real `json_loader_hook` and the real `LCJSONEncoder`. That directory is
machine-specific, so it is resolved at runtime:

1. the `LC_APP_DIR` environment variable, if set
2. the usual Steam library locations on Windows, macOS and Linux

Set `LC_APP_DIR` (for example ``LC_APP_DIR=D:\\SteamLibrary\\steamapps\\common\\
LovelyComposer\\app``) to override the search.
"""
import os
from pathlib import Path

_STEAM_SUFFIX = Path("steamapps/common/LovelyComposer/app")

_CANDIDATES = [
    os.environ.get("LC_APP_DIR"),
    Path(r"D:\SteamLibrary") / _STEAM_SUFFIX,
    Path(r"C:\Program Files (x86)\Steam") / _STEAM_SUFFIX,
    Path(r"C:\Program Files\Steam") / _STEAM_SUFFIX,
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Steam" / _STEAM_SUFFIX,
    Path.home() / ".steam/steam" / _STEAM_SUFFIX,
    Path.home() / ".local/share/Steam" / _STEAM_SUFFIX,
    Path.home() / "Library/Application Support/Steam" / _STEAM_SUFFIX,
]


def find_lc_app_dir():
    """Return the absolute path of Lovely Composer's ``app`` directory.

    Raises SystemExit with an actionable message when nothing is found.
    """
    seen = []
    for candidate in _CANDIDATES:
        if not candidate:
            continue
        path = Path(candidate)
        seen.append(str(path))
        # `lcl/` is the package we are about to import.
        if (path / "lcl").is_dir():
            return str(path.resolve())

    raise SystemExit(
        "Could not find the Lovely Composer app directory.\n"
        "Set LC_APP_DIR to <steam library>/steamapps/common/LovelyComposer/app\n"
        "Searched:\n  " + "\n  ".join(seen)
    )
