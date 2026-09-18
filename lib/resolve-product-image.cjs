// Shared product image picker for every shop. No per-CDN special cases.

const LAZY_ATTRS = [
  'data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-url',
  'data-image', 'data-full', 'data-zoom-image', 'data-large_image',
  'data-srcset', 'data-lazy-srcset'
];

const JUNK = /(?:^|[\/._-])(?:placeholder|no[-_]?image|spacer|1x1|default-product|loader|spinner|pixel)(?:[\/._-]|$)|loader\.gif|pixel\.(gif|png)/i;

function attr(attrs, name) {
  const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=["\']([^"\']+)["\']', 'i');
  return ((String(attrs || '').match(re) || [])[1] || '').trim();
}

function absolutize(src, pageUrl) {
  if (!src) return '';
  let s = String(src).trim().replace(/&amp;/gi, '&').replace(/&quot;/g, '"').split(',')[0].trim().split(/\s+/)[0];
  if (!s) return '';
  try {
    const u = new URL(s, pageUrl || 'https://example.invalid');
    if (u.protocol === 'http:') u.protocol = 'https:';
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    return u.href;
  } catch {
    return '';
  }
}

function isJunkImage(url) {
  const s = String(url || '');
  if (!s) return true;
  if (/^data:/i.test(s) && s.length < 80) return true;
  if (/^blob:/i.test(s)) return true;
  if (JUNK.test(s)) return true;
  if (/[?&](?:w|h|width|height)=1(?:&|$)/i.test(s)) return true;
  if (/\/logo\.(png|jpg|svg|webp)(?:\?|$)/i.test(s)) return true;
  return false;
}

function pickSrcset(raw, pageUrl) {
  const parts = String(raw || '').split(',').map((p) => p.trim()).filter(Boolean);
  let best = '';
  let bestW = -1;
  for (const part of parts) {
    const bits = part.split(/\s+/);
    const url = bits[0];
    const desc = bits[1] || '';
    const w = /w$/i.test(desc) ? Number(desc.slice(0, -1)) : /x$/i.test(desc) ? Number(desc.slice(0, -1)) * 1000 : 0;
    const abs = absolutize(url, pageUrl);
    if (!abs || isJunkImage(abs)) continue;
    if (w >= bestW) {
      bestW = w;
      best = abs;
    }
  }
  return best;
}

function fromJsonLd(html, pageUrl) {
  const blocks = String(html || '').matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const b of blocks) {
    try {
      const j = JSON.parse(b[1]);
      const nodes = Array.isArray(j) ? j : j['@graph'] ? j['@graph'] : [j];
      for (const n of nodes) {
        if (!n || !/Product|ImageObject/i.test(String(n['@type'] || ''))) continue;
        const img = n.image;
        const first = Array.isArray(img) ? (img[0] && (img[0].url || img[0])) : (img && (img.url || img));
        const abs = absolutize(String(first || ''), pageUrl);
        if (abs && !isJunkImage(abs)) return abs;
      }
    } catch { /* ignore */ }
  }
  return '';
}

function fromMeta(html, pageUrl) {
  for (const prop of ['og:image', 'twitter:image']) {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop.replace(':', '\\:') + '["\'][^>]+content=["\']([^"\']+)', 'i');
    const alt = new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + prop.replace(':', '\\:') + '["\']', 'i');
    const raw = ((String(html || '').match(re) || String(html || '').match(alt) || [])[1] || '').trim();
    const abs = absolutize(raw, pageUrl);
    if (abs && !isJunkImage(abs)) return abs;
  }
  return '';
}

function fromPicture(html, pageUrl) {
  const urls = [];
  for (const m of String(html || '').matchAll(/<source\b([^>]*)>/gi)) {
    const set = attr(m[1], 'srcset') || attr(m[1], 'data-srcset');
    const picked = pickSrcset(set, pageUrl);
    if (picked) urls.push(picked);
  }
  return urls.find((u) => !/\.webp(?:\?|#|$)/i.test(u)) || urls[urls.length - 1] || '';
}

function fromImgs(html, pageUrl) {
  const imgs = [...String(html || '').matchAll(/<img\b([^>]*)>/gi)];
  for (const m of imgs) {
    const attrs = m[1] || '';
    for (const name of LAZY_ATTRS) {
      const raw = attr(attrs, name);
      if (!raw) continue;
      const picked = /srcset/i.test(name) ? pickSrcset(raw, pageUrl) : absolutize(raw, pageUrl);
      if (picked && !isJunkImage(picked)) return picked;
    }
    const set = attr(attrs, 'srcset');
    const fromSet = pickSrcset(set, pageUrl);
    if (fromSet) return fromSet;
    const src = absolutize(attr(attrs, 'src'), pageUrl);
    if (src && !isJunkImage(src)) return src;
  }
  return '';
}

function fromBackground(html, pageUrl) {
  const m = String(html || '').match(/background-image\s*:\s*url\((['"]?)([^)'"]+)\1\)/i);
  if (!m) return '';
  const abs = absolutize(m[2], pageUrl);
  return abs && !isJunkImage(abs) ? abs : '';
}

function resolveProductImage({ cardHtml, productPageHtml, pageUrl, productUrl } = {}) {
  const card = String(cardHtml || '');
  const base = pageUrl || productUrl || '';
  const fromCard = fromPicture(card, base) || fromImgs(card, base) || fromBackground(card, base);
  if (fromCard) return fromCard;
  const pdp = String(productPageHtml || '');
  if (!pdp) return '';
  const pdpBase = productUrl || base;
  return fromJsonLd(pdp, pdpBase) || fromMeta(pdp, pdpBase) || '';
}

function scrubClonedImages(products) {
  const list = Array.isArray(products) ? products : [];
  const counts = new Map();
  for (const p of list) {
    const img = p && p.image;
    if (!img) continue;
    counts.set(img, (counts.get(img) || 0) + 1);
  }
  const n = list.length;
  for (const p of list) {
    if (!p || !p.image) continue;
    const c = counts.get(p.image) || 0;
    if (c >= 3 || (n >= 4 && c / n > 0.5)) p.image = '';
  }
  return list;
}

module.exports = { resolveProductImage, isJunkImage, pickSrcset, absolutize, scrubClonedImages };
