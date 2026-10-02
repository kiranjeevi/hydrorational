// Copies src/terrain-core.js and src/flow-core.js into public/index.html
// between their BEGIN and END markers, with the node exports stripped.
// Edit the source files, then run:  node tools/inline-core.js
// Suite 12 checks that the two copies are byte identical.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = path.join(root, 'public', 'index.html');
let html = fs.readFileSync(page, 'utf8');

const strip = s => s.replace(/\nif \(typeof module !== 'undefined'\) \{[\s\S]*?\n\}\n/g, '\n').trim();

[['terrain-core', 'src/terrain-core.js'], ['flow-core', 'src/flow-core.js']].forEach(([name, file]) => {
  const BEGIN = '/* ===== BEGIN ' + name + ' (generated from ' + file + ', do not edit here) ===== */';
  const END = '/* ===== END ' + name + ' ===== */';
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a) { console.error('markers for ' + name + ' not found'); process.exit(1); }
  const body = strip(fs.readFileSync(path.join(root, file), 'utf8'));
  html = html.slice(0, a + BEGIN.length) + '\n' + body + '\n' + html.slice(b);
  console.log('inlined ' + file);
});
fs.writeFileSync(page, html);
