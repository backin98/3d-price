const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

(async () => {
  const port = 18788;
  const child = spawn(process.execPath, [path.join('worker', 'online-worker.cjs')], {
    // This spawns the real worker, which writes its catalog cache. Point it at a temp
    // file: without this the job below overwrites data/online-catalog.json.
    env: { ...process.env, INGEST_TOKEN: 'test-token-long-enough', WORKER_PORT: String(port), WORKER_HOST: '127.0.0.1', ONLINE_CATALOG_FILE: path.join(os.tmpdir(), 'worker-http-catalog.json') },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  const started = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('worker did not start: ' + out)), 8000);
    const check = () => {
      if (/Worker listening at/.test(out)) { clearTimeout(t); resolve(true); }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.on('exit', (code) => { clearTimeout(t); reject(new Error('exited ' + code + ': ' + out)); });
  });
  assert.equal(started, true);
  try {
    const duplicate = spawn(process.execPath, [path.join('worker', 'online-worker.cjs')], {
      env: { ...process.env, INGEST_TOKEN: 'test-token-long-enough', WORKER_PORT: String(port), WORKER_HOST: '127.0.0.1' },
      cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe']
    });
    let duplicateOut = '';
    duplicate.stdout.on('data', (c) => { duplicateOut += c; });
    duplicate.stderr.on('data', (c) => { duplicateOut += c; });
    const duplicateCode = await new Promise((resolve, reject) => {
      const t = setTimeout(() => { duplicate.kill(); reject(new Error('duplicate worker kept running')); }, 5000);
      duplicate.on('exit', (code) => { clearTimeout(t); resolve(code); });
    });
    assert.notEqual(duplicateCode, 0, 'a worker that cannot own the port must exit');
    assert.match(duplicateOut, /EADDRINUSE/);

    const pre = await fetch('http://127.0.0.1:' + port + '/health', { method: 'OPTIONS', headers: { Origin: 'https://example.com', 'Access-Control-Request-Method': 'GET' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://example.com');
    const health = await fetch('http://127.0.0.1:' + port + '/health?site=' + encodeURIComponent('https://example.com'));
    const body = await health.json();
    assert.equal(health.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.listen, 'http://127.0.0.1:' + port);
    assert.equal(body.site, 'https://example.com');
    console.log('PASS: worker owns one port, duplicate workers exit, CORS, health and site routing work.');
  } finally {
    child.kill();
  }

  const noToken = spawn(process.execPath, [path.join('worker', 'online-worker.cjs')], {
    env: { ...process.env, INGEST_TOKEN: '', WORKER_PORT: '18789', WORKER_HOST: '127.0.0.1' },
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let noTokOut = '';
  noToken.stdout.on('data', (c) => { noTokOut += c; });
  noToken.stderr.on('data', (c) => { noTokOut += c; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tokenless worker did not start: ' + noTokOut)), 8000);
    const check = () => {
      if (/Worker listening at/.test(noTokOut)) { clearTimeout(t); resolve(true); }
    };
    noToken.stdout.on('data', check);
    noToken.stderr.on('data', check);
    noToken.on('exit', (code) => { clearTimeout(t); reject(new Error('tokenless exited ' + code + ': ' + noTokOut)); });
  });
  noToken.kill();
})().catch((err) => { console.error(err); process.exitCode = 1; });
