# Contributing

Thanks for taking a look at Lovely Composer MCP. This is a small, deliberately
dependency-free project, so contributing is mostly about keeping it that way.

## Getting set up

```bash
git clone https://github.com/baichuan4167-lang/lovely-composer-mcp.git
cd lovely-composer-mcp
node --version   # needs Node 18 or newer
npm test         # runs test/smoke.js
```

There is nothing to install — `dependencies` is intentionally empty.

## Before opening a pull request

1. `npm test` passes. It exercises the format engine, every tool handler, the
   GBK/UTF-8 decode fallback and (when a Lovely Composer install is present) a
   round trip against a song the game itself wrote.
2. New behaviour comes with a new assertion in `test/smoke.js`. `check(name, fn)`
   is all you need; it collects failures instead of throwing.
3. No new runtime dependencies. Everything here is Node built-ins plus the
   standard library, which is what makes the server trivial to run anywhere.

## What is most welcome

- **Corrections to the reverse-engineered format**, backed by a real `.jsonl`
  file or by the game's own `lcl` sources. The strongest evidence is a passing
  run of `tools/validate_with_lc.py`, which loads a file with the game's real
  deserializer.
- **New instrument/effect/scale data** verified against `app/lcl/common.py`.
- **Robustness fixes** for the encoding fallback and for corrupt song files.
- **Additional MCP clients** documented in the README install section.

## Changing the file format code

`src/lc.js` writes files that a shipped game must be able to open. Two rules
matter more than anything else:

- Every object that LC reconstructs must carry its `__LC*__` tag **as the first
  key**, because `json_loader_hook` picks the class from the first key it
  recognises.
- Output must stay pure ASCII (`\uXXXX` escapes) because LC reads files with the
  platform locale codec, not UTF-8.

If you touch either of those, say so in the pull request description.

## Reporting bugs

Please include:

- your operating system and Node version,
- the Lovely Composer version,
- the tool call you made and the exact error text,
- if the problem is about a specific song, the two lines of the `.jsonl` file
  (they are just JSON, but check for anything personal first).

## License

By contributing you agree that your contribution is licensed under the MIT
License, as described in [LICENSE](LICENSE).
