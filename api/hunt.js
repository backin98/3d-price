const { resolveImages, loadManufacturerImages } = require("./product-images");
const fs = require("fs");
const path = require("path");
const { classifyFilament } = require("./filament-classify");
const { huntMetatech } = require("./metatech");
const { huntTeknomarket } = require("./teknomarket");
const { huntRobolink } = require("./robolink");
const { mergeSimilar } = require("./match-products");
const { parseMoney } = require("../lib/parse-money.cjs");
const { rankSearch } = require("../lib/search-match.cjs");
const catalogIndex = require("../lib/catalog-index.cjs");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_MS = 10 * 60 * 1000;
let MEMO = null;

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&Ccedil;/g, "Ç")
    .replace(/&ccedil;/g, "ç")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&ouml;/g, "ö")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&uuml;/g, "ü")
    .replace(/&scedil;/gi, "ş")
    .replace(/&gbreve;/gi, "ğ")
    .replace(/&Icirc;/g, "Î")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function parseTL(raw) {
  return parseMoney(raw);
}

function pick(block, re, group) {
  const m = block.match(re);
  return m ? decodeEntities(m[group == null ? 1 : group]).trim() : "";
}

const NAME_BRANDS = [
  "Bambu Lab",
  "RhinoLab",
  "Filamix",
  "Polymaker",
  "Polyture",
  "Fibromast",
  "Creality",
  "Apex3D",
  "Flashforge",
  "Anycubic",
  "Elegoo",
  "ELEGOO",
  "Silver3D",
  "eSUN",
  "Esun",
  "Sunlu",
  "Sava",
  "Beta",
  "QIDI",
  "Qidi"
];

function brandFromName(name) {
  const lower = String(name || "").toLowerCase();
  let hit = "";
  NAME_BRANDS.forEach((b) => {
    if (lower.startsWith(b.toLowerCase()) && b.length > hit.length) hit = b;
  });
  if (/^elegoo$/i.test(hit)) return "Elegoo";
  if (/^esun$/i.test(hit)) return "eSUN";
  if (/^qidi$/i.test(hit)) return "QIDI";
  if (hit) return hit;
  const known = catalogIndex.brandOf(name);
  return known ? known.alias : "";
}

function pickBrand(htmlBrand, name, kind) {
  const fromName = brandFromName(name);
  if (fromName) return fromName;
  if (htmlBrand) return htmlBrand;
  return kind === "filament" ? "Unknown" : "";
}

function parseRhinoCards(html, kind) {
  kind = kind || "printer";
  const chunks = html.split('<div class="card-product">').slice(1);
  const seen = new Set();
  const products = [];

  for (const chunk of chunks) {
    const href = pick(chunk, /<a href="(https:\/\/www\.rhino3dprinter\.com\/[^"]+)" class="c-p-i-link"/);
    const title = pick(chunk, /class="c-p-i-link"[^>]*title="([^"]+)"/);
    if (!href || !title) continue;
    if (/Stokta Yok/i.test(chunk) || !/Sepete Ekle/.test(chunk)) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    if (
      kind === "filament" &&
      /po[sş]et|saklama|shiner|fixer|yap[iı][sş]t[iı]r[iı]c[iı]|3d\s*pen|3d\s*kalem/i.test(title)
    ) {
      continue;
    }

    const brand = pick(chunk, /<div class="brand">\s*([^<]+)/);
    const saleRaw = pick(chunk, /<div class="sale-price\s*">\s*([^<]+)/);
    const listRaw = pick(chunk, /<div class="list-price">\s*([^<]+)/);
    const image =
      pick(chunk, /data-src="(https:\/\/cdn\.qukasoft\.com[^"]+)"/) ||
      pick(chunk, /src="(https:\/\/cdn\.qukasoft\.com[^"]+)"/);
    const id = pick(chunk, /data-product-card-quantity="(\d+)"/);
    let price = parseTL(saleRaw);
    if (price == null) continue;
    let was = parseTL(listRaw);
    if (was && price > was) {
      const t = price;
      price = was;
      was = t;
    }
    const preorder = /[öo]n\s*sipari[sş]|pre-?order/i.test(title);

    products.push({
      id: "rhino-" + (id || href),
      sourceId: "rhino",
      source: "Rhino 3D Printer",
      kind,
      aisle: kind === "filament" ? "filament" : "fdm",
      name: title,
      brand: pickBrand(brand, title, kind),
      unit: pickBrand(brand, title, kind) || (kind === "filament" ? "Filament" : "FDM"),
      image,
      url: href,
      preorder,
      currency: { code: "TRY", symbol: "TL", position: "after", decimals: 2 },
      offers: [
        {
          store: "Rhino 3D Printer",
          price,
          was: was && was > price ? was : undefined,
          km: null,
          url: href,
          preorder: preorder || undefined
        }
      ]
    });
  }
  return products;
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return (parts[parts.length - 1] || "").toLowerCase();
  } catch (e) {
    return "";
  }
}

function readRecategorize() {
  const file = path.join(process.cwd(), "sources", "rhino-recategorize.txt");
  if (!fs.existsSync(file)) return new Map();
  const map = new Map();
  fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .forEach((line) => {
      const [slug, aisle] = line.split("|").map((s) => s.trim());
      if (slug && aisle) map.set(slug.toLowerCase(), aisle);
    });
  return map;
}

function applyRecategorize(products) {
  const map = readRecategorize();
  return products.map((p) => {
    const aisle = map.get(slugFromUrl(p.url));
    if (!aisle) return p;
    return { ...p, aisle, unit: p.brand || p.unit };
  });
}

function readSources() {
  const file = path.join(process.cwd(), "sources", "websites.txt");
  const text = fs.readFileSync(file, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [id, name, category, url] = line.split("|").map((s) => s.trim());
      return { id, name, category, url };
    });
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }
  });
  if (!res.ok) throw new Error("Hunt HTTP " + res.status);
  return res.text();
}

async function fetchPageRetry(url, tries) {
  tries = tries || 3;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fetchPage(url);
    } catch (e) {
      lastErr = e;
    }
  }
  return "";
}

function maxPage(html, categoryPath, cap) {
  let max = 1;
  const escaped = (categoryPath || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    escaped ? new RegExp(escaped + "[?&](?:amp;)?sayfa=(\\d+)", "gi") : null,
    /[?&](?:amp;)?sayfa=(\d+)/gi
  ].filter(Boolean);
  patterns.forEach((re) => {
    let m;
    while ((m = re.exec(html))) max = Math.max(max, Number(m[1]));
  });
  return Math.min(max, cap || 80);
}

function uniqByUrl(list) {
  const out = [];
  const seen = new Set();
  for (const p of list) {
    if (!p.url || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  return out;
}

async function huntSource(source, kind, cap) {
  const capN = cap || 80;
  const join = source.url.indexOf("?") >= 0 ? "&" : "?";
  const first = await fetchPage(source.url);
  let known = maxPage(first, source.category, capN);
  const got = new Set([1]);
  let products = parseRhinoCards(first, kind);

  async function fillMissing() {
    const missing = [];
    for (let p = 2; p <= known && p <= capN; p++) {
      if (!got.has(p)) missing.push(p);
    }
    if (!missing.length) return false;
    const pages = await Promise.all(
      missing.map(async (p) => {
        const html = await fetchPageRetry(source.url + join + "sayfa=" + p);
        return [p, html];
      })
    );
    let grew = false;
    pages.forEach(([p, html]) => {
      got.add(p);
      if (!html) return;
      products = products.concat(parseRhinoCards(html, kind));
      const n = maxPage(html, source.category, capN);
      if (n > known) {
        known = n;
        grew = true;
      }
    });
    return grew;
  }

  while (await fillMissing()) {}
  return uniqByUrl(products);
}

async function loadCatalog(sources) {
  if (MEMO && Date.now() - MEMO.t < CACHE_MS) return MEMO;

  const rhino = sources.find((s) => s.id === "rhino");
  if (!rhino) throw new Error("rhino is missing from sources/websites.txt");

  const filSource = sources.find((s) => s.id === "rhino-fil") || {
    id: "rhino-fil",
    name: "Rhino 3D Printer",
    category: "filament-cesitleri",
    url: "https://www.rhino3dprinter.com/filament-cesitleri"
  };

  const metaPrint = sources.find((s) => s.id === "metatech") || {
    id: "metatech",
    name: "Metatech",
    category: "3d-yazicilar",
    url: "https://store.metatechtr.com/3d-yazicilar"
  };
  const metaFil = sources.find((s) => s.id === "metatech-fil") || {
    id: "metatech-fil",
    name: "Metatech",
    category: "filamentler",
    url: "https://store.metatechtr.com/filamentler"
  };

  const [printersRes, filamentsRes, metaPRes, metaFRes, teknoPRes, teknoFRes, roboPRes, roboFRes] = await Promise.allSettled([
    huntSource(rhino, "printer", 80),
    huntSource(filSource, "filament", 80),
    huntMetatech(metaPrint, "printer"),
    huntMetatech(metaFil, "filament"),
    huntTeknomarket("printer"),
    huntTeknomarket("filament"), huntRobolink("printer"), huntRobolink("filament")
  ]);

  const printersRaw = printersRes.status === "fulfilled" ? printersRes.value : [];
  const filamentsRaw = filamentsRes.status === "fulfilled" ? filamentsRes.value : [];
  const metaPrinters = metaPRes.status === "fulfilled" ? metaPRes.value : [];
  const metaFilaments = metaFRes.status === "fulfilled" ? metaFRes.value : [];
  const teknoPrinters = teknoPRes.status === "fulfilled" ? teknoPRes.value : [];
  const teknoFilaments = teknoFRes.status === "fulfilled" ? teknoFRes.value : [];
  const roboPrinters = roboPRes.status === "fulfilled" ? roboPRes.value : [];
  const roboFilaments = roboFRes.status === "fulfilled" ? roboFRes.value : [];
  if (!roboPrinters.length && !roboFilaments.length && !printersRaw.length && !filamentsRaw.length && !metaPrinters.length && !metaFilaments.length && !teknoPrinters.length && !teknoFilaments.length) {
    const err =
      (printersRes.status === "rejected" && printersRes.reason) ||
      (filamentsRes.status === "rejected" && filamentsRes.reason) ||
      (metaPRes.status === "rejected" && metaPRes.reason) ||
      (metaFRes.status === "rejected" && metaFRes.reason) ||
      new Error("Hunt returned nothing");
    throw err;
  }

  const extras = [];
  const filamentOnly = [];
  filamentsRaw.concat(metaFilaments, teknoFilaments, roboFilaments).forEach((p) => {
    if (/kurutucu|\bdryer\b|space\s*pi/i.test(p.name || "")) {
      extras.push({ ...p, kind: "printer", aisle: "filament-kurutucu", unit: p.brand });
    } else {
      filamentOnly.push(p);
    }
  });

  const products = applyRecategorize(printersRaw.concat(metaPrinters, teknoPrinters, roboPrinters, extras));
  const filaments = filamentOnly.map(classifyFilament);
  const merged = mergeSimilar(products, filaments);
  const imageReferences = await loadManufacturerImages();
  MEMO = {
    t: Date.now(),
    source: { id: "multi", name: "Rhino · Metatech · 3D Teknomarket · Robolink Market" },
    products: resolveImages(merged.products),
    filaments: resolveImages(merged.filaments, imageReferences)
  };
  return MEMO;
}

async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  try {
    const q = String((req.query && req.query.q) || "").trim();
    const sources = readSources();
    const catalog = await loadCatalog(sources);

    let products = catalog.products;
    let filaments = catalog.filaments;

    if (q) {
      products = rankSearch(products, q);
      filaments = rankSearch(filaments, q);
    }

    res.status(200).json({
      source: catalog.source,
      queried: q,
      count: products.length,
      filamentCount: filaments.length,
      products,
      filaments
    });
  } catch (err) {
    res.status(502).json({ error: String(err && err.message ? err.message : err) });
  }
}

handler.maxDuration = 60;
module.exports = handler;
module.exports.parseRhinoCards = parseRhinoCards;
module.exports.applyRecategorize = applyRecategorize;
module.exports.pickBrand = pickBrand;
module.exports.maxDuration = 60;
