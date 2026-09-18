function unionCatalog(live, candidate) {
  const base = live && typeof live === 'object' ? live : { products: [], filaments: [] };
  const products = [...(base.products || [])];
  const filaments = [...(base.filaments || [])];
  if (!candidate) return { ...base, products, filaments };
  const byId = new Map();
  const byUrl = new Map();
  for (const p of [...products, ...filaments]) {
    if (p && p.id) byId.set(p.id, p);
    for (const o of p.offers || []) {
      if (o && o.url) byUrl.set(o.url, p);
    }
  }
  const add = (p) => {
    if (!p || !p.id) return;
    const hit = byId.get(p.id) || (p.offers || []).map((o) => byUrl.get(o.url)).find(Boolean);
    if (hit) {
      hit.offers = hit.offers || [];
      for (const o of p.offers || []) {
        if (!o || !o.url) continue;
        if (!hit.offers.some((e) => e.url === o.url)) hit.offers.push(o);
      }
      return;
    }
    const shelf = p.kind === 'filament' ? filaments : products;
    shelf.push(p);
    byId.set(p.id, p);
    for (const o of p.offers || []) {
      if (o && o.url) byUrl.set(o.url, p);
    }
  };
  for (const p of candidate.products || []) add(p);
  for (const p of candidate.filaments || []) add(p);
  return { ...base, products, filaments, productCount: products.length, filamentCount: filaments.length };
}

function collapseShelf(list, kind) {
  const { decidePair } = require('./product-match.cjs');
  const out = [];
  for (const p of list || []) {
    const copy = { ...p, kind: p.kind || kind, offers: [...(p.offers || [])] };
    let merged = false;
    for (const g of out) {
      const d = decidePair(
        {
          name: copy.name,
          brand: copy.brand,
          kind: copy.kind || kind,
          polymer: copy.polymer,
          variant: copy.variant,
          color: copy.color,
          weight: copy.weight,
          diameter: copy.diameter,
          packaging: copy.packaging
        },
        g
      );
      if (d.action !== 'merge') continue;
      const seen = new Set((g.offers || []).map((o) => o.url));
      for (const o of copy.offers || []) {
        if (o && o.url && !seen.has(o.url)) {
          g.offers.push(o);
          seen.add(o.url);
        }
      }
      g.offers.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
      merged = true;
      break;
    }
    if (!merged) out.push(copy);
  }
  return out;
}

function collapseByMagellan(catalog) {
  const products = collapseShelf((catalog && catalog.products) || [], 'printer');
  const filaments = collapseShelf((catalog && catalog.filaments) || [], 'filament');
  return {
    ...(catalog || {}),
    products,
    filaments,
    productCount: products.length,
    filamentCount: filaments.length
  };
}

const { toTry, FALLBACK_TRY } = require('./compare-products.cjs');

const TRY_CURRENCY = { code: 'TRY', symbol: 'TL', position: 'after', decimals: 2 };

function currencyCode(x) {
  if (!x) return 'TRY';
  if (typeof x === 'string') {
    const c = x.toUpperCase();
    return c === 'TL' ? 'TRY' : c;
  }
  const c = String(x.code || 'TRY').toUpperCase();
  return c === 'TL' ? 'TRY' : c;
}

function pricesToTry(catalog, rates) {
  const fx = rates || FALLBACK_TRY;
  const conv = (n, code) => {
    if (!Number.isFinite(Number(n))) return n;
    if (!code || code === 'TRY') return Number(n);
    return toTry(n, code, fx) || Number(n);
  };
  const fix = (p) => {
    const code = currencyCode(p.currency);
    const offers = (p.offers || []).map((o) => {
      const oc = currencyCode(o.currency || p.currency);
      return {
        ...o,
        price: conv(o.price, oc),
        was: o.was != null ? conv(o.was, oc) : o.was
      };
    });
    const nums = offers.map((o) => o.price).filter((n) => Number.isFinite(n));
    return {
      ...p,
      currency: TRY_CURRENCY,
      offers,
      price: nums.length ? Math.min(...nums) : conv(p.price, code)
    };
  };
  return {
    ...(catalog || {}),
    products: ((catalog && catalog.products) || []).map(fix),
    filaments: ((catalog && catalog.filaments) || []).map(fix)
  };
}

function ensureIncludedVat(catalog) {
  const bump = (o, product) => {
    if (!o || o.vatAdded === true) return o;
    const shop = String(o.store || product.source || product.sourceId || "");
    if (!/metatech/i.test(shop)) return { ...o, vatAdded: o.vatIncluded === true };
    const price = Number(o.price);
    if (!Number.isFinite(price) || price <= 0) return o;
    return {
      ...o,
      price: Math.round(price * 1.2 * 100) / 100,
      was: o.was ? Math.round(Number(o.was) * 1.2 * 100) / 100 : o.was,
      vatIncluded: true,
      vatAdded: true
    };
  };
  const fix = (p) => ({
    ...p,
    offers: (p.offers || []).map((o) => bump(o, p))
  });
  return {
    ...(catalog || {}),
    products: ((catalog && catalog.products) || []).map(fix),
    filaments: ((catalog && catalog.filaments) || []).map(fix)
  };
}

module.exports = { unionCatalog, collapseByMagellan, pricesToTry, ensureIncludedVat };
