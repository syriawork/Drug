const fs = require('fs');
const base = 'e:\\programs and applications\\desktop\\drug-manager';
const target = `${base}\\tests\\stage36a2\\operation-journal.test.ts`;
const raw = fs.readFileSync(target);
const cut = 27240; // last good byte before the UTF-16 corruption starts at 27241
let s = raw.slice(0, cut).toString('utf8');
if (!s.endsWith('\n')) s += '\n';
for (const block of [
  'stage36a2b-block-a1.ts',
  'stage36a2b-block-a2.ts',
  'stage36a2b-block-a3.ts',
  'stage36a2b-block-a4.ts',
  'stage36a2b-block-b1.ts',
  'stage36a2b-block-b2.ts',
]) {
  const content = fs.readFileSync(`${base}\\${block}`, 'utf8');
  s += content + '\n';
}
fs.writeFileSync(target, s, 'utf8');
// sanity: no non-ASCII/control bytes except newline/tab
let bad = 0;
for (let i = 0; i < s.length; i++) {
  const c = s.charCodeAt(i);
  if ((c < 0x20 || c >= 0x7f) && c !== 0x0a && c !== 0x0d && c !== 0x09) bad++;
}
console.log('written bytes=' + Buffer.byteLength(s, 'utf8') + ' badChars=' + bad + ' lines=' + s.split('\n').length);