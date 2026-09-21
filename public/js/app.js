(function () {
  const BASE = window.SITE_CONTENT;
  if (!BASE) {
    document.body.innerHTML =
      "<p style='padding:2rem;font-family:sans-serif'>Missing <code>content/site-content.js</code>.</p>";
    return;
  }
  let C = BASE;

  const STORAGE_CART = "3dprice-saved";
  const STORAGE_LOC = "3dprice-location";
  const STORAGE_LANG = "3dprice-lang";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function path(obj, key) {
    return key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
  }

  function fill(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, (_, k) =>
      vars[k] == null ? "" : String(vars[k])
    );
  }

  function deepMerge(a, b) {
    if (!b) return a;
    const out = Array.isArray(a) ? a.slice() : Object.assign({}, a);
    Object.keys(b).forEach((k) => {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k])) {
        out[k] = deepMerge(a && a[k] ? a[k] : {}, b[k]);
      } else {
        out[k] = b[k];
      }
    });
    return out;
  }

  function translateProduct(name) {
    if (!name || state.lang !== "en") return name;
    if (C.productExact && C.productExact[name]) return C.productExact[name];
    let out = name;
    (C.productPhrases || []).forEach((pair) => {
      const from = pair[0];
      const to = pair[1];
      if (from && out.indexOf(from) !== -1) out = out.split(from).join(to);
    });
    return out.replace(/\s{2,}/g, " ").trim();
  }

  function displayName(p) {
    const name = translateProduct(p.name);
    return p.polymer === "plabs" ? String(name || "").replace(/\bpla[\s-]*abs\b|\bplabs\b/gi, "PLABS") : name;
  }

  function applyI18n(root) {
    $$("[data-i18n]", root).forEach((el) => {
      const v = path(C, el.getAttribute("data-i18n"));
      if (v != null) el.textContent = v;
    });
    $$("[data-i18n-aria]", root).forEach((el) => {
      const v = path(C, el.getAttribute("data-i18n-aria"));
      if (v != null) el.setAttribute("aria-label", v);
    });
    $$("[data-i18n-title]", root).forEach((el) => {
      const v = path(C, el.getAttribute("data-i18n-title"));
      if (v != null) el.setAttribute("title", v);
    });
  }

  function money(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    return (
      new Intl.NumberFormat("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(num) + " TL"
    );
  }

  function km(n) {
    return fill(C.units.km, { n });
  }

  function vatTag() {
    return `<span class="vat-tag">${escapeHtml(state.lang === "tr" ? "KDV dahil" : "KDV dahil")}</span>`;
  }

  function shortStore(name) {
    const s = String(name || "");
    if (/rhino/i.test(s)) return "Rhino";
    if (/metatech/i.test(s)) return "Metatech";
    return s;
  }

  function offPct(price, was) {
    if (!was || was <= price) return 0;
    return Math.round(((was - price) / was) * 100);
  }

  // Vendors out of stock do not get to be "the best price": a dead offer is not an offer.
  const offerStatus = (offer) => String((offer && (offer.stockStatus || offer.stock)) || "unknown");

  function liveOffers(product) {
    const offers = (product && product.offers) || [];
    // An offer carrying no stock information stays in: unknown is not out of stock.
    return offers.filter((o) => offerStatus(o) !== "out_of_stock");
  }

  function bestOffer(product) {
    const offers = liveOffers(product).slice();
    if (!offers.length) return { store: "", price: 0 };
    // A price we could not believe is not a price anyone can buy at: it never sets the headline.
    const believable = offers.filter((o) => !o.priceSuspect);
    const pool = believable.length ? believable : offers;
    // Verified stock beats a cheaper unknown/preorder offer. Unknown stays as a fallback because
    // many shops do not expose reliable stock markup at all.
    const verified = pool.filter((o) => offerStatus(o) === "in_stock");
    const available = verified.length ? verified : pool;
    const notPreorder = available.filter((o) => !o.preorder && offerStatus(o) !== "preorder");
    const finalPool = notPreorder.length ? notPreorder : available;
    return finalPool.sort((a, b) => a.price - b.price)[0];
  }

  function hasPreorder(p) {
    return !!(p && (p.preorder || (p.offers || []).some((o) => o.preorder || offerStatus(o) === "preorder")));
  }

  function liveAisles() {
    return (C.live && C.live.aisles) || [{ id: "fdm", name: (C.live && C.live.aisle) || "FDM" }];
  }

  function aisleName(id) {
    const live = liveAisles().find((x) => x.id === id);
    if (live) return live.name;
    const a = (C.aisles || []).find((x) => x.id === id);
    return a ? a.name : id;
  }

  function locationName(id) {
    const loc = (C.locations || []).find((x) => x.id === id);
    return loc ? loc.name : id;
  }

  function uid() {
    return "t" + Math.random().toString(36).slice(2, 8);
  }

  const state = {
    tabs: [{ id: "home", n: 1, query: "", scroll: 0 }],
    activeTab: "home",
    query: "",
    locationId: C.locations[0] ? C.locations[0].id : "near",
    banner: 0,
    activeAisle: C.aisles[0] ? C.aisles[0].id : null,
    saved: [],
    open: null,
    sheetProduct: null,
    liveProducts: null,
    liveFilaments: null,
    liveStatus: "idle",
    liveFetchedAt: 0,
    suggestIndex: -1,
    suggestClosed: false,
    world: "printers",
    filPath: { polymer: null, variant: null, brand: null },
    lang: "en"
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_CART) || "[]");
    if (Array.isArray(saved)) state.saved = saved;
  } catch (e) {
    /* ignore */
  }
  const storedLoc = localStorage.getItem(STORAGE_LOC);
  if (storedLoc && (C.locations || []).some((l) => l.id === storedLoc)) {
    state.locationId = storedLoc;
  }
  const storedLang = localStorage.getItem(STORAGE_LANG);
  if (storedLang && (BASE.languages || []).some((l) => l.id === storedLang)) {
    state.lang = storedLang;
  }

  function persist() {
    localStorage.setItem(STORAGE_CART, JSON.stringify(state.saved));
    localStorage.setItem(STORAGE_LOC, state.locationId);
  }

  function activeTab() {
    return state.tabs.find((t) => t.id === state.activeTab) || state.tabs[0];
  }

  function currentScroll() {
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function saveTabScroll(id) {
    const tab = state.tabs.find((t) => t.id === (id || state.activeTab));
    if (tab) tab.scroll = currentScroll();
  }

  function restoreTabScroll(id) {
    const tab = state.tabs.find((t) => t.id === (id || state.activeTab));
    const y = tab && tab.scroll != null ? tab.scroll : currentScroll();
    requestAnimationFrame(() => window.scrollTo(0, y));
  }

  function setQuery(q, fromInput) {
    const keep = currentScroll();
    const changed = state.query !== q;
    state.query = q;
    if (changed) {
      state.activeAisle = null;
      state.filPath = { polymer: null, variant: null, brand: null };
    }
    const tab = activeTab();
    if (tab) {
      tab.query = q;
      if (tab.scroll == null) tab.scroll = keep;
    }
    if (!fromInput) {
      $("#header-query").value = q;
      $("#hunter-query").value = q;
    } else {
      const src = fromInput;
      if (src !== "header") $("#header-query").value = q;
      if (src !== "hunter") $("#hunter-query").value = q;
    }
    $("#hunter-clear").hidden = !q;
    if (changed) selectSearchWorld();
    // The catalog is loaded once; without this, a row added or renamed in the admin stays
    // invisible in an open tab — typing searches a list that no longer matches the site.
    if (changed && catalogIsStale()) {
      renderTabs();
      renderAisles();
      scheduleStockPreview();
      huntRhino(q, fromInput, true);
      return;
    }
    renderTabs();
    renderAisles();
    if (changed) scheduleStockPreview();
    requestAnimationFrame(() => window.scrollTo(0, keep));
  }

  // How long a loaded catalog is trusted before a search refreshes it in the background.
  const CATALOG_TTL_MS = 30000;
  function catalogIsStale() {
    if (!state.liveProducts && !state.liveFilaments) return false;
    if (state.liveStatus === "loading" || state.liveStatus === "refreshing") return false;
    return Date.now() - (state.liveFetchedAt || 0) > CATALOG_TTL_MS;
  }

  function catalog() {
    return state.liveProducts || C.products || [];
  }

  let indexedCatalog = null;
  let indexedBrands = new Set();
  let indexedSearch = new WeakMap();
  let rankedCatalog = null;
  let rankedQuery = "";
  let rankedIncludeDead = false;
  let rankedProducts = null;

  function ensureSearchIndex() {
    const list = catalog();
    if (list !== indexedCatalog) {
      indexedCatalog = list;
      indexedBrands = new Set(list.map((p) => foldText(p && p.brand)).filter(Boolean));
      indexedSearch = new WeakMap();
      rankedCatalog = null;
      rankedProducts = null;
    }
    return list;
  }

  function clearRankCache() {
    rankedCatalog = null;
    rankedProducts = null;
  }

  // Mirrors lib/search-match.cjs. A family query ("Creality K2 Plus Combo 3D Yazıcı") has to
  // find a row named "creality k2 plus combo", so match on tokens and look at the offers too.
  const SEARCH_STOP = new Set([
    "3d", "yazici", "printer", "fiyat", "fiyati", "inceleme", "yorum", "stok", "stoktan", "stokta",
    "ve", "ile", "the", "and", "with", "for", "adet", "urun", "urunu", "model", "makine", "makinesi",
    "kutu", "hediyeli", "indirimli", "kampanya", "yeni", "new", "sifir", "orijinal", "tl", "try"
  ]);

  function foldText(value) {
    return String(value == null ? "" : value)
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/ı/g, "i")
      .replace(/\s+/g, " ")
      .trim();
  }

  function searchTokens(query) {
    return foldText(query).split(/[^\p{L}\p{N}]+/u).filter((t) => t && !SEARCH_STOP.has(t));
  }

  function searchHaystack(p) {
    ensureSearchIndex();
    const cached = indexedSearch.get(p);
    if (cached) return cached.hay;
    const offers = p && p.offers ? p.offers : [];
    const isBrandOnly = (title) => {
      const value = foldText(title);
      return value && (value === foldText(p && p.brand) || indexedBrands.has(value));
    };
    const hay = foldText([
      p && p.name,
      ...offers.flatMap((o) => [o.store, isBrandOnly(o.sourceTitle) ? "" : o.sourceTitle])
    ].filter(Boolean).join(" "));
    indexedSearch.set(p, {
      hay,
      hayWords: wordsOf(hay),
      nameWords: wordsOf(p && p.name),
      foldedName: foldText(p && p.name)
    });
    return hay;
  }

  function searchRelevance(p) {
    return searchScoreLocal(p, state.query).score;
  }

  // Mirrors lib/search-match.cjs exactly (browsers cannot require it): fold, drop filler words,
  // match against the row AND its offers, allow prefixes and one-letter typos, then rank.
  // Recall matters: a query with an extra word must not hide the family it belongs to.
  function wordsOf(text) {
    return foldText(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  }

  function nearToken(a, b) {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (a[i] === b[j + 1] && a[i + 1] === b[j]) { edits++; i += 2; j += 2; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  }

  const tokenHits = (token, list) => list.some((w, i) => w === token || w.startsWith(token) || nearToken(w, token) || (list[i + 1] && w + list[i + 1] === token));

  // The model number anchors the search, variant words only refine it (mirrors
  // lib/search-match.cjs): a row missing the model is not this family, while a row missing only
  // a variant word still is — that is what keeps "k2 pro" from filling up with unrelated
  // "Pro" products and from dropping the K2 Plus.
  const isAnchorToken = (t) => /[0-9]/.test(t);

  function searchScoreLocal(p, query, preparedTokens) {
    const wanted = preparedTokens || searchTokens(query);
    if (!wanted.length) return { score: query && query.trim() ? 1 : 0, matched: 0, total: 0, inName: 0 };
    const anchors = wanted.filter(isAnchorToken);
    searchHaystack(p);
    const prepared = indexedSearch.get(p);
    const nameWords = prepared.nameWords;
    const hayWords = prepared.hayWords;
    const inName = wanted.filter((t) => tokenHits(t, nameWords)).length;
    const anywhere = wanted.filter((t) => tokenHits(t, hayWords)).length;
    const anchorsHere = anchors.filter((t) => tokenHits(t, hayWords)).length;
    if (anchors.length && anchorsHere < anchors.length) return { score: 0, matched: anywhere, total: wanted.length, inName };
    const foldedName = prepared.foldedName;
    const foldedQuery = foldText(query).trim();
    if (foldedName === foldedQuery || nameWords.join(" ") === wanted.join(" ")) return { score: 100, matched: wanted.length, total: wanted.length, inName };
    if (inName === wanted.length) {
      const first = nameWords.indexOf(wanted.find(isAnchorToken) || wanted[0]);
      const boost = first === 0 ? 8 : first > 0 && first <= 2 ? 4 : 0;
      return { score: 80 + boost, matched: inName, total: wanted.length, inName };
    }
    if (anywhere === wanted.length) return { score: 60, matched: anywhere, total: wanted.length, inName };
    if (anchors.length && anchorsHere === anchors.length) return { score: 45, matched: anywhere, total: wanted.length, inName };
    if (anywhere >= Math.max(1, Math.ceil(wanted.length / 2))) return { score: 30 + anywhere, matched: anywhere, total: wanted.length, inName };
    return { score: 0, matched: anywhere, total: wanted.length, inName };
  }

  // What the storefront shows: everything that scored, best first. Related rows come last.
  function rankProducts(list, query, includeDead = false) {
    if (!query || !query.trim()) return list || [];
    if (list === rankedCatalog && query === rankedQuery && includeDead === rankedIncludeDead && rankedProducts) return rankedProducts;
    const wanted = searchTokens(query);
    const ranked = (includeDead ? (list || []) : (list || []).filter(isSellable))
      .map((p) => ({ p, s: searchScoreLocal(p, query, wanted) }))
      .filter(({ s }) => s.score > 0)
      .sort((a, b) => b.s.score - a.s.score || String(a.p.name || "").localeCompare(String(b.p.name || "")))
      .map(({ p }) => p);
    rankedCatalog = list;
    rankedQuery = query;
    rankedIncludeDead = includeDead;
    rankedProducts = ranked;
    return ranked;
  }

  // ---------- the search bar ----------
  // Suggestions as you type: the same ranking the results grid uses, so what you see in the
  // list is what you get when you press Enter. Keyboard: up/down to move, Enter to open the
  // highlighted product, Escape to close (again to clear).
  const SUGGEST_LIMIT = 6;
  let suggestTimer = null;
  let stockPreviewTimer = null;
  let stockPreviewRequest = null;
  let stockPreviewKey = "";

  function scheduleStockPreview() {
    clearTimeout(stockPreviewTimer);
    if (!state.query.trim() || !state.liveProducts) return;
    stockPreviewTimer = setTimeout(async () => {
      const query = state.query;
      const products = rankProducts(catalog(), query, true).slice(0, 4);
      const ids = products.map((p) => p.id).filter(Boolean);
      const key = query + "\n" + ids.join(",");
      if (!ids.length || key === stockPreviewKey) return;
      if (stockPreviewRequest) stockPreviewRequest.abort();
      stockPreviewRequest = new AbortController();
      try {
        const res = await fetch("/api/stock-preview?ids=" + encodeURIComponent(ids.join(",")), {
          cache: "no-store",
          signal: stockPreviewRequest.signal
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "stock preview failed");
        const byId = new Map(products.map((p) => [String(p.id), p]));
        for (const row of data.products || []) {
          if (!row.verified) continue;
          const product = byId.get(String(row.id));
          const offer = product && (product.offers || []).find((o) => o.url === row.url);
          if (offer) {
            offer.stockStatus = row.status;
            offer.stockVerified = true;
            offer.stockCheckedAt = new Date().toISOString();
          }
        }
        stockPreviewKey = key;
        clearRankCache();
        if (state.query === query) {
          renderSuggest();
          renderAisles();
        }
      } catch (err) {
        if (err.name !== "AbortError") stockPreviewKey = "";
      }
    }, 400);
  }

  function bestPriceLabel(p) {
    const o = bestOffer(p);
    if (!o || !Number.isFinite(Number(o.price))) return "";
    const shops = liveOffers(p).length;
    return money(o.price) + (shops > 1 ? " · " + fill(C.live.compared, { n: shops }) : "");
  }

  function suggestRows() {
    return matchingProducts().slice(0, SUGGEST_LIMIT);
  }

  function renderSuggest() {
    const box = $("#header-suggest");
    if (!box) return;
    const q = state.query.trim();
    if (!q || state.suggestClosed) {
      box.hidden = true;
      box.innerHTML = "";
      $("#header-query").setAttribute("aria-expanded", "false");
      return;
    }
    const rows = suggestRows();
    const total = matchingProducts().length;
    if (!rows.length) {
      box.innerHTML = `<div class="suggest-empty">${escapeHtml(
        state.lang === "tr" ? "Sonuç yok" : "No matches"
      )}</div>`;
      box.hidden = false;
      $("#header-query").setAttribute("aria-expanded", "true");
      return;
    }
    box.innerHTML =
      rows
        .map((p, i) => {
          const related = searchScoreLocal(p, q).score < 60;
          const img = productImages(p)[0];
          return `<button class="suggest-row${i === state.suggestIndex ? " is-active" : ""}" type="button" role="option"
            aria-selected="${i === state.suggestIndex ? "true" : "false"}" id="suggest-${i}" data-open-sheet="${escapeHtml(p.id)}" data-suggest-index="${i}">
            <span class="suggest-thumb">${img ? `<img src="${escapeHtml(img.url)}" alt="" loading="lazy" onerror="window.__imgFail&&window.__imgFail(this)">` : ""}</span>
            <span class="suggest-text"><strong>${escapeHtml(displayName(p))}</strong>
              <em>${escapeHtml(bestPriceLabel(p))}</em></span>
            ${related ? `<span class="suggest-related">${escapeHtml(state.lang === "tr" ? "ilgili" : "related")}</span>` : ""}
          </button>`;
        })
        .join("") +
      `<button class="suggest-all" type="button" id="suggest-all">${escapeHtml(
        fill(C.live.results, { n: total })
      )}</button>`;
    box.hidden = false;
    $("#header-query").setAttribute("aria-expanded", "true");
    const active = box.querySelector(".is-active");
    if (active) $("#header-query").setAttribute("aria-activedescendant", active.id);
    else $("#header-query").removeAttribute("aria-activedescendant");
  }

  function hideSuggest() {
    state.suggestClosed = true;
    state.suggestIndex = -1;
    renderSuggest();
  }

  function onSuggestKey(e) {
    const box = $("#header-suggest");
    const open = box && !box.hidden && box.querySelector(".suggest-row");
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        hideSuggest();
      } else if (state.query) {
        e.preventDefault();
        setQuery("");
      }
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    if (!open) {
      state.suggestClosed = false;
      renderSuggest();
      return;
    }
    e.preventDefault();
    const count = box.querySelectorAll(".suggest-row").length;
    state.suggestIndex = e.key === "ArrowDown"
      ? (state.suggestIndex + 1) % count
      : (state.suggestIndex - 1 + count) % count;
    renderSuggest();
  }

  // Escape on the input must not also close the drawer; the drawer has its own handler.
  function onSuggestEnter(e) {
    const box = $("#header-suggest");
    if (!box || box.hidden || state.suggestIndex < 0) return;
    const row = box.querySelector(`[data-suggest-index="${state.suggestIndex}"]`);
    if (!row) return;
    e.preventDefault();
    hideSuggest();
    state.sheetProduct = row.getAttribute("data-open-sheet");
    openDrawer("sheet");
  }

  function selectSearchWorld() {
    if (!state.liveProducts) return;
    const printers = matchingProducts();
    const filaments = matchingFilaments();
    const score = (items) => items.length ? Math.max(...items.map(searchRelevance)) : -1;
    const printerScore = score(printers);
    const filamentScore = score(filaments);
    state.world = filamentScore > printerScore ||
      (filamentScore === printerScore && filaments.length > printers.length)
      ? "filament" : "printers";
  }

  function findProduct(id) {
    return (
      catalog().find((p) => p.id === id) ||
      (state.liveFilaments || []).find((p) => p.id === id) ||
      (C.products || []).find((p) => p.id === id)
    );
  }

  function matchingProducts() {
    if (!state.query.trim()) return catalog();
    // Ranked with recall: exact matches first, related variants still listed below them.
    return rankProducts(catalog(), state.query);
  }

  function filLabel(kind, id) {
    const map = (C.filament && C.filament[kind]) || {};
    return map[id] || String(id || "").toUpperCase();
  }

  function matchingFilaments() {
    const list = state.liveFilaments || [];
    const q = state.query.trim().toLowerCase();
    const asksPlabs = /\bplabs\b/i.test(q);
    const toks = searchTokens(q);
    return list.filter((p) => {
      // PLABS is a distinct polymer, never a partial PLA/ABS or general match.
      if (p.polymer === "plabs" && !asksPlabs) return false;
      if (asksPlabs && p.polymer !== "plabs") return false;
      if (!q) return true;
      const hay = foldText(filBlob(p) + " " + (p.offers || []).map((o) => o.sourceTitle).join(" "));
      // Filler-only queries ("filament") match the category; otherwise every token must land.
      return !toks.length || toks.every((t) => hay.includes(t));
    });
  }

  function filBlob(p) {
    return [
      p.name,
      displayName(p),
      p.brand,
      p.polymer,
      p.variant,
      p.color,
      filLabel("polymers", p.polymer),
      filLabel("variants", p.variant),
      p.preorder ? "preorder on siparis" : "",
      ...(p.offers || []).map((o) => o.store)
    ]
      .join(" ")
      .toLowerCase();
  }

  function filCut(list) {
    const path = state.filPath || {};
    return (list || []).filter((p) => {
      if (path.polymer && p.polymer !== path.polymer) return false;
      if (path.variant && p.variant !== path.variant) return false;
      if (path.brand && p.brand !== path.brand) return false;
      if (path.family && filamentFamilyKey(p) !== path.family) return false;
      return true;
    });
  }

  function filScore(p, q) {
    if (!q) return 0;
    const color = String(p.color || "").toLowerCase();
    const name = displayName(p).toLowerCase();
    const raw = String(p.name || "").toLowerCase();
    const brand = String(p.brand || "").toLowerCase();
    const poly = String(filLabel("polymers", p.polymer) || "").toLowerCase();
    const vari = String(filLabel("variants", p.variant) || "").toLowerCase();
    const polyId = String(p.polymer || "").toLowerCase();
    const varId = String(p.variant || "").toLowerCase();
    let s = 0;
    if (color === q) s += 120;
    else if (color.startsWith(q)) s += 90;
    else if (color.includes(q)) s += 70;
    if (varId === q || vari === q) s += 60;
    else if (vari.includes(q) || varId.includes(q)) s += 45;
    if (polyId === q || poly === q) s += 50;
    else if (poly.includes(q) || polyId.includes(q)) s += 25;
    if (brand === q) s += 40;
    else if (brand.includes(q)) s += 22;
    if (name === q || raw === q) s += 35;
    else if (name.startsWith(q) || raw.toLowerCase().includes(" - " + q)) s += 18;
    else if (name.includes(q) || raw.includes(q)) s += 8;
    return s;
  }

  /* General-search order is a stand-in. Later this shelf is premium ads / paid slots. */
  function rankFilaments(list) {
    const q = state.query.trim().toLowerCase();
    return list.slice().sort((a, b) => {
      const d = filScore(b, q) - filScore(a, q);
      if (d) return d;
      const pd = minPrice(a) - minPrice(b);
      if (pd) return pd;
      return displayName(a).localeCompare(displayName(b));
    });
  }

  const VARIANT_ORDER = [
    "standard",
    "basic",
    "plus",
    "plus-hs",
    "rapid",
    "silk",
    "rainbow",
    "pure",
    "matte",
    "tough",
    "cf",
    "gf",
    "wood",
    "marble",
    "glow",
    "semiflex",
    "combo"
  ];

  function minPrice(p) {
    const o = bestOffer(p);
    return o ? o.price : Infinity;
  }

  function groupBy(list, key) {
    const map = new Map();
    list.forEach((p) => {
      const k = p[key] || "other";
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    });
    return map;
  }

  function priceStats(list) {
    const prices = list.map(minPrice).filter((n) => Number.isFinite(n));
    if (!prices.length) return { min: 0, max: 0 };
    return { min: Math.min.apply(null, prices), max: Math.max.apply(null, prices) };
  }

  const POLY_COLOR = {
    pla: "#7cb342",
    plabs: "#9ccc65",
    petg: "#26a69a",
    pet: "#00897b",
    abs: "#fb8c00",
    asa: "#f9a825",
    tpu: "#8e24aa",
    pc: "#42a5f5",
    pa: "#607d8b",
    ppa: "#455a64",
    pps: "#5d4037",
    pekk: "#6d4c41",
    peek: "#c0a062",
    pek: "#a1887f",
    pva: "#81d4fa",
    hips: "#90a4ae",
    pp: "#78909c",
    other: "#8a96a3"
  };

  const COLOR_RULES = [
    [/desert\s*tan/i, "#c2a36b"],
    [/ice\s*blue/i, "#9fd6ea"],
    [/sky\s*blue|g[oö]k\s*mavi/i, "#5eb0e5"],
    [/dark\s*green/i, "#1f6b3a"],
    [/dark\s*red/i, "#8b1e2d"],
    [/scarlet/i, "#e23b3b"],
    [/lilac/i, "#c29ad6"],
    [/lemon\s*yellow/i, "#f2d84a"],
    [/ivory/i, "#f3ead4"],
    [/pearl/i, "#efe6d6"],
    [/indigo/i, "#3f3d9b"],
    [/bambu\s*green/i, "#2f9e4f"],
    [/teal/i, "#1c9b8e"],
    [/orange\s*red/i, "#e2572d"],
    [/dark\s*grey|dark\s*gray|koyu\s*gri/i, "#4a4f55"],
    [/forest/i, "#2e6b3a"],
    [/coral/i, "#e0736a"],
    [/sakura/i, "#e7a0b8"],
    [/latte/i, "#cbb79a"],
    [/oak|teak/i, "#8b5a2b"],
    [/copper/i, "#b87333"],
    [/bronze/i, "#8c6239"],
    [/gold|alt[iı]n/i, "#d4a017"],
    [/silver|g[uü]m[uü][sş]/i, "#c0c5cc"],
    [/grey|gray|gri/i, "#8b939c"],
    [/beige/i, "#d8c7a6"],
    [/brown|kahve/i, "#6b4423"],
    [/violet|mor|purple/i, "#7a3ea8"],
    [/pink|pembe/i, "#e37aa8"],
    [/red|k[iı]rm[iı]z[iı]/i, "#d32f2f"],
    [/blue|mavi/i, "#1e6fbf"],
    [/green|ye[sş]il/i, "#3d8b40"],
    [/yellow|sar[iı]/i, "#e6c229"],
    [/orange|turuncu/i, "#ef7a1a"],
    [/white|beyaz/i, "#f4f1ea"],
    [/black|siyah/i, "#1c1c1c"],
    [/natural|naturel|natural/i, "#e8d9b8"],
    [/clear|transparent|transparan|[sş]effaf/i, "#d7eef2"]
  ];

  function guessSwatch(name, variant) {
    const text = name || "";
    const hole = "radial-gradient(circle at 50% 50%, #141b24 0 17%, transparent 18%)";
    if (variant === "rainbow" || /rainbow|mystic|gradient|dual/i.test(text)) {
      return (
        "background:" +
        hole +
        ",conic-gradient(#e11d38,#ef7a1a,#e6c229,#3d8b40,#1e6fbf,#7a3ea8,#e11d38)"
      );
    }
    const hits = [];
    COLOR_RULES.forEach((pair) => {
      if (pair[0].test(text) && hits.indexOf(pair[1]) === -1) hits.push(pair[1]);
    });
    if (hits.length >= 2) {
      return "background:" + hole + ",linear-gradient(135deg," + hits.join(",") + ")";
    }
    if (hits.length === 1) return "--c:" + hits[0];
    return "";
  }

  function spoolStyle(product, polymer) {
    const guessed = guessSwatch(product && product.color, product && product.variant);
    if (guessed.indexOf("background:") === 0) return guessed;
    const hex = guessed.replace("--c:", "") || POLY_COLOR[polymer] || "#8a96a3";
    return "--c:" + hex;
  }

  function uniqueColors(list) {
    const seen = [];
    list.forEach((p) => {
      const s = spoolStyle(p, p.polymer);
      if (seen.indexOf(s) === -1) seen.push(s);
    });
    return seen.slice(0, 5);
  }

  async function huntRhino(q, fromInput, background) {
    if (!background) {
      state.activeAisle = null;
      state.filPath = { polymer: null, variant: null, brand: null };
      setQuery(q, fromInput);
      state.liveStatus = "loading";
      renderAisles();
    } else {
      state.liveStatus = "refreshing";
    }
    try {
      const res = await fetch("/api/hunt", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "hunt failed");
      state.liveProducts = data.products || [];
      state.liveFilaments = data.filaments || [];
      state.liveFetchedAt = Date.now();
      state.liveStatus = "ready";
      state.activeAisle = null;
      state.filPath = { polymer: null, variant: null, brand: null };
      selectSearchWorld();
      stockPreviewKey = "";
      scheduleStockPreview();
    } catch (err) {
      state.liveStatus = background ? "ready" : "error";
    }
    renderAisles();
    renderLocationLine();
  }

  function nextHuntN() {
    return state.tabs.reduce((max, t) => Math.max(max, t.n || 0), 0) + 1;
  }

  function tabLabel(tab) {
    const q = (tab.query || "").trim();
    if (q) return translateProduct(q);
    return fill(C.header.defaultTab, { n: tab.n || 1 });
  }

  function renderTabs() {
    const root = $("#tabs");
    root.innerHTML = state.tabs
      .map((tab) => {
        const active = tab.id === state.activeTab ? " is-active" : "";
        const close =
          state.tabs.length > 1
            ? `<button class="tab-close" type="button" data-close-tab="${tab.id}" aria-label="${C.header.closeTabAria}">×</button>`
            : "";
        return `<div class="tab${active}" role="tab" aria-selected="${
          tab.id === state.activeTab
        }" data-tab="${tab.id}"><span class="tab-title">${escapeHtml(
          tabLabel(tab)
        )}</span>${close}</div>`;
      })
      .join("");
    layoutTabs();
  }

  function layoutTabs() {
    const strip = document.querySelector(".tab-strip");
    const tabsEl = $("#tabs");
    const plus = $("#new-tab");
    if (!strip || !tabsEl || !plus) return;
    const nodes = $$(".tab", tabsEl);
    if (!nodes.length) return;
    const plusW = plus.getBoundingClientRect().width;
    const stripGap = parseFloat(getComputedStyle(strip).gap) || 0;
    const available = Math.max(0, strip.clientWidth - plusW - stripGap);
    const n = nodes.length;
    const maxW = 200;
    const minW = 56;
    let w = available / n;
    if (w > maxW) w = maxW;
    if (w < minW) w = minW;
    nodes.forEach((el) => {
      el.style.flex = "0 0 " + w + "px";
      el.style.width = w + "px";
    });
  }

  function renderBanner() {
    const slides = $("#banner-slides");
    const dots = $("#banner-dots");
    const hunterDots = $("#hunter-dots");
    slides.innerHTML = (C.banners || [])
      .map((b, i) => {
        const on = i === state.banner ? " is-active" : "";
        return `<article class="banner-slide${on}">
          <img src="${b.image}" alt="">
          <div class="banner-copy">
            <span class="banner-kicker">${escapeHtml(b.kicker)}</span>
            <h2>${escapeHtml(b.title)}</h2>
            <p>${escapeHtml(b.subtitle)}</p>
          </div>
        </article>`;
      })
      .join("");

    const dotsHtml = (C.banners || [])
      .map((b, i) => {
        const on = i === state.banner ? " is-active" : "";
        return `<button class="dot${on}" type="button" data-banner="${i}" aria-label="${escapeHtml(
          b.kicker
        )}"></button>`;
      })
      .join("");
    dots.innerHTML = dotsHtml;
    hunterDots.innerHTML = dotsHtml;
    hunterDots.setAttribute("aria-label", C.hunter.dotsAria);
  }

  function renderLocationLine() {
    const el = $("#hunter-loc");
    if (state.liveProducts || state.liveFilaments) {
      const p = (state.liveProducts || []).length;
      const f = (state.liveFilaments || []).length;
      el.textContent =
        f > 0
          ? fill(C.live.resultsBoth, { p: p, f: f })
          : fill(C.live.results, { n: p });
    } else {
      el.textContent = C.live && C.live.hint
        ? C.live.hint
        : fill(C.hunter.locationHint, { location: locationName(state.locationId) });
    }
  }

  function renderAds() {
    const slot = (tall) =>
      `<div class="ad-slot"${tall ? ' style="min-height:37.5rem"' : ""}><span>${escapeHtml(
        C.ads.label
      )}</span><small>${escapeHtml(C.ads.hint)}</small></div>`;
    $$("[data-ad]").forEach((el) => {
      const side = el.classList.contains("ad-rail");
      el.innerHTML = slot(side);
    });
  }

  function worldSwitchHtml(printers, filaments) {
    if (!state.liveProducts && !state.liveFilaments) return "";
    const filOn = state.world === "filament" ? " is-on" : "";
    const printOn = state.world !== "filament" ? " is-on" : "";
    return `<div class="world-switch" role="tablist">
      <button class="world-btn${filOn}" type="button" data-world="filament">${escapeHtml(
      C.live.filamentWorld
    )} <em>${filaments.length}</em></button>
      <button class="world-btn${printOn}" type="button" data-world="printers">${escapeHtml(
      C.live.printersWorld
    )} <em>${printers.length}</em></button>
    </div>`;
  }

  function filCrumbHtml() {
    const F = C.filament;
    const path = state.filPath;
    const bits = [
      `<button type="button" class="fil-crumb-link" data-fil-level="root">${escapeHtml(
        F.crumb
      )}</button>`
    ];
    if (path.polymer) {
      bits.push(
        `<button type="button" class="fil-crumb-link" data-fil-level="polymer">${escapeHtml(
          filLabel("polymers", path.polymer)
        )}</button>`
      );
    }
    if (path.variant) {
      bits.push(
        `<button type="button" class="fil-crumb-link" data-fil-level="variant">${escapeHtml(
          filLabel("variants", path.variant)
        )}</button>`
      );
    }
    if (path.brand) {
      bits.push(`<button type="button" class="fil-crumb-link" data-fil-level="brand">${escapeHtml(path.brand)}</button>`);
    }
    if (path.family) {
      const selected = (state.liveFilaments || []).find((p) => filamentFamilyKey(p) === path.family);
      if (selected) bits.push(`<span class="fil-crumb-now">${escapeHtml(filamentFamilyLabel(selected))}</span>`);
    }
    const back =
      path.polymer
        ? `<button type="button" class="fil-back" data-fil-back>${escapeHtml(F.back)}</button>`
        : "";
    return `<div class="fil-crumb">${back}<div class="fil-crumb-path">${bits.join(
      "<span aria-hidden='true'>›</span>"
    )}</div></div>`;
  }

  // A vendor's thumbnail 404s constantly (CDNs, hotlink defence). The same product sits on
  // the other compared sites, so walk their images instead of showing a hole.
  function imgAttrs(product) {
    const list = productImages(product).map((i) => i.url);
    if (!list.length) return "";
    return `data-imgs="${escapeHtml(JSON.stringify(list))}" data-i="0" onerror="window.__imgFail&&window.__imgFail(this)"`;
  }

  function imgFail(el) {
    let list = [];
    try { list = JSON.parse(el.getAttribute("data-imgs") || "[]"); } catch (_) { list = []; }
    const current = String(el.getAttribute("src") || "");
    // Try the jpg twin of this URL first: some CDNs only refuse webp to outsiders.
    const twin = current.replace(/\.webp(\?|#|$)/i, ".jpg$1");
    if (twin !== current && !el.dataset.twin) { el.dataset.twin = "1"; el.setAttribute("src", twin); return; }
    for (let i = Number(el.dataset.i || 0) + 1; i < list.length; i++) {
      if (!list[i] || list[i] === current) continue;
      el.dataset.i = String(i);
      delete el.dataset.twin;
      el.setAttribute("src", list[i]);
      return;
    }
    el.replaceWith(Object.assign(document.createElement("span"), { className: "gallery-empty", textContent: "—" }));
  }

  function productImages(product) {
    if (!product) return [];
    const offers = product.offers || [];
    const primary = offers.find((offer) => offer.image === product.image);
    const candidates = [
      { url: product.image, store: primary ? primary.store : product.source || "" },
      ...offers.map((offer) => ({ url: offer.image, store: offer.store }))
    ];
    candidates.push(...(product.fallbackImages || []));
    const seen = new Set();
    return candidates.filter((item) => {
      // This CDN returns a hotlink-denied graphic on external websites.
      if (!item.url) return false;
      if (!item.url || !/^(https?:\/\/|assets\/)/i.test(item.url) || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    });
  }

  function productGallery(product) {
    const images = productImages(product);
    const first = images[0];
    const label = state.lang === "tr"
      ? { previous: "Önceki görsel", next: "Sonraki görsel", empty: "Görsel yok" }
      : { previous: "Previous image", next: "Next image", empty: "No image available" };
    if (!first) return `<span class="gallery-empty">${label.empty}</span>`;
    const onerr = imgAttrs(product);
    return `<div class="product-gallery" data-gallery="${escapeHtml(product.id)}" data-image-index="0">
      <img src="${escapeHtml(first.url)}" alt="${escapeHtml(displayName(product) + (first.store ? " — " + first.store : ""))}" loading="lazy" referrerpolicy="no-referrer" ${onerr}>
      ${images.length > 1 ? `
        <button type="button" class="gallery-arrow gallery-prev" data-image-step="-1" aria-label="${label.previous}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button>
        <button type="button" class="gallery-arrow gallery-next" data-image-step="1" aria-label="${label.next}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button>
        <span class="gallery-count" aria-live="polite">1 / ${images.length} · ${escapeHtml(shortStore(first.store))}</span>
      ` : ""}
    </div>`;
  }

  function filHitCard(p) {
    const best = bestOffer(p);
    const pct = offPct(best.price, best.was);
    const saved = state.saved.includes(p.id);
    const color = translateProduct(p.color || filLabel("variants", p.variant) || displayName(p));
    const stores = Array.from(new Set((p.offers || []).map((o) => o.store)));
    const crumbs = [
      filLabel("polymers", p.polymer),
      filLabel("variants", p.variant),
      p.brand,
      p.weight,
      p.packaging === "refill" ? (state.lang === "tr" ? "Makarasız" : "Refill")
        : p.packaging === "spool" ? (state.lang === "tr" ? "Makaralı" : "With spool") : "",
      stores.join(" · ")
    ].filter(Boolean);
    return `<article class="fil-hit${hasPreorder(p) ? " is-preorder" : ""}" data-open-sheet="${p.id}">
      <div class="fil-hit-photo">
        ${productGallery(p)}
        <span class="spool spool--badge" style="${spoolStyle(p, p.polymer)}"></span>
      </div>
      <div class="fil-hit-body">
        <div class="color-name">${escapeHtml(color)}</div>
        <div class="deal-meta">${escapeHtml(crumbs.join(" · "))}</div>
        <div class="price-row">
          <span class="price-now${best.was ? " is-sale" : ""}">${money(best.price, p.currency)}</span>
          ${vatTag()}
          ${
            pct
              ? `<span class="off-pill">${escapeHtml(fill(C.units.off, { n: pct }))}</span>`
              : ""
          }
          ${
            stores.length > 1
              ? `<span class="off-pill">${escapeHtml(C.live.compared)}</span>`
              : ""
          }
          ${
            hasPreorder(p)
              ? `<span class="off-pill pre-pill">${escapeHtml(C.live.preorder)}</span>`
              : ""
          }
        </div>
        <div class="deal-actions">
          ${
            stores.length > 1
              ? `<button class="chip" type="button" data-open-sheet="${p.id}">${escapeHtml(
                  fill(C.live.storesCount, { n: stores.length })
                )}</button>`
              : ""
          }
          ${
            best.url || p.url
              ? `<a class="chip" href="${escapeHtml(best.url || p.url)}" target="_blank" rel="noopener">${escapeHtml(
                  fill(C.live.openStore, { store: shortStore(best.store || p.source || "") })
                )}</a>`
              : ""
          }
          <button class="chip${saved ? " is-on" : ""}" type="button" data-save="${p.id}">${escapeHtml(
      saved ? C.savedDeal : C.saveDeal
    )}</button>
        </div>
      </div>
    </article>`;
  }

  function filHitsHtml(cut) {
    const q = state.query.trim();
    const F = C.filament;
    const ranked = q
      ? rankFilaments(cut)
      : cut
          .slice()
          .sort((a, b) => minPrice(a) - minPrice(b) || displayName(a).localeCompare(displayName(b)));
    const title = cut.length && state.filPath.family ? filamentFamilyLabel(cut[0]) : fill(F.colorsTitle, {
      brand: state.filPath.brand,
      polymer: filLabel("polymers", state.filPath.polymer),
      variant: filLabel("variants", state.filPath.variant)
    });
    const hint = F.colorsHint;
    const count = fill(F.hitsCount, { n: ranked.length });
    if (!ranked.length) {
      return `<section class="fil-hits" id="fil-hits">
        <header class="fil-head">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(hint)}</p>
        </header>
        <p class="deal-meta">${escapeHtml(F.empty)}</p>
      </section>`;
    }
    return `<section class="fil-hits" id="fil-hits">
      <header class="fil-head">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(hint)} · ${escapeHtml(count)}</p>
      </header>
      <div class="fil-hit-list">${ranked.map(filHitCard).join("")}</div>
    </section>`;
  }

  function filFilterBtn(attr, id, label, meta, on) {
    return `<button class="fil-filter${on ? " is-on" : ""}" type="button" ${attr}="${escapeHtml(
      id
    )}">
      <span class="fil-filter-name">${escapeHtml(label)}</span>
      <em>${escapeHtml(meta)}</em>
    </button>`;
  }

  function filFiltersHtml(list, cur) {
    const F = C.filament;
    const path = state.filPath;
    const order = F.order || [];
    const byPoly = groupBy(list, "polymer");
    const polyIds = order
      .filter((id) => byPoly.has(id))
      .concat(Array.from(byPoly.keys()).filter((id) => order.indexOf(id) < 0));
    const polyBtns = polyIds
      .map((id) => {
        const items = byPoly.get(id);
        const stats = priceStats(items);
        return filFilterBtn(
          "data-fil-polymer",
          id,
          filLabel("polymers", id),
          items.length + " · " + fill(F.fromPrice, { price: money(stats.min, cur) }),
          path.polymer === id
        );
      })
      .join("");

    let typeBlock = "";
    if (path.polymer) {
      const ofPoly = list.filter((p) => p.polymer === path.polymer);
      const byVar = groupBy(ofPoly, "variant");
      const varIds = VARIANT_ORDER.filter((id) => byVar.has(id)).concat(
        Array.from(byVar.keys()).filter((id) => VARIANT_ORDER.indexOf(id) < 0)
      );
      const varBtns = varIds
        .map((id) => {
          const items = byVar.get(id);
          const stats = priceStats(items);
          return filFilterBtn(
            "data-fil-variant",
            id,
            filLabel("variants", id),
            items.length + " · " + fill(F.fromPrice, { price: money(stats.min, cur) }),
            path.variant === id
          );
        })
        .join("");
      typeBlock = `<div class="fil-filter-group">
        <h3>${escapeHtml(F.filterType)}</h3>
        ${varBtns}
      </div>`;
    }

    let brandBlock = "";
    if (path.polymer && path.variant) {
      const ofVar = list.filter((p) => p.polymer === path.polymer && p.variant === path.variant);
      const byBrand = groupBy(ofVar, "brand");
      const brands = Array.from(byBrand.entries()).sort(
        (a, b) => priceStats(a[1]).min - priceStats(b[1]).min
      );
      const lowest = brands.length ? priceStats(brands[0][1]).min : 0;
      const brandBtns = brands
        .map(([brand, items]) => {
          const stats = priceStats(items);
          const isLow = stats.min === lowest;
          const range =
            stats.max > stats.min
              ? fill(F.priceRange, {
                  min: money(stats.min, cur),
                  max: money(stats.max, cur)
                })
              : money(stats.min, cur);
          return `<button class="fil-filter${path.brand === brand ? " is-on" : ""}${
            isLow ? " is-low" : ""
          }" type="button" data-fil-brand="${escapeHtml(brand)}">
            <span class="fil-filter-name">${escapeHtml(brand)}${
            isLow ? ` <i>${escapeHtml(F.cheapest)}</i>` : ""
          }</span>
            <em>${items.length} · ${escapeHtml(range)}</em>
          </button>`;
        })
        .join("");
      brandBlock = `<div class="fil-filter-group">
        <h3>${escapeHtml(F.filterBrand)}</h3>
        ${brandBtns}
      </div>`;
    }

    return `<aside class="fil-filters">
      ${filCrumbHtml()}
      <h2 class="fil-filters-title">${escapeHtml(F.filtersTitle)}</h2>
      <div class="fil-filter-group">
        <h3>${escapeHtml(F.filterPolymer)}</h3>
        ${polyBtns}
      </div>
      ${typeBlock}
      ${brandBlock}
    </aside>`;
  }

  function filamentFamilyKey(p) {
    return JSON.stringify([p.brand || "", p.polymer || "", p.variant || "", p.packaging || "unspecified", p.weight || "", p.diameter || ""]);
  }

  function filamentFamilyLabel(p) {
    const packaging = p.packaging === "refill" ? (state.lang === "tr" ? "Makarasız" : "Refill")
      : p.packaging === "spool" ? (state.lang === "tr" ? "Makaralı" : "With spool")
      : "";
    return [p.brand, filLabel("polymers", p.polymer), filLabel("variants", p.variant), packaging, p.weight, p.diameter].filter(Boolean).join(" · ");
  }

  function filGroupPreview(items) {
    const representative = items.slice().sort((a, b) => minPrice(a) - minPrice(b)).flatMap(productImages)[0];
    const colors = new Map();
    items.forEach((p) => {
      const label = translateProduct(p.color || displayName(p));
      const key = label.toLowerCase().replace(/grey/g, "gray").trim();
      if (!colors.has(key)) colors.set(key, { p, label });
    });
    const dots = Array.from(colors.values());
    const shown = dots.slice(0, 12);
    return `<span class="fil-group-photo">${representative ? `<img src="${escapeHtml(representative.url)}" alt="" loading="lazy" data-imgs="${escapeHtml(JSON.stringify(Array.from(new Set([representative.url, ...items.flatMap((p) => productImages(p).map((i) => i.url))]))))}" data-i="0" onerror="window.__imgFail&&window.__imgFail(this)">` : `<span class="gallery-empty">${state.lang === "tr" ? "Görsel yok" : "No image available"}</span>`}</span>
      <span class="fil-group-colors">
        <span class="fil-group-swatches">${shown.map(({p, label}) => `<span class="fil-color-dot" role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="${spoolStyle(p, p.polymer)}"></span>`).join("")}${dots.length > shown.length ? `<span>+${dots.length-shown.length}</span>` : ""}</span>
        <span>${escapeHtml(state.lang === "en" && dots.length === 1 ? "1 color" : fill(C.filament.colorCount, {n: dots.length}))}</span>
      </span>`;
  }

  function filGroupsHtml(list, cur) {
    const F = C.filament;
    const path = state.filPath;
    const title = state.lang === "tr" ? "Filamentler" : "Filaments";
    const hint = state.lang === "tr"
      ? "Tüm mağazalardaki eşleşen ürünler. Renk seçenekleri için bir kart seçin."
      : "Matching products from all stores. Select a card to see its color options.";
    const grouped = new Map();
    list.forEach((p) => {
      const key = filamentFamilyKey(p);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(p);
    });
    const groups = Array.from(grouped.entries());
    groups.sort((a, b) => {
      const relevance = Math.max(...b[1].map(searchRelevance)) - Math.max(...a[1].map(searchRelevance));
      return relevance || priceStats(a[1]).min - priceStats(b[1]).min;
    });
    return `<section class="fil-hits" id="fil-hits">
      <header class="fil-head"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(hint)}</p></header>
      <div class="fil-group-list">${groups.map(([id, items]) => {
        const label = filamentFamilyLabel(items[0]);
        const stats = priceStats(items);
        const stores = Array.from(new Set(items.flatMap((p) => (p.offers || []).map((o) => o.store))));
        return `<button type="button" class="fil-group-card" aria-label="${escapeHtml(label)}" data-fil-family="${escapeHtml(id)}">
          ${filGroupPreview(items)}
          <span class="fil-group-title">${escapeHtml(label)} <span aria-hidden="true">→</span></span>
          <span class="fil-group-meta">${items.length} ${state.lang === "tr" ? "seçenek" : items.length === 1 ? "option" : "options"} · ${escapeHtml(stores.map(shortStore).join(" · "))}</span>
          <strong>${escapeHtml(fill(F.fromPrice, { price: money(stats.min, cur) }))}</strong>
        </button>`;
      }).join("")}</div>
    </section>`;
  }

  function renderFilament(list, cur) {
    const F = C.filament;
    const path = state.filPath;
    if (path.polymer && !list.some((p) => p.polymer === path.polymer)) {
      path.polymer = path.variant = path.brand = null;
    } else if (
      path.variant &&
      !list.some((p) => p.polymer === path.polymer && p.variant === path.variant)
    ) {
      path.variant = path.brand = null;
    } else if (
      path.brand &&
      !list.some(
        (p) => p.polymer === path.polymer && p.variant === path.variant && p.brand === path.brand
      )
    ) {
      path.brand = null;
    }

    if (!list.length) {
      return `${filCrumbHtml()}<div class="empty fil-empty"><h2>${escapeHtml(F.empty)}</h2></div>`;
    }

    if (path.family && !list.some((p) => filamentFamilyKey(p) === path.family && p.polymer === path.polymer && p.variant === path.variant && p.brand === path.brand)) path.family = null;
    const cut = filCut(list);
    const results = path.polymer && path.variant && path.brand && path.family ? filHitsHtml(cut) : filGroupsHtml(cut, cur);
    return `<div class="fil-layout">${filFiltersHtml(list, cur)}${results}</div>`;
  }

  function renderPrinters(products) {
    const usedAisles = liveAisles().filter((a) => products.some((p) => p.aisle === a.id));
    if (state.activeAisle && !usedAisles.some((a) => a.id === state.activeAisle)) {
      state.activeAisle = null;
    }
    const cut = state.activeAisle
      ? products.filter((p) => p.aisle === state.activeAisle)
      : products.slice();
    const filters = usedAisles
      .map((aisle) => {
        const n = products.filter((p) => p.aisle === aisle.id).length;
        const on = aisle.id === state.activeAisle ? " is-on" : "";
        return `<button class="fil-filter${on}" type="button" data-aisle="${escapeHtml(aisle.id)}">
          <span class="fil-filter-name">${escapeHtml(aisle.name)}</span>
          <em>${n}</em>
        </button>`;
      })
      .join("");
    const cards = cut.filter(isSellable).map(dealCard).join("");
    const q = state.query.trim();
    const hint = q
      ? fill(C.filament.hitsHint, { q: q })
      : C.live.printerHint;
    return `<div class="fil-layout fil-layout--printers">
      <aside class="fil-filters">
        <h2 class="fil-filters-title">${escapeHtml(C.live.printersWorld)}</h2>
        <div class="fil-filter-group">
          <h3>${escapeHtml(C.live.filterAisle)}</h3>
          ${filters}
        </div>
      </aside>
      <section class="fil-hits">
        <header class="fil-head">
          <h2>${escapeHtml(C.live.printerResults)}</h2>
          <p>${escapeHtml(hint)} · ${escapeHtml(fill(C.live.results, { n: cut.length }))}</p>
        </header>
        <div class="fil-hit-list">${
          cards || `<p class="deal-meta">${escapeHtml(C.emptyAisle)}</p>`
        }</div>
      </section>
    </div>`;
  }

  function renderAisles() {
    const root = $("#aisles");
    if (state.liveStatus === "loading") {
      root.innerHTML = `<div class="empty"><h2>${escapeHtml(C.live.loading)}</h2></div>`;
      return;
    }
    if (state.liveStatus === "error") {
      root.innerHTML = `<div class="empty"><h2>${escapeHtml(C.live.error)}</h2></div>`;
      return;
    }
    const products = matchingProducts();
    const filaments = matchingFilaments();
    const live = !!(state.liveProducts || state.liveFilaments);
    const cut = filCut(filaments);
    const printerCut = state.activeAisle
      ? products.filter((p) => p.aisle === state.activeAisle)
      : products;
    const count = live
      ? state.world === "filament"
        ? fill(C.filament.spoolCount, { n: cut.length })
        : fill(C.live.results, { n: printerCut.length })
      : fill(C.resultsCount, { n: products.length });

    if (live && state.world === "filament") {
      const cur = (filaments[0] && filaments[0].currency) || { code: "TRY", symbol: "TL", position: "after", decimals: 2 };
      root.innerHTML = `<div class="aisle-toolbar">${worldSwitchHtml(
        products,
        filaments
      )}<span class="results-count">${escapeHtml(count)}</span></div>
      <div class="fil-bay">${renderFilament(filaments, cur)}</div>`;
      return;
    }

    if (live && state.world === "printers") {
      root.innerHTML = `<div class="aisle-toolbar">${worldSwitchHtml(
        products,
        filaments
      )}<span class="results-count">${escapeHtml(count)}</span></div>
      <div class="fil-bay">${renderPrinters(products)}</div>`;
      return;
    }

    if (!products.length) {
      const extra = live ? worldSwitchHtml(products, filaments) : "";
      root.innerHTML = `${extra ? `<div class="aisle-toolbar">${extra}</div>` : ""}<div class="empty"><h2>${escapeHtml(
        C.emptySearchTitle
      )}</h2><p>${escapeHtml(C.emptySearchBody)}</p></div>`;
      return;
    }

    const usedAisles = state.liveProducts
      ? liveAisles().filter((a) => products.some((p) => p.aisle === a.id))
      : (C.aisles || []).filter((a) => products.some((p) => p.aisle === a.id));

    const cols = usedAisles
      .map((aisle) => {
        const items = products.filter((p) => p.aisle === aisle.id && isSellable(p));
        const on = aisle.id === state.activeAisle ? " is-active" : "";
        const cards = items.map(dealCard).join("");
        return `<div class="aisle-col${on}" data-aisle="${aisle.id}">
          <div class="aisle-head">
            <h3 class="aisle-name">${escapeHtml(aisle.name)}</h3>
            <svg class="aisle-arrow" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M11 4h2v10.2l3.6-3.6L18 12l-6 6-6-6 1.4-1.4 3.6 3.6V4Z"/></svg>
          </div>
          <div class="aisle-shelves">${cards || `<p class="deal-meta">${escapeHtml(
            C.emptyAisle
          )}</p>`}</div>
        </div>`;
      })
      .join("");

    root.innerHTML = `<div class="aisle-toolbar">${worldSwitchHtml(
      products,
      filaments
    )}<span class="results-count">${escapeHtml(
      count
    )}</span></div><div class="aisle-stage"><div class="aisle-floor">${cols}</div></div>`;
  }

  function revealHits() {
    if (!state.query.trim()) return;
    const hits = document.getElementById("fil-hits");
    if (!hits) return;
    requestAnimationFrame(() =>
      hits.scrollIntoView({ block: "nearest", behavior: "smooth" })
    );
  }

  function isSellable(p) {
    if (!p) return false;
    const offers = p.offers || [];
    // Every vendor out of stock (or the row itself flagged) drops the product from the site.
    if (offers.length) return liveOffers(p).length > 0;
    return offerStatus(p) !== "out_of_stock";
  }

  function dealCard(product) {
    const best = bestOffer(product);
    const pct = offPct(best.price, best.was);
    const saved = state.saved.includes(product.id);
    const cur = product.currency;
    const stores = Array.from(new Set((product.offers || []).map((o) => o.store)));
    const metaBits = [product.unit || product.brand, stores.join(" · ")];
    if (best.km != null) metaBits.push(km(best.km));
    return `<article class="deal${hasPreorder(product) ? " is-preorder" : ""}" data-open-sheet="${product.id}">
      <div class="deal-photo">${productGallery(product)}</div>
      <div class="deal-body">
        <div class="deal-name">${escapeHtml(displayName(product))}</div>
        <div class="deal-meta">${escapeHtml(metaBits.filter(Boolean).join(" · "))}</div>
        <div class="price-row">
          <span class="price-now${best.was ? " is-sale" : ""}">${money(best.price, cur)}</span>
          ${vatTag()}
          ${
            best.was
              ? `<span class="price-was">${escapeHtml(
                  fill(C.wasPrice, { price: money(best.was, cur) })
                )}</span>`
              : ""
          }
          ${pct ? `<span class="off-pill">${escapeHtml(fill(C.units.off, { n: pct }))}</span>` : ""}
          ${
            stores.length > 1
              ? `<span class="off-pill">${escapeHtml(C.live.compared)}</span>`
              : ""
          }
          ${
            hasPreorder(product)
              ? `<span class="off-pill pre-pill">${escapeHtml(C.live.preorder)}</span>`
              : ""
          }
        </div>
        <div class="deal-actions">
          ${
            stores.length > 1 || product.bundleOptions
              ? `<button class="chip" type="button" data-open-sheet="${product.id}">${escapeHtml(
                  product.bundleOptions ? (state.lang === "tr" ? "Paket seçenekleri" : "Bundle options") : fill(C.live.storesCount, { n: stores.length })
                )}</button>`
              : ""
          }
          ${
            best.url || product.url
              ? `<a class="chip" href="${escapeHtml(best.url || product.url)}" target="_blank" rel="noopener">${escapeHtml(
                  fill(C.live.openStore, { store: shortStore(best.store || product.source || "") })
                )}</a>`
              : `<button class="chip" type="button" data-open-sheet="${product.id}">${escapeHtml(
                  fill(C.offerCount, { n: product.offers.length })
                )}</button>`
          }
          <button class="chip${saved ? " is-on" : ""}" type="button" data-save="${
      product.id
    }">${escapeHtml(saved ? C.savedDeal : C.saveDeal)}</button>
        </div>
      </div>
    </article>`;
  }

  function renderCartBadge() {
    const badge = $("#cart-badge");
    badge.hidden = state.saved.length === 0;
    badge.textContent = String(state.saved.length);
  }

  function renderCart() {
    const body = $("#cart-body");
    const items = state.saved.map((id) => findProduct(id)).filter(Boolean);
    if (!items.length) {
      body.innerHTML = `<p>${escapeHtml(C.cart.empty)}</p>`;
      return;
    }
    body.innerHTML = items
      .map((p) => {
        const best = bestOffer(p);
        return `<div class="saved-row">
          ${productImages(p)[0] ? `<img src="${escapeHtml(productImages(p)[0].url)}" alt="" width="54" height="54" style="width:3.4rem;height:3.4rem;object-fit:cover;border-radius:8px" ${imgAttrs(p)}>` : ""}
          <div>
            <strong>${escapeHtml(displayName(p))}</strong>
            <div class="deal-meta">${escapeHtml(best.store)} · ${money(best.price, p.currency)}</div>
          </div>
          <button class="ghost" type="button" data-save="${p.id}">${escapeHtml(
          C.cart.remove
        )}</button>
        </div>`;
      })
      .join("");
  }

  function renderProfile() {
    $("#profile-body").innerHTML = `<div class="profile-card">
        <strong>${escapeHtml(
          fill(C.profile.greeting, { location: locationName(state.locationId) })
        )}</strong>
        <span>${escapeHtml(fill(C.profile.savedCount, { n: state.saved.length }))}</span>
      </div>
      <p class="profile-hint">${escapeHtml(C.profile.hint)}</p>`;
  }

  function renderLocations() {
    $("#loc-list").innerHTML = (C.locations || [])
      .map((loc) => {
        const on = loc.id === state.locationId ? " is-active" : "";
        return `<li><button class="loc-item${on}" type="button" data-loc="${loc.id}">${escapeHtml(
          loc.name
        )}</button></li>`;
      })
      .join("");
  }

  function renderSheet() {
    const p = findProduct(state.sheetProduct);
    const body = $("#sheet-body");
    const title = $("#sheet-title");
    if (!p) {
      body.innerHTML = "";
      return;
    }
    title.textContent = displayName(p);
    const best = bestOffer(p);
    // Only live vendors are compared; the ones that ran out are left out, not shown dead.
    const compared = liveOffers(p).slice().sort((a, b) => a.price - b.price);
    const rows = compared
      .map((o, i) => {
        const tag = i === 0 ? `<span class="off-pill">${escapeHtml(C.bestOffer)}</span>` : "";
        const isPreorder = o.preorder || offerStatus(o) === "preorder";
        const pre = isPreorder
          ? `<span class="off-pill pre-pill">${escapeHtml(C.live.preorder)}</span>`
          : "";
        return `<div class="offer-row${isPreorder ? " is-preorder" : ""}">
          <div>
            <strong>${escapeHtml(o.store)}</strong>
            ${o.bundleName ? `<div class="deal-meta">${escapeHtml(o.bundleName)}</div>` : ""}
            <div class="deal-meta">${escapeHtml(
              [o.km != null ? km(o.km) : C.live.online, o.was ? fill(C.wasPrice, { price: money(o.was, p.currency) }) : ""]
                .filter(Boolean)
                .join(" · ")
            )}</div>
            ${/^https?:\/\//i.test(o.url || "") ? `<a class="offer-check" href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml((state.lang === "tr" ? "Fiyatı kontrol et: " : "Check price at ") + o.store + (o.bundleName ? " — " + o.bundleName : ""))}">${state.lang === "tr" ? "Fiyatı kontrol et" : "Check price"} <span aria-hidden="true">↗</span></a>` : ""}
          </div>
          <div style="text-align:end">
            <div class="price-now${o.was ? " is-sale" : ""}">${money(o.price, p.currency)}</div>
            ${vatTag()}
            ${tag}${pre}
          </div>
        </div>`;
      })
      .join("");
    body.innerHTML = `<div class="sheet-hero">
        ${productGallery(p)}
        <div>
          <div class="deal-meta">${escapeHtml(p.unit)} · ${escapeHtml(aisleName(p.aisle))}</div>
          <p style="margin-top:.5rem">${escapeHtml(
            fill(C.sheet.bestAt, { store: best.store })
          )}</p>
        </div>
      </div>${rows}`;
  }

  function openDrawer(name) {
    state.open = name;
    ["location", "cart", "profile", "sheet"].forEach((id) => {
      const el = $("#drawer-" + id);
      el.hidden = id !== name;
    });
    if (name === "cart") renderCart();
    if (name === "profile") renderProfile();
    if (name === "location") renderLocations();
    if (name === "sheet") renderSheet();
  }

  function closeDrawers() {
    state.open = null;
    state.sheetProduct = null;
    ["location", "cart", "profile", "sheet"].forEach((id) => {
      $("#drawer-" + id).hidden = true;
    });
  }

  window.__imgFail = imgFail;
  window.__3dp = { state, bestOffer, liveOffers, isSellable, productImages, imgFail, matchingProducts, matchingFilaments, searchRelevance, searchHaystack, foldText, setQuery, catalogIsStale, huntRhino };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toggleSave(id) {
    const i = state.saved.indexOf(id);
    if (i >= 0) state.saved.splice(i, 1);
    else state.saved.push(id);
    persist();
    renderCartBadge();
    renderAisles();
    if (state.open === "cart") renderCart();
    if (state.open === "profile") renderProfile();
  }

  function renderLangSwitch() {
    const root = $("#lang-switch");
    if (!root) return;
    root.setAttribute("aria-label", (C.header && C.header.languageAria) || "Language");
    root.innerHTML = (BASE.languages || [])
      .map(
        (l) =>
          `<button class="lang-btn${l.id === state.lang ? " is-on" : ""}" type="button" data-lang="${l.id}">${escapeHtml(
            l.label
          )}</button>`
      )
      .join("");
  }

  function applyLang(id, skipStore) {
    const langs = BASE.languages || [];
    const chosen = langs.find((l) => l.id === id) || langs[0] || { id: "en", dir: "ltr" };
    state.lang = chosen.id;
    C =
      chosen.id === "en" || !BASE.locale || !BASE.locale[chosen.id]
        ? BASE
        : deepMerge(BASE, BASE.locale[chosen.id]);
    C.lang = chosen.id;
    C.dir = chosen.dir || C.dir || "ltr";
    if (!skipStore) localStorage.setItem(STORAGE_LANG, state.lang);
    document.documentElement.lang = C.lang;
    document.documentElement.dir = C.dir;
    document.title = C.documentTitle || C.brand.name;
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", C.brand.tagline || "");
    applyI18n(document);
    $("#header-query").placeholder = C.header.searchPlaceholder;
    $("#hunter-query").placeholder = C.hunter.placeholder;
    $("#new-tab").setAttribute("title", C.header.newTab);
    renderLangSwitch();
    renderTabs();
    renderBanner();
    renderLocationLine();
    renderAds();
    renderAisles();
    renderCartBadge();
    if (state.open === "cart") renderCart();
    if (state.open === "profile") renderProfile();
    if (state.open === "sheet") renderSheet();
  }

  function initStatic() {
    applyLang(state.lang, true);
  }

  function bind() {
    $("#header-search").addEventListener("submit", (e) => {
      e.preventDefault();
      setQuery($("#header-query").value, "header");
    });
    $("#hunter-form").addEventListener("submit", (e) => {
      e.preventDefault();
      setQuery($("#hunter-query").value, "hunter");
    });
    $("#header-query").addEventListener("input", (e) => {
      setQuery(e.target.value, "header");
      state.suggestClosed = false;
      state.suggestIndex = -1;
      clearTimeout(suggestTimer);
      suggestTimer = setTimeout(renderSuggest, 120);
    });
    $("#header-query").addEventListener("keydown", (e) => {
      onSuggestKey(e);
      if (e.key === "Enter") onSuggestEnter(e);
    });
    $("#header-query").addEventListener("focus", () => {
      if (state.query.trim()) {
        state.suggestClosed = false;
        renderSuggest();
      }
    });
    $("#header-suggest").addEventListener("click", (e) => {
      if (e.target.closest("#suggest-all")) {
        hideSuggest();
        setQuery(state.query, "header");
        return;
      }
      // A suggestion row carries data-open-sheet, so the drawer handler opens it.
      if (e.target.closest(".suggest-row")) hideSuggest();
    });
    $("#hunter-query").addEventListener("input", (e) => setQuery(e.target.value, "hunter"));
    // An old tab should not keep showing a catalog the admin has since changed.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && catalogIsStale()) huntRhino(state.query || "", "", true);
    });
    $("#hunter-clear").addEventListener("click", () => setQuery(""));

    $("#new-tab").addEventListener("click", () => {
      saveTabScroll();
      const tab = { id: uid(), n: nextHuntN(), query: "", scroll: 0 };
      state.tabs.push(tab);
      state.activeTab = tab.id;
      setQuery("");
      restoreTabScroll();
    });

    function goHome() {
      state.tabs = [{ id: "home", n: 1, query: "", scroll: 0 }];
      state.activeTab = "home";
      state.liveProducts = null;
      state.liveFilaments = null;
      state.liveStatus = "idle";
      state.world = "printers";
      state.filPath = { polymer: null, variant: null, brand: null };
      state.banner = 0;
      state.activeAisle = C.aisles[0] ? C.aisles[0].id : null;
      setQuery("");
      renderBanner();
      renderLocationLine();
      closeDrawers();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    $$(".js-go-home").forEach((el) => el.addEventListener("click", goHome));

    $("#nav-cart").addEventListener("click", () => openDrawer("cart"));
    $("#nav-profile").addEventListener("click", () => openDrawer("profile"));
    $("#header-location").addEventListener("click", () => openDrawer("location"));

    document.addEventListener("click", (e) => {
      if ($("#header-suggest") && !e.target.closest("#header-search")) hideSuggest();
      const close = e.target.closest("[data-close]");
      if (close) {
        closeDrawers();
        return;
      }
      const tab = e.target.closest("[data-tab]");
      if (tab && !e.target.closest("[data-close-tab]")) {
        const id = tab.getAttribute("data-tab");
        const found = state.tabs.find((t) => t.id === id);
        if (found && found.id !== state.activeTab) {
          saveTabScroll();
          state.activeTab = found.id;
          setQuery(found.query || "");
          restoreTabScroll();
        }
        return;
      }
      const closeTab = e.target.closest("[data-close-tab]");
      if (closeTab) {
        const id = closeTab.getAttribute("data-close-tab");
        const idx = state.tabs.findIndex((t) => t.id === id);
        if (idx >= 0 && state.tabs.length > 1) {
          state.tabs.splice(idx, 1);
          if (state.activeTab === id) {
            const next = state.tabs[Math.max(0, idx - 1)];
            state.activeTab = next.id;
            setQuery(next.query || "");
            restoreTabScroll();
          } else {
            renderTabs();
          }
        }
        return;
      }
      const banner = e.target.closest("[data-banner]");
      if (banner) {
        state.banner = Number(banner.getAttribute("data-banner"));
        renderBanner();
        return;
      }
      const imageArrow = e.target.closest("[data-image-step]");
      if (imageArrow) {
        e.stopPropagation();
        const gallery = imageArrow.closest("[data-gallery]");
        const product = findProduct(gallery.dataset.gallery);
        const images = productImages(product);
        if (images.length < 2) return;
        const index = (Number(gallery.dataset.imageIndex || 0) + Number(imageArrow.dataset.imageStep) + images.length) % images.length;
        gallery.dataset.imageIndex = String(index);
        const img = gallery.querySelector("img");
        img.src = images[index].url;
        img.alt = displayName(product) + " — " + images[index].store;
        gallery.querySelector(".gallery-count").textContent = `${index + 1} / ${images.length} · ${shortStore(images[index].store)}`;
        return;
      }
      const save = e.target.closest("[data-save]");
      if (save) {
        e.stopPropagation();
        toggleSave(save.getAttribute("data-save"));
        return;
      }
      const langBtn = e.target.closest("[data-lang]");
      if (langBtn) {
        applyLang(langBtn.getAttribute("data-lang"));
        return;
      }
      const world = e.target.closest("[data-world]");
      if (world) {
        state.world = world.getAttribute("data-world");
        renderAisles();
        return;
      }
      if (e.target.closest("[data-fil-back]")) {
        const p = state.filPath;
        if (p.family) { state.filPath = state.filFamilyParent || { polymer: null, variant: null, brand: null }; state.filFamilyParent = null; }
        else if (p.brand) p.brand = null;
        else if (p.variant) p.variant = null;
        else p.polymer = null;
        renderAisles();
        revealHits();
        return;
      }
      const level = e.target.closest("[data-fil-level]");
      const family = e.target.closest("[data-fil-family]");
      if (family) {
        const id = family.getAttribute("data-fil-family");
        const product = matchingFilaments().find((p) => filamentFamilyKey(p) === id);
        if (!product) return;
        state.filFamilyParent = { ...state.filPath, family: null };
        state.filPath = { polymer: product.polymer, variant: product.variant, brand: product.brand, family: id };
        renderAisles();
        revealHits();
        return;
      }
      if (e.target.closest("[data-fil-level],[data-fil-polymer],[data-fil-variant],[data-fil-brand]")) state.filPath.family = null;
      if (level) {
        const step = level.getAttribute("data-fil-level");
        if (step === "root") state.filPath = { polymer: null, variant: null, brand: null };
        if (step === "polymer") state.filPath.variant = state.filPath.brand = null;
        if (step === "variant") state.filPath.brand = null;
        renderAisles();
        revealHits();
        return;
      }
      const poly = e.target.closest("[data-fil-polymer]");
      if (poly) {
        const id = poly.getAttribute("data-fil-polymer");
        state.filPath =
          state.filPath.polymer === id
            ? { polymer: null, variant: null, brand: null }
            : { polymer: id, variant: null, brand: null };
        renderAisles();
        revealHits();
        return;
      }
      const vari = e.target.closest("[data-fil-variant]");
      if (vari) {
        const id = vari.getAttribute("data-fil-variant");
        if (state.filPath.variant === id) {
          state.filPath.variant = null;
          state.filPath.brand = null;
        } else {
          state.filPath.variant = id;
          state.filPath.brand = null;
        }
        renderAisles();
        revealHits();
        return;
      }
      const brandBtn = e.target.closest("[data-fil-brand]");
      if (brandBtn) {
        const id = brandBtn.getAttribute("data-fil-brand");
        state.filPath.brand = state.filPath.brand === id ? null : id;
        renderAisles();
        revealHits();
        return;
      }
      const loc = e.target.closest("[data-loc]");
      if (loc) {
        state.locationId = loc.getAttribute("data-loc");
        persist();
        renderLocationLine();
        renderLocations();
        closeDrawers();
        return;
      }
      const aisle = e.target.closest("[data-aisle]");
      if (aisle && !e.target.closest("[data-open-sheet],[data-save]")) {
        const id = aisle.getAttribute("data-aisle");
        state.activeAisle = state.activeAisle === id ? null : id;
        renderAisles();
        return;
      }
      if (e.target.closest("a.chip")) return;
      const sheet = e.target.closest("[data-open-sheet]");
      if (sheet) {
        state.sheetProduct = sheet.getAttribute("data-open-sheet");
        openDrawer("sheet");
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDrawers();
    });

    window.addEventListener(
      "scroll",
      () => {
        saveTabScroll();
      },
      { passive: true }
    );
    window.addEventListener("resize", layoutTabs);
    if (window.ResizeObserver) {
      const strip = document.querySelector(".tab-strip");
      if (strip) new ResizeObserver(layoutTabs).observe(strip);
    }
  }

  initStatic();
  bind();
  huntRhino(state.query || "");
})();
