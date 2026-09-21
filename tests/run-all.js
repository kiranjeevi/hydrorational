// Runs every suite against ../public/index.html and prints a summary.
//   cd tests && npm install && npm test
const { execFileSync } = require('child_process');
const fs = require('fs');

const files = fs.readdirSync(__dirname)
  .filter(f => /^\d\d-.*\.js$/.test(f)).sort();

let pass = 0, fail = 0, bad = [];
for (const f of files) {
  let out = '';
  try { out = execFileSync('node', [f], { cwd: __dirname, encoding: 'utf8' }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const p = /^PASS (\d+)/m.exec(out), q = /^FAIL (\d+)/m.exec(out);
  const np = p ? +p[1] : 0, nq = q ? +q[1] : 0;
  pass += np; fail += nq;
  if (nq) bad.push(f);
  console.log(`${f.padEnd(30)} pass ${String(np).padStart(3)}   fail ${nq}`);
  if (nq) out.split('\n').filter(l => /^\s+FAIL /.test(l)).forEach(l => console.log('   ' + l.trim()));
}
console.log('-'.repeat(52));
console.log(`total: ${pass} passed, ${fail} failed across ${files.length} suites`);
if (fail) { console.log('failing suites: ' + bad.join(', ')); process.exit(1); }
