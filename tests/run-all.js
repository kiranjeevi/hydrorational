// Runs every suite against ../public/index.html and prints a summary.
//   cd tests && npm install && npm test
// A suite that crashes, or prints no PASS line, counts as a failure. A
// missing jsdom once made twenty suites report nothing and the total
// still read as clean.
const { execFileSync } = require('child_process');
const fs = require('fs');

const files = fs.readdirSync(__dirname)
  .filter(f => /^\d\d-.*\.js$/.test(f)).sort();

let pass = 0, fail = 0, bad = [];
for (const f of files) {
  let out = '', crashed = false;
  try { out = execFileSync('node', [f], { cwd: __dirname, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); crashed = true; }
  const p = /^PASS (\d+)/m.exec(out), q = /^FAIL (\d+)/m.exec(out);
  const np = p ? +p[1] : 0;
  let nq = q ? +q[1] : 0;
  let why = '';
  if (!p) { nq = Math.max(nq, 1); why = 'no results reported'; }
  else if (crashed && !nq) { nq = 1; why = 'exited with an error'; }
  pass += np; fail += nq;
  if (nq) bad.push(f);
  console.log(`${f.padEnd(30)} pass ${String(np).padStart(3)}   fail ${nq}${why ? '   (' + why + ')' : ''}`);
  if (why) {
    const m = /Cannot find module '([^']+)'/.exec(out);
    console.log('   ' + (m ? 'missing module ' + m[1] + ', run npm install in tests' : out.trim().split('\n').slice(-2).join(' | ')));
  }
  if (nq) out.split('\n').filter(l => /^\s+FAIL /.test(l)).forEach(l => console.log('   ' + l.trim()));
}
console.log('-'.repeat(52));
console.log(`total: ${pass} passed, ${fail} failed across ${files.length} suites`);
if (fail) { console.log('failing suites: ' + bad.join(', ')); process.exit(1); }
