'use strict';
const fs = require('fs');
const path = require('path');

const roots = process.argv.slice(2);
for (const dir of roots) {
  let checked = 0;
  let nonAscii = 0;
  const samples = [];
  for (const f of fs.readdirSync(dir)) {
    if (!/^\d{2}\.jsonl$/.test(f)) continue;
    const buf = fs.readFileSync(path.join(dir, f));
    checked += 1;
    let hasHigh = false;
    for (const b of buf) if (b > 127) { hasHigh = true; break; }
    if (hasHigh) {
      nonAscii += 1;
      if (samples.length < 4) {
        const latin = buf.toString('latin1');
        const m = /"title":\s*"([^"]*)"/.exec(latin);
        const gbk = (() => { try { return new TextDecoder('gbk').decode(buf); } catch { return null; } })();
        const gm = gbk ? /"title":\s*"([^"]*)"/.exec(gbk) : null;
        samples.push({ file: f, bytes: buf.length, titleAsGbk: gm ? gm[1] : null, titleAsUtf8: m ? m[1] : null });
      }
    }
  }
  console.log(`${dir}\n  checked=${checked} withNonAsciiBytes=${nonAscii}`);
  for (const s of samples) console.log('   ', JSON.stringify(s));
}

console.log('\n--- TextDecoder support in this Node ---');
for (const enc of ['gbk', 'gb18030', 'gb2312', 'big5', 'shift_jis', 'utf-8']) {
  try { new TextDecoder(enc); console.log(`   ${enc.padEnd(10)} OK`); }
  catch { console.log(`   ${enc.padEnd(10)} MISSING`); }
}
