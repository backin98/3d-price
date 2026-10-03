// Thumbnail vision for close catalog calls: perceptual hash of a product photo,
// matched against fingerprints we computed ourselves (local reverse-image search).
// Classical CV only — no VLM, Gemma never sees a pixel. Needs the local PC
// (Playwright decodes JPEG/PNG/WebP); Netlify functions never call this.
//
// ponytail: pHash + aHash on a 32x32 grayscale decode. Color histogram tie-break
// and dHash dropped until a measured mis-merge asks for them.
//
// The decode browser is shared across fingerprints and stays open on purpose.
// Whoever fingerprints a batch must `await shutdown()` when done, or the live
// Chromium keeps the Node process from ever exiting.
const fs = require('node:fs');
const path = require('node:path');
const { isJunkImage } = require('./resolve-product-image.cjs');
const FILAMENT_COLOURS = require('../data/filament-taxonomy.json').colours;

const S = 32;
const VISUAL_SAME = 0.84; // >= this: strong same-product evidence
const VISUAL_WEAK = 0.66; // <= this: vision stays out of the decision
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 8000;
// Resolved lazily, never at module load: Workers has no __dirname and no
// filesystem, yet the server bundle imports this module for VISUAL_SAME /
// VISUAL_WEAK. The phash cache itself is only ever touched by the local PC.
function cacheFile() {
  return process.env.IMAGE_PHASH_FILE || path.join(__dirname, '..', 'data', 'image-phash.json');
}
const COS = Array.from({ length: 8 }, (_, u) => Array.from({ length: S }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * S))));
const NIBBLE = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
const HEX64 = /^[0-9a-f]{16}$/;

function hamming(a, b) {
  if (!HEX64.test(String(a || '')) || !HEX64.test(String(b || ''))) return 64;
  let d = 0;
  for (let i = 0; i < 16; i++) d += NIBBLE[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

function bitsHex(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let out = '';
  let nib = 0;
  values.forEach((v, i) => {
    nib = (nib << 1) | (v > median ? 1 : 0);
    if ((i + 1) % 4 === 0) { out += nib.toString(16); nib = 0; }
  });
  return out;
}

// gray: S*S luminance, row-major. Returns {p, a} — 64-bit hex hashes.
function hashesFromGray(gray) {
  const g = Array.from({ length: S }, (_, y) => Array.from(gray.slice(y * S, y * S + S)));
  const blocks = [];
  for (let by = 0; by < 8; by++) {
    for (let bx = 0; bx < 8; bx++) {
      let sum = 0;
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sum += g[by * 4 + y][bx * 4 + x];
      blocks.push(sum / 16);
    }
  }
  const dct = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let y = 0; y < S; y++) {
        const row = g[y];
        const cu = COS[u][y];
        for (let x = 0; x < S; x++) sum += row[x] * cu * COS[v][x];
      }
      dct.push(sum);
    }
  }
  return { p: bitsHex(dct), a: bitsHex(blocks) };
}

// null when either side has no usable fingerprint; else {score 0-1, distance in bits 0-64}.
function visualScore(a, b) {
  if (!a || !b || !HEX64.test(String(a.p || '')) || !HEX64.test(String(b.p || ''))) return null;
  const distance = hamming(a.p, b.p);
  return { score: Math.max(0, 1 - distance / 64), distance, aDistance: hamming(a.a, b.a) };
}

function mimeOf(b) {
  if (!b || b.length < 12) return '';
  if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return b.subarray(4, 12).toString('latin1').includes('ftypavif') ? 'image/avif' : '';
}

let shared = null;
async function browser() {
  if (!shared) {
    // Dynamic specifier on purpose: esbuild must not try to bundle Playwright into
    // every Netlify function that reaches this module through product-match.
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
    shared = await chromium.launch();
  }
  return shared;
}

async function shutdown() {
  const b = shared;
  shared = null;
  if (b) await b.close().catch(() => {});
}

async function grayFromImage(buf, mime) {
  const b = await browser();
  const page = await b.newPage();
  try {
    return await page.evaluate(async ({ b64, type, size }) => {
      const img = new Image();
      img.src = 'data:' + type + ';base64,' + b64;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; // transparent PNGs read as white, not black
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      const px = ctx.getImageData(0, 0, size, size).data;
      const out = new Array(size * size);
      for (let i = 0; i < out.length; i++) out[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
      return out;
    }, { b64: buf.toString('base64'), type: mime, size: S });
  } finally {
    await page.close().catch(() => {});
  }
}

async function rgbFromImage(buf, mime, size = 48) {
  const b = await browser();
  const page = await b.newPage();
  try {
    return await page.evaluate(async ({ b64, type, size: n }) => {
      const img = new Image();
      img.src = 'data:' + type + ';base64,' + b64;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = n;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Transparent product cut-outs read as white paper, like the thumbnails above.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, n, n);
      ctx.drawImage(img, 0, 0, n, n);
      return Array.from(ctx.getImageData(0, 0, n, n).data);
    }, { b64: buf.toString('base64'), type: mime, size });
  } finally {
    await page.close().catch(() => {});
  }
}

const COLOUR_RGB = Object.entries(FILAMENT_COLOURS || {}).map(([id, row]) => {
  const n = parseInt(String(row.hex || '').slice(1), 16);
  return { id, rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255] };
});

function colourFromPixels(rgba) {
  const votes = new Map();
  let useful = 0;
  for (let i = 0; i + 3 < (rgba || []).length; i += 4) {
    const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]];
    const hi = Math.max(...rgb), lo = Math.min(...rgb);
    if (rgba[i + 3] < 200 || hi > 245 || hi - lo < 35 || hi < 35) continue;
    const nearest = COLOUR_RGB.reduce((best, row) => {
      const distance = row.rgb.reduce((sum, value, at) => sum + (value - rgb[at]) ** 2, 0);
      return !best || distance < best.distance ? { id: row.id, distance } : best;
    }, null);
    if (!nearest || nearest.distance > 18000) continue;
    useful += 1;
    votes.set(nearest.id, (votes.get(nearest.id) || 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || useful < 30 || ranked[0][1] / useful < 0.38) return null;
  return { color: ranked[0][0], confidence: ranked[0][1] / useful };
}

// A product photo as RGBA bytes at size x size (default 96), or null: not an http(s) image, junk, too big, undecodable.
async function pixelsFromUrl(imageUrl, opts = {}) {
  const url = String(imageUrl || '').trim();
  if (!/^https?:/i.test(url) || isJunkImage(url)) return null;
  try {
    const buf = await download(url, opts.signal);
    const mime = mimeOf(buf);
    if (!buf || !mime) return null;
    const size = opts.size || 96;
    return { data: await rgbFromImage(buf, mime, size), w: size, h: size };
  } catch {
    return null;
  }
}

async function detectFilamentColour(imageUrl, opts = {}) {
  const url = String(imageUrl || '').trim();
  if (!/^https?:/i.test(url) || isJunkImage(url)) return null;
  try {
    const buf = await download(url, opts.signal);
    const mime = mimeOf(buf);
    if (!buf || !mime) return null;
    return colourFromPixels(await rgbFromImage(buf, mime));
  } catch {
    return null;
  }
}

async function fingerprintBuffer(buf) {
  const mime = mimeOf(buf);
  if (!mime) return null;
  try {
    const gray = await grayFromImage(buf, mime);
    return hashesFromGray(gray);
  } catch {
    return null; // undecodable bytes are not evidence
  }
}

async function download(url, signal) {
  const signals = [AbortSignal.timeout(TIMEOUT_MS)];
  if (signal) signals.push(signal);
  const res = await fetch(url, { redirect: 'follow', headers: { accept: 'image/*' }, signal: AbortSignal.any(signals) });
  if (!res.ok || !res.body) return null;
  if (Number(res.headers.get('content-length') || 0) > MAX_BYTES) return null;
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

let cache = null;
function cacheData() {
  if (!cache) {
    try { cache = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch { cache = {}; }
  }
  return cache;
}

// Fingerprint an image URL once, then reuse. Cached as {p, a} or null ("tried, unusable").
async function fingerprint(imageUrl, opts = {}) {
  const url = String(imageUrl || '').trim();
  if (!/^https?:/i.test(url) || isJunkImage(url)) return null; // placeholders, shop logos, 1x1 pixels
  const store = cacheData();
  if (url in store) return store[url];
  let fp = null;
  try {
    const buf = await download(url, opts.signal);
    if (buf) fp = await fingerprintBuffer(buf);
  } catch {
    fp = null;
  }
  if (opts.signal?.aborted) return null; // a cancel is not a verdict
  store[url] = fp;
  try {
    const file = cacheFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(store));
  } catch { /* cache is an optimisation; a read-only disk just re-downloads */ }
  return fp;
}

module.exports = {
  VISUAL_SAME,
  VISUAL_WEAK,
  S,
  hamming,
  hashesFromGray,
  visualScore,
  colourFromPixels,
  detectFilamentColour,
  pixelsFromUrl,
  fingerprintBuffer,
  fingerprint,
  shutdown
};
