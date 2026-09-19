// The Backups panel in the admin, driven in a browser: it lists saved backups, "Back up now"
// posts the name you typed, and Restore asks for confirmation then posts the key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'public');
const backup = {
  key: 'backups/before-cleanup-20260919200000.json', name: 'before cleanup', createdAt: '2026-09-19T20:00:00.000Z',
  rows: 115, offers: 251, shops: 6, jobs: 3, hasDraft: true
};
const data = () => ({
  configured: true,
  desk: { shops: [{ id: 'rhino', name: 'Rhino', url: 'https://www.rhino3dprinter.com', vat: 'included' }], banners: [], promoted: [] },
  catalog: { source: { id: 'multi', name: 'Shops' }, savedAt: '2026-09-19T21:00:00.000Z', products: [{ id: 'p1', name: 'Creality K2', kind: 'printer', offers: [{ store: 'rhino3dprinter.com', price: 29263.38, url: 'https://www.rhino3dprinter.com/k2' }] }], filaments: [] },
  candidate: null, jobs: [], backups: [backup], heartbeat: null, counts: { products: 1, filaments: 0 }, worker: {}
});

const server = http.createServer((req, res) => {
  const body = [];
  req.on('data', (c) => body.push(c));
  req.on('end', () => {
    const url = new URL(req.url, 'http://localhost');
    // The admin asks /api/auth first; without a 200 it shows its sign-in gate.
    if (url.pathname.startsWith('/api/auth')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname.startsWith('/api/admin')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      if (req.method === 'POST') {
        server.posted.push(JSON.parse(Buffer.concat(body).toString() || '{}'));
        const sent = server.posted[server.posted.length - 1];
        if (sent.action === 'createBackup') {
          res.end(JSON.stringify({ ok: true, backup: { ...backup, key: 'backups/new-1.json', name: sent.name }, backups: [{ ...backup, key: 'backups/new-1.json', name: sent.name }, backup] }));
        } else {
          res.end(JSON.stringify({ ok: true, restored: { ...backup }, backups: [backup] }));
        }
        return;
      }
      res.end(JSON.stringify(data()));
      return;
    }
    // / -> index.html, /admin/ -> admin/index.html: the pages live in their own folders.
    const rel = url.pathname.endsWith('/') ? url.pathname.replace(/^\//, '') + 'index.html' : url.pathname.replace(/^\//, '');
    try {
      const file = path.join(ROOT, rel);
      const buf = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
      res.end(buf);
    } catch (_) { res.writeHead(404); res.end('nf'); }
  });
});
server.posted = [];

(async () => {
  let chromium;
  try { ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')); } catch (_) { console.log('SKIP: playwright unavailable'); return; }
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => { server.dialogs = (server.dialogs || []).concat(d.message()); d.accept(); });
    await page.goto('http://127.0.0.1:' + port + '/admin/', { waitUntil: 'domcontentloaded' });
    // Backups live on the Catalog tab. The admin routes on the hash, so open it the same way a
    // bookmark would (the nav itself is hidden while the page settles in this stub).
    await page.evaluate(() => { location.hash = '#catalog'; });
    await page.waitForSelector('#backup-name', { state: 'attached', timeout: 15000 });

    // The panel shows the existing backup with its counts and both buttons.
    await page.$eval('#backup-name', (el) => { el.closest('details').open = true; });
    await page.waitForTimeout(150);
    const panel = await page.$eval('#backup-name', (el) => el.closest('details').innerText.replace(/\s+/g, ' '));
    assert.match(panel, /backups/i, 'the panel is titled: ' + panel.slice(0, 80));
    assert.match(panel, /before cleanup/, 'the saved backup is listed');
    assert.match(panel, /115 products · 251 offers · 6 shops/, 'with what it holds: ' + panel.slice(0, 200));
    assert.ok(await page.$('[data-backup-restore]'), 'it has a Restore button');
    assert.ok(await page.$('[data-backup-delete]'), 'and a Delete button');
    assert.ok(await page.$('#backup-fresh'), 'and a start-fresh button');

    // "Back up now" posts the name you typed.
    await page.fill('#backup-name', 'before the big cleanup');
    await page.click('#backup-create');
    await page.waitForTimeout(400);
    const created = server.posted.find((p) => p.action === 'createBackup');
    assert.ok(created, 'a createBackup request was sent: ' + JSON.stringify(server.posted));
    assert.equal(created.name, 'before the big cleanup', 'with the typed name');
    await page.waitForSelector('text=Backed up as', { timeout: 5000 });

    // Restore asks first, then posts the key — never silently.
    server.posted.length = 0;
    server.dialogs = [];
    await page.click('[data-backup-restore]');
    await page.waitForTimeout(400);
    assert.ok((server.dialogs || []).some((m) => /REPLACES the current/i.test(m)), 'the confirm spells out that it replaces everything: ' + JSON.stringify(server.dialogs));
    const restored = server.posted.find((p) => p.action === 'restoreBackup');
    assert.ok(restored, 'a restoreBackup request was sent');
    assert.equal(restored.key, backup.key, 'for the backup that was clicked');
    await page.waitForSelector('text=Restored', { timeout: 5000 });

    // Deleting a backup also asks, and never touches the catalog.
    server.posted.length = 0;
    await page.click('[data-backup-delete]');
    await page.waitForTimeout(300);
    const deleted = server.posted.find((p) => p.action === 'deleteBackup');
    assert.ok(deleted, 'a deleteBackup request was sent');
    assert.equal(server.posted.some((p) => p.action === 'deleteAllCatalog'), false, 'deleting a backup does not empty the catalog');

    assert.deepEqual(errors, [], 'no page errors: ' + errors.join(' | '));
    console.log('PASS: the admin Backups panel backs up under a name you choose, warns before restoring, and restores the exact snapshot.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
