"""Compact structural analyzer for Lovely Composer .jsonl song files."""
import json, sys, collections

TONE = ["T","S","P","N","A","I","F","U","L","D","O","H","=",">","<","W","X","Y","Z"]
EFF = ["N","S","V","F","I","D","H","T","A","W","O","P","*","-","+","E"]
NOTE = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]


def nname(n):
    if n is None or n == -1:
        return "R"
    return NOTE[n % 12] + str(n // 12 - 1)


def describe(v, depth=0, maxdepth=2):
    if isinstance(v, dict):
        tags = [k for k in v if k.startswith("__") and k.endswith("__")]
        if tags:
            return f"<{tags[0]}> keys={sorted(k for k in v if not k.startswith('__'))}"
        if depth >= maxdepth:
            return f"dict(keys={len(v)})"
        return "{" + ", ".join(f"{k}: {describe(x, depth+1, maxdepth)}" for k, x in v.items()) + "}"
    if isinstance(v, list):
        return f"list(len={len(v)})"
    return repr(v)


def main(path):
    with open(path, encoding="utf-8") as f:
        header_line = f.readline()
        body_line = f.readline()
    header = json.loads(header_line)
    m = json.loads(body_line)

    print("=== HEADER ===")
    print(describe(header))
    print()
    print("=== MUSIC KEYS ===")
    for k, v in m.items():
        if k.startswith("__"):
            continue
        if isinstance(v, list) and len(v) == 0:
            print(f"  {k}: []")
        elif isinstance(v, list):
            print(f"  {k}: {describe(v)} head={v[:6] if not isinstance(v[0], (dict, list)) else '...'}")
        elif isinstance(v, dict):
            tag = next((x for x in v if x.startswith("__")), "?")
            if tag == "__LCChannelList__":
                print(f"  {k}: <LCChannelList n={len(v['channels'])}>")
            elif tag == "__LCRhythmList__":
                print(f"  {k}: <LCRhythmList n={len(v['rhythms'])}>")
            else:
                print(f"  {k}: {describe(v)}")
        else:
            print(f"  {k}: {v!r}")

    chans = m["channels"]["channels"]
    print()
    print(f"=== CHANNELS: {len(chans)} ===")
    for ci, chl in enumerate(chans):
        sl = chl["sl"]
        pn = collections.Counter(s.get("play_notes") for s in sl)
        ps = collections.Counter(s.get("play_speed") for s in sl)
        notes = sum(1 for s in sl for v in s["vl"] if v.get("n") is not None)
        print(f"  ch{ci}: pages={len(sl)} play_notes={dict(pn)} play_speed={dict(ps)} notes={notes}")

    print()
    print("=== RHYTHM keys present (union) ===")
    keys = collections.Counter()
    for r in m["rhythms"]["rhythms"]:
        for k in r:
            if not k.startswith("__"):
                keys[k] += 1
    print(f"  n={len(m['rhythms']['rhythms'])} {dict(keys)}")
    print(f"  rhythm[0]={ {k:v for k,v in m['rhythms']['rhythms'][0].items() if not k.startswith('__')} }")

    print()
    print("=== NOTE TUPLES (id,t,v,f,x,p,e) ===")
    c = collections.Counter()
    ids = collections.Counter()
    for chl in chans:
        for s in chl["sl"]:
            for v in s["vl"]:
                if v.get("n") is not None:
                    c[(v.get("id"), v.get("t"), v.get("v"), v.get("f"), v.get("x"), v.get("p"), v.get("e"))] += 1
                    ids[v.get("id")] += 1
    print("  instrument ids used:", dict(sorted(ids.items(), key=lambda kv: -kv[1])))
    for k, n in c.most_common(12):
        print(f"    {k} x{n}")
    print()
    print("=== chord-channel raw sample ===")
    for v in chans[-1]["sl"][1]["vl"][:3]:
        print("   ", {k: x for k, x in v.items() if not k.startswith("__")})


if __name__ == "__main__":
    main(sys.argv[1])
