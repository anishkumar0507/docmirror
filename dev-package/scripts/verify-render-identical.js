'use strict';

/* ──────────────────────────────────────────────────────────────────────────
   Proves the rendered pages did not change.

     node scripts/verify-render-identical.js

   Spawns the real server twice as a child process — once with the CMS switched
   off, once with it on and contributing zero posts — and compares the actual
   HTTP responses byte for byte.

   Zero CMS posts is the state on the day of deployment. If the two responses
   are identical, connecting the CMS cannot have changed what a visitor or a
   crawler sees. That is a stronger claim than "it looks the same".

   Child processes rather than in-process requires: `server.js` only calls
   app.listen() when `require.main === module`, and requiring it twice in one
   process would share module state across both runs. Spawning is exactly how
   the app really starts.
   ────────────────────────────────────────────────────────────────────────── */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server.js');
const CWD = path.join(__dirname, '..');

let pass = 0;
let fail = 0;

function report(ok, name, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail) console.log(`        ${detail}`); }
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, timeout: 20000 }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
  });
}

async function waitReady(port, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await get(port, '/resources');
      if (r.status === 200) return;
    } catch (_) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error(`server never answered on port ${port}`);
}

/**
 * dotenv does not overwrite variables that already exist in process.env, so
 * passing CMS_API_URL='' here reliably disables the CMS even though
 * config/.env.local sets it.
 */
function startServer(port, extraEnv) {
  const child = spawn(process.execPath, [SERVER], {
    cwd: CWD,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});   // drained, not printed — startup noise
  child.stderr.on('data', () => {});
  return child;
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.once('exit', () => resolve());
    child.kill();
    setTimeout(resolve, 2000);
  });
}

/** Removes values that legitimately differ run to run, so content is compared. */
function normalise(body) {
  return body
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
    .replace(/"dateModified"\s*:\s*"[^"]*"/g, '"dateModified":"<TS>"')
    .replace(/\r\n/g, '\n');
}

(async () => {
  const CMS_URL = process.env.VERIFY_CMS_API_URL || 'http://localhost:3000/api/v1';
  const CMS_KEY = process.env.VERIFY_CMS_API_KEY || '';

  let off, on;

  try {
    console.log('\nBooting with the CMS OFF (baseline)');
    off = startServer(4801, { CMS_API_URL: '', CMS_API_KEY: '' });
    await waitReady(4801);

    const paths = ['/resources', '/sitemap.xml'];
    const baseline = {};
    for (const p of paths) baseline[p] = await get(4801, p);

    const m = /\/resources\/([a-z0-9][a-z0-9-]*)"/.exec(baseline['/resources'].body);
    const articlePath = m ? `/resources/${m[1]}` : null;
    if (articlePath) {
      baseline[articlePath] = await get(4801, articlePath);
      paths.push(articlePath);
    }
    console.log(`  captured: ${paths.join(', ')}`);

    await stop(off);
    off = null;

    if (!CMS_KEY) {
      console.log('\n  SKIP  set VERIFY_CMS_API_KEY to compare against a live CMS');
      console.log(`\nBASELINE ONLY  ${pass} passed, ${fail} failed\n`);
      process.exitCode = 0;
      return;
    }

    console.log('\nBooting with the CMS ON (zero CMS posts — deployment-day state)');
    on = startServer(4802, {
      CMS_API_URL: CMS_URL,
      CMS_API_KEY: CMS_KEY,
      CMS_CONTENT_MODE: 'merge',
    });
    await waitReady(4802);

    console.log('\nComparison');
    for (const p of paths) {
      const after = await get(4802, p);

      report(after.status === baseline[p].status,
        `${p} — status ${baseline[p].status}`,
        after.status === baseline[p].status ? undefined : `became ${after.status}`);

      const a = normalise(baseline[p].body);
      const b = normalise(after.body);

      if (a === b) {
        report(true, `${p} — byte-identical`, `${b.length} bytes`);
      } else {
        let i = 0;
        while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
        report(false, `${p} — differs`,
          `first difference at byte ${i} of ${a.length}/${b.length}\n` +
          `        before: ${JSON.stringify(a.slice(Math.max(0, i - 70), i + 70))}\n` +
          `        after:  ${JSON.stringify(b.slice(Math.max(0, i - 70), i + 70))}`);
      }
    }

    console.log(`\n${fail === 0 ? 'RENDERING IS IDENTICAL' : `${fail} DIFFERENCE(S) FOUND`}  ` +
                `${pass} passed, ${fail} failed\n`);
    process.exitCode = fail === 0 ? 0 : 1;
  } catch (err) {
    console.error(`\nharness error: ${err && err.message}\n`);
    process.exitCode = 1;
  } finally {
    await stop(off);
    await stop(on);
  }
})();
