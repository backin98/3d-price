// What the public storefront needs from the admin's desk settings (desk.json): the banners and
// pins from the Storefront tab, and each shop's display name — and nothing else. desk.json also
// holds internal addresses (the AI server, the PC worker), so /api/hunt only ever sends what
// this module picks, field by field.

// The storefront template's grocery banners were seeded into desk.json before the storefront
// read it. They point at images that no longer exist and were never the owner's banners.
const LEGACY_TEMPLATE_IMAGES = new Set([
  "assets/banners/aisle.jpg",
  "assets/banners/warehouse.jpg",
  "assets/banners/electronics.jpg"
]);

function clean(value, max) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

// A banner image is an https URL or a file under public/assets.
function safeImage(src) {
  const s = clean(src, 500);
  return /^https:\/\//i.test(s) || /^\/?assets\/[\w./-]+$/i.test(s) ? s : "";
}

// A banner link is a web address or a path on this site — never javascript: or data:.
function safeHref(href) {
  const s = clean(href, 500);
  return /^https?:\/\//i.test(s) || /^\/(?!\/)/.test(s) ? s : "";
}

function isLegacyBanner(banner) {
  return !!banner && LEGACY_TEMPLATE_IMAGES.has(String(banner.image || "").trim().replace(/^\//, ""));
}

// The banners the owner actually made (legacy template rows dropped).
function ownBanners(desk) {
  return (Array.isArray(desk && desk.banners) ? desk.banners : []).filter((b) => b && typeof b === "object" && !isLegacyBanner(b));
}

function publicBanners(desk) {
  return ownBanners(desk)
    .filter((b) => b.enabled !== false)
    .map((b) => ({
      kicker: clean(b.kicker, 80),
      title: clean(b.title, 140),
      subtitle: clean(b.subtitle, 280),
      href: safeHref(b.href),
      image: safeImage(b.image)
    }))
    .filter((b) => b.title || b.image)
    .slice(0, 8);
}

function publicPins(desk) {
  return (Array.isArray(desk && desk.promoted) ? desk.promoted : [])
    .filter((p) => p && typeof p === "object" && p.enabled !== false && p.productId)
    .map((p) => ({
      productId: clean(p.productId, 200),
      query: clean(p.query, 120),
      slot: p.slot === "paid" ? "paid" : "promoted"
    }))
    .slice(0, 50);
}

function hostOf(url) {
  try {
    return new URL(String(url || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return "";
  }
}

// Offers name their shop by host ("valment.com.tr"); the admin's shop list has the name to show.
// A name typed all lower case ("valment") gets a capital; anything else is kept as typed.
function storeNames(desk) {
  const out = {};
  for (const shop of Array.isArray(desk && desk.shops) ? desk.shops : []) {
    if (!shop || typeof shop !== "object") continue;
    const host = hostOf(shop.url) || clean(shop.id, 120).toLowerCase().replace(/^www\./, "");
    if (!host) continue;
    const name = clean(shop.name, 60) || host;
    out[host] = name === name.toLowerCase() ? name.charAt(0).toUpperCase() + name.slice(1) : name;
  }
  return out;
}

function storefrontMerch(desk) {
  return {
    merch: { banners: publicBanners(desk), pins: publicPins(desk) },
    stores: storeNames(desk)
  };
}

module.exports = {
  storefrontMerch,
  publicBanners,
  publicPins,
  storeNames,
  ownBanners,
  isLegacyBanner,
  safeImage,
  safeHref
};
