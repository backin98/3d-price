(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    data: null,
    tab: "overview",
    catalogQuery: "",
    catalogLimit: 40,
    editing: new Map(), // productId -> {shelf, object}
    bannersDraft: null,
    pickedPin: null,
    reviewSelected: new Set(),
    reviewFlags: new Set(),
    reviewPlace: new Map(),
    catalogSelected: new Set(),
    catalogShop: "",
    catalogVariant: "",
    dupesOnly: false,
    dupes: null,
    keeperId: "",
    reviewJobId: "",
    catalogUndo: null,
    // Which disclosures the user opened. The 5s poll rebuilds the page HTML, which would
    // otherwise slam every <details> shut while you are working in it.
    openDetails: new Set(),
    loading: false,
    timer: null,
    workerLive: null
  };

  // Remembers which disclosures are open so a re-render does not close them. Inline ontoggle
  // passes the element itself, a delegated listener passes an event — accept both shapes.
  const isOpen = (key) => state.openDetails.has(key);
  const openAttr = (key) => (isOpen(key) ? " open" : "");
  const detailAttrs = (key) => `data-detail-key="${esc(key)}"${openAttr(key)} ontoggle="window.__keepOpen&&window.__keepOpen(this)"`;
  function rememberDetails(e) {
    const el = e && e.dataset ? e : (e && e.target);
    if (!el || !el.dataset || !el.dataset.detailKey) return;
    if (el.open) state.openDetails.add(el.dataset.detailKey);
    else state.openDetails.delete(el.dataset.detailKey);
  }

  // Inline ontoggle keeps this working no matter how the page was re-rendered.
  window.__keepOpen = rememberDetails;

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function imageUrl(p) {
    const url = p && (p.image || (p.offers || [])[0]?.image || "");
    return /^(https?:)?\/\//i.test(url) || url.charAt(0) === "/" ? url : url ? "/" + url : "";
  }

  function webpFallback(url) {
    return String(url || "")
      .replace(/\.webp(\?|#|$)/i, ".jpg$1")
      .replace(/([?&](?:format|_format|fm)=)webp\b/i, "$1jpg");
  }

  function productImg(url, extraClass) {
    const src = imageUrl({ image: url });
    if (!src) return '<span class="review-noimg">no image</span>';
    const fb = webpFallback(src);
    const err = fb !== src
      ? `onerror="if(!this.dataset.fb){this.dataset.fb='1';this.src='${esc(fb)}';}else{this.outerHTML='<span class=review-noimg>no image</span>'}"`
      : `onerror="this.outerHTML='<span class=review-noimg>no image</span>'"`;
    return `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" ${err}${extraClass ? ` class="${extraClass}"` : ""}>`;
  }

  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.hidden = true; }, 2600);
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (res.status === 401) {
      showLogin();
      throw new Error(data.error || "Unauthorized");
    }
    if (!res.ok) throw new Error(data.error || ("HTTP " + res.status));
    return data;
  }

  function showLogin() {
    $("#app").hidden = true;
    $("#login").hidden = false;
    stopPolling();
  }

  function showApp() {
    $("#login").hidden = true;
    $("#app").hidden = false;
    loadData().catch((err) => toast(err.message));
    startPolling();
  }

  function workerBase() {
    if (state.workerLive && state.workerLive.ok && state.workerLive.workerUrl) {
      return String(state.workerLive.workerUrl).replace(/\/+$/, "");
    }
    const saved = String(state.data?.desk?.workerUrl || "").replace(/\/+$/, "");
    const model = String(state.data?.desk?.modelUrl || "").replace(/\/+$/, "");
    if (saved && saved !== model && !/:123[45]\b/.test(saved)) return saved;
    return "http://127.0.0.1:8788";
  }

  function workerCandidates() {
    const found = [];
    const add = (u) => {
      const n = String(u || "").replace(/\/+$/, "");
      if (n && !found.includes(n) && !/:123[45]\b/.test(n)) found.push(n);
    };
    add(state.workerLive && state.workerLive.workerUrl);
    add(state.data?.desk?.workerUrl);
    add("http://127.0.0.1:8788");
    add("http://localhost:8788");
    return found;
  }

  function heartbeatFresh(d) {
    const hb = d && d.heartbeat;
    return !!(hb && hb.at && Date.now() - Date.parse(hb.at) < 120000);
  }

  function workerFetch(path, options = {}) {
    return fetch(workerBase() + path, {
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      ...options,
      targetAddressSpace: "loopback"
    });
  }

  async function pingOne(base) {
    const res = await fetch(base + "/health?site=" + encodeURIComponent(location.origin), {
      mode: "cors",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(4000),
      targetAddressSpace: "loopback"
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.error || ("HTTP " + res.status));
    return { ok: true, workerUrl: base, error: "", model: data.model, connection: data.connection, at: Date.now() };
  }

  async function pingWorker() {
    let lastErr = "unreachable";
    for (const base of workerCandidates()) {
      try {
        state.workerLive = await pingOne(base);
        return state.workerLive;
      } catch (err) {
        lastErr = err.message || "unreachable";
      }
    }
    state.workerLive = { ok: false, workerUrl: workerBase(), error: lastErr, at: Date.now() };
    return state.workerLive;
  }

  async function requestDetect(opts = {}) {
    const live = state.workerLive && state.workerLive.ok ? state.workerLive : await pingWorker();
    if (!live.ok) throw new Error(live.error || "Worker offline");
    const params = new URLSearchParams({ site: location.origin });
    if (opts.scan) params.set("scan", "1");
    if (opts.modelUrl) params.set("modelUrl", opts.modelUrl);
    if (state.data?.desk?.modelCheckId) params.set("modelCheckId", state.data.desk.modelCheckId);
    const res = await workerFetch("/detect?" + params.toString(), { signal: AbortSignal.timeout(20000) });
    const info = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(info.error || ("Worker HTTP " + res.status));
    state.workerLive = {
      ok: true,
      workerUrl: workerBase(),
      error: (info.connection && info.connection.error) || "",
      model: info.model,
      connection: info.connection,
      at: Date.now()
    };
    return info;
  }

  async function adoptDetectedUrl(origin) {
    const next = String(origin || "").replace(/\/+$/, "");
    if (!next) return false;
    const cur = String(state.data?.desk?.modelUrl || "").replace(/\/+$/, "");
    if (cur === next) return false;
    const saved = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "saveModelConnection", url: next }) });
    if (saved && saved.desk && state.data) state.data.desk = { ...state.data.desk, ...saved.desk };
    const input = $("#ai-url");
    if (input) input.value = next;
    return true;
  }

  async function autoDetectModel() {
    if (!state.workerLive || !state.workerLive.ok) return;
    try {
      const info = state.workerLive.model && state.workerLive.connection && !state.workerLive.connection.error
        ? { model: state.workerLive.model, connection: state.workerLive.connection }
        : await requestDetect({ scan: true });
      const origin = info.connection && info.connection.modelUrl;
      if (origin && info.model) await adoptDetectedUrl(origin);
      if ($("#ai-status")) $("#ai-status").innerHTML = aiStatusHtml(state.data);
    } catch (_) { /* worker online but no local AI yet */ }
  }

  async function notifyWorker(job) {
    const base = workerBase();
    if (!base) return { skipped: true };
    const res = await workerFetch(
      "/run?site=" + encodeURIComponent(location.origin) + "&jobId=" + encodeURIComponent((job && job.id) || ""),
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ("Worker HTTP " + res.status));
    return data;
  }

  async function loadData() {
    const data = await api("/api/admin");
    state.data = data;
    if (!state.bannersDraft) state.bannersDraft = JSON.parse(JSON.stringify(data.desk.banners || []));
    await pingWorker();
    await autoDetectModel();
    render();
  }

  function startPolling() {
    stopPolling();
    state.timer = setInterval(() => {
      if (!state.loading && $("#login").hidden) {
        api("/api/admin").then(async (data) => {
          state.data = data;
          await pingWorker();
          renderHeaderOnly();
          if (state.tab === "overview") paint("#tab-overview", overviewHtml(data));
          if (state.tab === "jobs") paint("#tab-jobs", jobsHtml(data));
          if (state.tab === "ai") {
            const ae = document.activeElement;
            if (ae && $("#tab-ai")?.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
            paint("#tab-ai", aiHtml(data));
          }
          if (state.tab === "catalog") {
            const ae = document.activeElement;
            if (ae && $("#tab-catalog")?.contains(ae) && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT")) return;
            paint("#tab-catalog", catalogHtml(data));
          }
          if (state.tab === "runs") {
            const ae = document.activeElement;
            const typing = ae && (ae.tagName === "SELECT" || (ae.tagName === "INPUT" && ae.type !== "checkbox"));
            if (typing && $("#tab-runs")?.contains(ae)) return;
            const url = $("#shop-url")?.value, kind = $("#shop-kind")?.value, max = $("#shop-max")?.value, cat = $("#run-cat")?.value, shop = $("#run-shop")?.value, llm = $("#run-llm")?.checked;
            paint("#tab-runs", runsHtml(data));
            if ($("#shop-url")) { $("#shop-url").value = url; $("#shop-kind").value = kind; $("#shop-max").value = max; }
            if ($("#run-llm") && llm !== undefined) $("#run-llm").checked = llm;
            if ($("#run-shop") && shop) $("#run-shop").value = shop;
            fillRunCategories(shop || $("#run-shop")?.value, cat);
          }
        }).catch(() => {});
      }
    }, 5000);
  }

  function stopPolling() {
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  async function action(body) {
    const r = await api("/api/admin", { method: "POST", body: JSON.stringify(body) });
    await loadData();
    return r;
  }

  function currentCatalog() {
    return (state.data && state.data.catalog) || { products: [], filaments: [] };
  }

  function allProducts() {
    const c = currentCatalog();
    return [
      ...(c.products || []).map((p) => ({ ...p, shelf: "product" })),
      ...(c.filaments || []).map((p) => ({ ...p, shelf: "filament" }))
    ];
  }

  const ADMIN_STOP = new Set(["3d", "yazici", "printer", "fiyat", "fiyati", "inceleme", "stok", "stoktan", "ve", "ile", "adet", "urun", "model", "makine", "makinesi", "kutu", "hediye", "yeni", "tl", "try"]);

  // Lowercase, strip accents, and treat dotless ı as i, so "yazici" finds "Yazıcı".
  function adminFold(value) {
    return String(value == null ? "" : value).toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/ı/g, "i").replace(/\s+/g, " ").trim();
  }

  function adminMatches(p, query) {
    const toks = adminFold(query).split(/[^\p{L}\p{N}]+/u).filter((t) => t && !ADMIN_STOP.has(t));
    if (!toks.length) return true;
    const hay = adminFold([
      p.id, p.name, p.brand, p.color, p.polymer, p.variant, p.unit, p.aisle,
      ...(p.offers || []).flatMap((o) => [o.store, o.sourceTitle, String((o && o.url) || "").split("/").filter(Boolean).pop()])
    ].filter(Boolean).join(" "));
    const hayWords = hay.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    // Every word must land, as a word or as the start of one, so half-typed searches work.
    return toks.every((t) => hay.includes(t) || hayWords.some((w) => w.startsWith(t)));
  }

  // Backups: a named snapshot of the whole database, and a restore that replaces it entirely.
  function backupsPanel() {
    const backups = (state.data && state.data.backups) || [];
    const when = (iso) => String(iso || "").slice(0, 16).replace("T", " ");
    return `<details class="danger-zone" ${detailAttrs("backups")}><summary>Backups — save the database, or go back to a saved one${
      backups.length ? ` (${backups.length})` : ""
    }</summary>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input id="backup-name" type="text" maxlength="60" placeholder="Name this backup (e.g. before the big cleanup)" style="min-width:280px">
        <button class="btn-sm primary" type="button" id="backup-create">Back up now</button>
        <button class="btn-sm danger" type="button" id="backup-fresh">Start fresh (empty catalog)</button>
      </div>
      <p class="muted">A backup holds the catalog, the draft and the shops. <strong>Restoring replaces all of it</strong> — whatever changed since is gone (a snapshot of the current state is taken automatically first, so a restore is itself undoable). Run history is not part of a backup: it is left alone.</p>
      <ul class="row-list">${
        backups
          .map(
            (b) => `<li><span><strong>${esc(b.name)}</strong>
              <br><small class="muted">${esc(when(b.createdAt))} · ${Number(b.rows) || 0} products · ${Number(b.offers) || 0} offers · ${Number(b.shops) || 0} shops${
              b.hasDraft ? " · draft" : ""
            }${b.note ? " · " + esc(b.note) : ""}</small></span>
              <span style="display:flex;gap:6px"><button class="btn-sm" type="button" data-backup-restore="${esc(b.key)}">Restore</button>
              <button class="btn-sm danger" type="button" data-backup-delete="${esc(b.key)}">Delete</button></span></li>`
          )
          .join("") || '<li class="muted">No backups yet. Name one above and press Back up now.</li>'
      }</ul>
    </details>`;
  }

  function filteredProducts() {
    const q = state.catalogQuery.trim().toLowerCase();
    const shop = state.catalogShop;
    const variant = state.catalogVariant;
    const dupeIds = state.dupesOnly && state.dupes
      ? new Set((state.dupes.clusters || []).flatMap((c) => (c.rows || []).map((r) => r.id)))
      : null;
    return allProducts().filter((p) => {
      if (dupeIds && !dupeIds.has(p.id)) return false;
      if (shop && !(p.offers || []).some((o) => o.store === shop)) return false;
      if (variant) {
        const a = p.axes || {};
        if (variant === "bare" && a.combo) return false;
        if (variant === "combo" && !a.combo) return false;
        if (variant === "ams2" && !/ams 2/i.test(a.ams || "")) return false;
        if (variant === "mini" && !a.mini) return false;
        if (variant === "laser" && !a.laser) return false;
      }
      if (!q) return true;
      // Token search over the row and its offers, so a family query finds a branched row whose
      // own name is just a slug. Mirrors lib/search-match.cjs.
      return adminMatches(p, q);
    }).slice(0, state.catalogLimit);
  }

  // ---------- render ----------

  function renderHeaderOnly() {
    const d = state.data;
    if (!d) return;
    $("#worker-status").innerHTML = heartbeatLabel(d);
    if ($("#ai-status")) $("#ai-status").innerHTML = aiStatusHtml(d);
  }

  // Setting innerHTML throws away everything the DOM knows — including which <details> are
  // open, focus and scroll. An idle 5s poll produces byte-identical markup, so only write when
  // something actually changed. Every tab goes through here.
  const painted = new Map();
  function paint(sel, html) {
    const el = $(sel);
    if (!el) return;
    if (painted.get(sel) === html) return;
    painted.set(sel, html);
    el.innerHTML = html;
  }

  function render() {
    const d = state.data;
    if (!d) return;
    paint("#tab-overview", overviewHtml(d));
    paint("#tab-runs", runsHtml(d));
    paint("#tab-catalog", catalogHtml(d));
    paint("#tab-shops", shopsHtml(d));
    paint("#tab-merch", merchHtml(d));
    paint("#tab-ai", aiHtml(d));
    paint("#tab-jobs", jobsHtml(d));
    renderHeaderOnly();
    selectPage();
  }

  const pages = {
    overview: ["Overview", "Your catalog, shop activity, and next steps at a glance."],
    catalog: ["Catalog", "Review and edit the products visible on your storefront."],
    shops: ["Shops", "Manage the shops included in your price comparison."],
    runs: ["Shop runs", "Collect products from a shop and follow its progress."],
    merch: ["Storefront", "Manage homepage banners and featured products."],
    ai: ["AI connection", "Paste the LM Studio server URL. The local worker finds it automatically."],
    jobs: ["Job history", "Review queued, completed, and failed jobs."]
  };

  function selectPage() {
    const requested = location.hash.slice(1);
    state.tab = Object.hasOwn(pages, requested) ? requested : "overview";
    $$(".tab-panel").forEach((el) => { el.hidden = el.id !== "tab-" + state.tab; });
    $$("#tabs [data-tab]").forEach((link) => {
      const active = link.dataset.tab === state.tab;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    $("#page-title").textContent = pages[state.tab][0];
    $("#page-description").textContent = pages[state.tab][1];
    document.title = pages[state.tab][0] + " — 3D Price Desk";
  }

  function activeJob(d) {
    return (d.jobs || []).find((j) => ["queued", "running"].includes(j.status));
  }

  function heartbeatLabel(d) {
    const live = state.workerLive;
    const ok = heartbeatFresh(d) || !!(live && live.ok);
    return `<span class="badge ${ok ? "complete" : "failed"}">worker ${ok ? "online" : "offline"}</span>`;
  }

  function overviewHtml(d) {
    const c = currentCatalog();
    const cand = d.candidate;
    return `
      <div class="grid">
        <div class="card metric"><span>Products</span><strong>${(c.products || []).length}</strong></div>
        <div class="card metric"><span>Filaments</span><strong>${(c.filaments || []).length}</strong></div>
        <div class="card metric"><span>Shops enabled</span><strong>${(d.desk.shops || []).filter((s) => s.enabled !== false).length}/${(d.desk.shops || []).length}</strong></div>
        <div class="card metric"><span>Worker</span><strong style="font-size:18px">${heartbeatLabel(d)}</strong></div>
      </div>
      <div class="quick-links">
        <a href="#runs" class="card"><span class="eyebrow">01 / COLLECT</span><h2>Start a shop run →</h2><p>Collect fresh prices and products from a shop.</p></a>
        <a href="#catalog" class="card"><span class="eyebrow">02 / REVIEW</span><h2>Manage the catalog →</h2><p>Find products and update their details.</p></a>
        <a href="#merch" class="card"><span class="eyebrow">03 / PRESENT</span><h2>Update the storefront →</h2><p>Choose banners and featured products.</p></a>
      </div>
      <div class="panel">
        <h2>Ready to publish</h2>
        ${cand ? `<p class="muted">A candidate catalog is waiting. It contains ${(cand.products || []).length} products and ${(cand.filaments || []).length} filaments (saved ${cand.savedAt ? new Date(cand.savedAt).toLocaleString() : "unknown"}). Publishing replaces the live catalog.</p>
          <div style="display:flex;gap:8px"><button class="primary ok" id="publish-candidate">Publish candidate to live catalog</button><button class="ghost" id="discard-candidate">Discard candidate</button></div>`
          : `<p class="muted">No candidate yet. Start a shop run on this PC’s worker.</p>`}
      </div>
    `;
  }

  function deskShops(d) {
    return (d && d.desk && d.desk.shops) || [];
  }

  function hostFrom(raw) {
    const s = String(raw || "").trim();
    if (!s) return "";
    try { return new URL(/^[a-z]+:\/\//i.test(s) ? s : "https://" + s).hostname.replace(/^www\./, "").toLowerCase(); } catch (_) { /* fall through */ }
    const m = s.match(/^(?:https?:\/\/)?(?:www\.)?([^/:?#]+)/i);
    return (m ? m[1] : s).replace(/^www\./, "").toLowerCase();
  }

  function shopHostOf(shop) {
    return hostFrom(shop && shop.url) || hostFrom(shop && shop.id);
  }

  function urlHostOf(url) {
    return hostFrom(url);
  }

  function shopCategories(shop) {
    if (!shop) return [];
    const host = shopHostOf(shop);
    const seen = new Set();
    const out = [];
    for (const c of shop.categories || []) {
      if (!c || !c.url) continue;
      if (urlHostOf(c.url) !== host) continue;
      const key = c.id || c.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  function shopById(d, id) {
    return deskShops(d).find((s) => s.id === id) || null;
  }

  function shopForUrl(d, url) {
    const host = urlHostOf(url);
    if (!host) return null;
    return deskShops(d).find((s) => shopHostOf(s) === host) || null;
  }

  function catLabel(c) {
    return (c && c.name) || "Category";
  }

  function foldCatName(name) {
    return String(name || "").trim().toLocaleLowerCase("tr");
  }

  function categoryNames(d) {
    const seen = new Map();
    for (const s of deskShops(d)) {
      for (const c of s.categories || []) {
        const n = String(c.name || "").trim();
        if (!n) continue;
        const k = foldCatName(n);
        if (!seen.has(k)) seen.set(k, n);
      }
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "tr"));
  }

  function categoryUrlForShop(shop, name) {
    const k = foldCatName(name);
    const hit = shopCategories(shop).find((c) => foldCatName(c.name) === k);
    return hit ? hit.url : "";
  }

  function categoryNameForUrl(d, url) {
    for (const s of deskShops(d)) {
      for (const c of shopCategories(s)) {
        if (c.url === url) return c.name;
      }
    }
    return "";
  }

  function nameOptionsHtml(names, selectedName) {
    const selected = foldCatName(selectedName);
    return '<option value="">Select a category</option>' + (names || []).map((n) =>
      `<option value="${esc(n)}"${foldCatName(n) === selected ? " selected" : ""}>${esc(n)}</option>`
    ).join("");
  }

  function applyRunCategoryUrl(shopId, name) {
    const urlBox = $("#shop-url");
    if (!urlBox) return "";
    const shop = shopById(state.data, shopId);
    if (!shop || !name) {
      if (shop && urlBox.value && urlHostOf(urlBox.value) !== shopHostOf(shop)) urlBox.value = "";
      return urlBox.value;
    }
    urlBox.value = categoryUrlForShop(shop, name) || "";
    return urlBox.value;
  }

  function fillRunCategories(shopId, selectedName) {
    const sel = $("#run-cat");
    if (!sel) return;
    const names = categoryNames(state.data);
    const keep = selectedName || sel.value;
    sel.innerHTML = nameOptionsHtml(names, keep);
    if (keep && names.some((n) => foldCatName(n) === foldCatName(keep))) sel.value = names.find((n) => foldCatName(n) === foldCatName(keep));
    applyRunCategoryUrl(shopId, sel.value);
  }

  function runsHtml(d) {
    const job = activeJob(d);
    const events = job ? (job.events || []).slice(-200) : [];
    const shops = deskShops(d).filter((s) => s.enabled !== false);
    const inferred = job && job.url ? shopForUrl(d, job.url) : null;
    const selectedShop = inferred;
    const selectedName = job && job.url ? categoryNameForUrl(d, job.url) : "";
    const names = categoryNames(d);
    const llmOn = (job && job.autoLlmMatch !== undefined ? job.autoLlmMatch === true : (d.desk && d.desk.autoLlmMatch) === true);
    return `
      <div class="panel">
        <h2>Start a shop run</h2>
        <p class="muted">Category names are shared (Filament, Printers). The URL is unique to the shop you pick — Robolink never crawls Rhino’s link.</p>
        <form class="form-row" id="run-form">
          <div id="run-rows" style="flex:1 0 100%;display:flex;flex-direction:column;gap:8px">
            <div class="run-row" data-row="1" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
              <div class="field"><label for="run-shop">Shop 1</label><select id="run-shop" class="run-shop"><option value="">Choose a shop</option>${shops.map((s) => `<option value="${esc(s.id)}"${selectedShop && selectedShop.id === s.id ? " selected" : ""}>${esc(s.name || s.id)}</option>`).join("")}</select></div>
              <div class="field" style="flex:2"><label for="run-cat">Category</label><select id="run-cat" class="run-cat">${nameOptionsHtml(names, selectedName)}</select></div>
              <div class="field" style="flex:2"><label for="shop-url">Category URL</label><input id="shop-url" class="run-url" type="text" required placeholder="https://www.shop.com/kategori/filament" value="${esc((job && job.url) || "")}"></div>
              <button class="ghost" type="button" id="add-shop-row" title="Queue another shop in the same submit">+ Shop</button>
            </div>
          </div>
          <div class="field"><label for="shop-kind">Kind</label><select id="shop-kind"><option value="both" ${(job && job.kind) === "both" ? "selected" : ""}>Both</option><option value="printer" ${(job && job.kind) === "printer" ? "selected" : ""}>Printers</option><option value="filament" ${(job && job.kind) === "filament" ? "selected" : ""}>Filament</option></select></div>
          <div class="field"><label for="shop-max">Max products</label><input id="shop-max" type="number" min="1" max="400" value="${(job && job.maxProducts) || 200}"></div>
          <label class="muted" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="run-llm" ${llmOn ? "checked" : ""}> AI help on very close matches</label>
          <button class="primary" type="submit" ${job ? "disabled" : ""}>Queue run</button>
          ${job ? `<button class="ghost danger" type="button" id="abort-active">Abort ${job.id}</button><button class="ghost danger" type="button" id="delete-run">Delete run</button>` : ""}
        </form>
        <p class="muted">AI help off (default): Magellan decides and close calls wait for you. No AI server is needed either way. On: one short AI ask, text only, only when Magellan is in the gray band. Hard conflicts (AMS, Combo, mini, laser) are never merged either way.<br>Visual match: on — thumbnails are fingerprinted locally when titles are a close call, and a matching photo is flagged for you to confirm. Vision never merges on its own.</p>
        ${job ? `<p><span class="badge ${job.status}">${esc(job.status)}</span> ${esc(job.progress || "")}</p>` : "<p class='muted'>No active run.</p>"}
        <h3>Live review board</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0">
          <label class="muted" style="font-size:12px">Run
            <select id="review-job-select">
              <option value="">newest with cards</option>
              ${(d.jobs || []).slice(0, 25).map((j) => {
                const cards = Object.keys(j.cards || {}).length;
                const at = String(j.createdAt || "").replace("T", " ").slice(0, 16);
                return `<option value="${esc(j.id)}" ${state.reviewJobId === j.id ? "selected" : ""}>${esc(j.id)} · ${esc(at)} · ${esc(j.status || "")} · ${cards} card${cards === 1 ? "" : "s"}${(j.published || []).length ? " · " + (j.published || []).length + " collected" : ""}</option>`;
              }).join("")}
            </select>
          </label>
          <small class="muted">${state.reviewJobId ? "Showing one run by hand — collected cards included, so its decisions stay editable." : "Gather a shop to fill this board."}</small>
        </div>
        <p class="muted">Cards appear as products are gathered. Select what to publish, flag anything unsure, and choose which catalog product each listing joins — that is who it will be price-compared against.</p>
        ${reviewBoardHtml(reviewJob(d))}
        <h3>Run activity <button class="btn-sm danger" type="button" id="delete-all-runs" style="margin-left:8px">Delete all runs</button></h3>
        <div class="tape">${events.length ? events.map((ev) => `<div><time>${esc(String(ev.at || "").slice(11, 19))}</time>${esc(ev.text || ev.error || JSON.stringify(ev))}</div>`).join("") : '<div class="empty">Waiting for worker events…</div>'}</div>
      </div>
    `;
  }

  function titleFromUrl(url) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
      return last.replace(/[-_]+/g, " ").replace(/\.(html?|php)$/i, "") || url;
    } catch (_) {
      return String(url || "");
    }
  }

  // A chosen run wins, so an older shop run stays usable after Collect emptied the newest one's
  // board. With nothing chosen we keep the old behaviour: the newest run that still has cards.
  function reviewJob(d) {
    const jobs = d.jobs || [];
    if (state.reviewJobId) {
      const chosen = jobs.find((j) => j.id === state.reviewJobId);
      if (chosen) return chosen;
    }
    return activeJob(d)
      || jobs.find((j) => j.cards && Object.keys(j.cards).length)
      || jobs.find((j) => (j.events || []).some((e) => e.card || e.urls || e.url))
      || jobs[0]
      || (d.candidate ? { id: "candidate", events: [], cards: {}, url: "" } : null);
  }

  function collectCards(job, d) {
    const byUrl = new Map();
    // Published cards come back when a specific run is chosen by hand: after Collect the board
    // looked empty, which is exactly when you want to go back and regroup.
    const dropped = new Set([...(job.dropped || []), ...(state.reviewJobId ? [] : (job.published || []))]);
    const rank = (d) => d && (d.action === "merge" || d.action === "updated") ? 2 : d && d.action === "create" ? 1 : 0;
    const add = (url, patch) => {
      if (!url || dropped.has(url)) return;
      const prev = byUrl.get(url) || { card: { url, name: titleFromUrl(url) }, decision: {} };
      const decision = rank(patch.decision) >= rank(prev.decision) ? (patch.decision || prev.decision) : prev.decision;
      byUrl.set(url, {
        ...prev,
        ...patch,
        card: {
        ...prev.card,
        ...(patch.card || {}),
        url,
        image: (patch.card && patch.card.image) || prev.card.image || "",
        name: (patch.card && patch.card.name) || prev.card.name
      },
        decision,
        compared: patch.compared || prev.compared,
        error: patch.error || prev.error
      });
    };
    Object.values(job.cards || {}).forEach((c) => {
      if (c && c.url) add(c.url, { card: c, decision: c.decision, compared: c.compared, error: c.error });
    });
    (job.events || []).forEach((e) => {
      (e.urls || []).forEach((u) => add(u, { card: { name: titleFromUrl(u), url: u } }));
      (e.items || []).forEach((it) => it && it.url && add(it.url, {
        card: { name: it.name || titleFromUrl(it.url), url: it.url, image: it.image || "", kind: it.kind, price: it.price, mismatch: it.mismatch },
        mismatch: it.mismatch || e.mismatch,
        error: it.mismatch ? "category_mismatch" : undefined
      }));
      if (e.card && e.card.url) add(e.card.url, e);
      else if (e.url) add(e.url, { card: { name: e.name || titleFromUrl(e.url), url: e.url }, error: e.error || e.text, mismatch: e.mismatch });
      if (e.type === "mismatch" && (e.items || []).length) {
        e.items.forEach((it) => it && it.url && add(it.url, {
          card: { name: it.name || titleFromUrl(it.url), url: it.url, image: it.image || "", kind: it.kind || (it.mismatch && it.mismatch.detectedType), price: it.price, mismatch: it.mismatch },
          mismatch: it.mismatch,
          error: "category_mismatch"
        }));
      }
    });
    const cand = d && d.candidate;
    if (cand) {
      const jobHost = hostOf(job.url);
      const liveUrls = new Set();
      const liveIds = new Set();
      const live = currentCatalog();
      [...(live.products || []), ...(live.filaments || [])].forEach((p) => {
        if (p.id) liveIds.add(p.id);
        (p.offers || []).forEach((o) => { if (o.url) liveUrls.add(o.url); });
      });
      [...(cand.products || []), ...(cand.filaments || [])].forEach((p) => {
        (p.offers || []).forEach((o) => {
          if (!o.url) return;
          if (liveUrls.has(o.url) && !byUrl.has(o.url) && hostOf(o.url) !== jobHost) return;
          if (liveUrls.has(o.url) && !byUrl.has(o.url) && !jobHost) return;
          add(o.url, {
            card: {
              name: p.name, brand: p.brand, kind: p.kind, price: o.price, url: o.url,
              image: o.image || p.image, polymer: p.polymer, variant: p.variant, color: p.color,
              weight: p.weight, diameter: p.diameter, packaging: p.packaging
            },
            // Merge or new comes from the row it landed on, not from the offer URL being new.
            decision: { action: liveIds.has(p.id) ? "merge" : "create", candidateId: p.id, candidateName: p.name, shelf: p.kind }
          });
        });
      });
    }
    return [...byUrl.values()];
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
  }

  function catalogProduct(id) {
    if (!id || !state.data) return null;
    const bags = [state.data.candidate, currentCatalog()];
    for (const bag of bags) {
      if (!bag) continue;
      const hit = [...(bag.products || []), ...(bag.filaments || [])].find((p) => p.id === id);
      if (hit) return hit;
    }
    return null;
  }

  function placementOptions(card, decision, query) {
    const live = currentCatalog();
    const cand = state.data && state.data.candidate;
    const q = String(query || "").trim().toLowerCase();
    const shelves = q || !card.kind
      ? ["products", "filaments"]
      : [card.kind === "filament" ? "filaments" : "products"];
    const seen = new Set();
    const list = [];
    for (const shelf of shelves) {
      for (const p of [...(live[shelf] || []), ...((cand && cand[shelf]) || [])]) {
        if (!p || !p.id || seen.has(p.id)) continue;
        seen.add(p.id);
        list.push(p);
      }
    }
    const brand = String(card.brand || "").toLowerCase();
    let hits = list.filter((p) => {
      if ((p.offers || []).length === 1 && p.offers[0].url === card.url) return false;
      if (q) {
        return [p.id, p.name, p.brand, p.color, p.polymer, p.variant].filter(Boolean).join(" ").toLowerCase().includes(q);
      }
      if (brand && String(p.brand || "").toLowerCase() !== brand) return false;
      return true;
    });
    if (decision.candidateId) {
      const picked = catalogProduct(decision.candidateId);
      if (picked && !hits.some((h) => h.id === picked.id)) hits.unshift(picked);
    }
    hits.sort((a, b) => (a.id === decision.candidateId ? -1 : b.id === decision.candidateId ? 1 : 0));
    return hits.slice(0, q ? 50 : 25);
  }

  function workerPlace(e) {
    const d = (e && e.decision) || {};
    if ((d.action === "merge" || d.action === "updated") && d.candidateId) {
      return { action: "merge", candidateId: d.candidateId };
    }
    return { action: "create", candidateId: d.candidateId || "" };
  }

  function defaultPlace(e) {
    const url = e.card && e.card.url;
    if (url && state.reviewPlace.has(url)) return state.reviewPlace.get(url);
    return workerPlace(e);
  }

  function placeValue(place) {
    return place.action === "merge" && place.candidateId ? "merge:" + place.candidateId : "create";
  }

  function placeOptionsHtml(e, place, query) {
    const c = e.card || {};
    const url = c.url || "";
    const dec = e.decision || {};
    const options = placementOptions(c, dec, query);
    if (place.action === "merge" && place.candidateId && !options.some((p) => p.id === place.candidateId)) {
      const extra = catalogProduct(place.candidateId);
      if (extra) options.unshift(extra);
    }
    const selected = placeValue(place);
    return [`<option value="create"${selected === "create" ? " selected" : ""}>New product — not compared yet</option>`]
      .concat(options.map((p) => {
        const stores = [...new Set(otherOffers(p, url).map((o) => o.store))];
        const label = p.name + (stores.length ? " — vs " + stores.join(", ") : " — no other shops yet");
        const val = "merge:" + p.id;
        return `<option value="${esc(val)}"${selected === val ? " selected" : ""}>${esc(label)}</option>`;
      })).join("");
  }

  function cardEvent(url) {
    const job = reviewJob(state.data || { jobs: [] });
    if (!job) return { card: { url }, decision: {}, compared: [] };
    return collectCards(job, state.data).find((x) => x.card && x.card.url === url) || { card: { url }, decision: {}, compared: [] };
  }

  function applyPlace(wrap, url, place) {
    state.reviewPlace.set(url, place);
    const ev = cardEvent(url);
    const sel = wrap && wrap.querySelector("[data-review-place]");
    if (sel) {
      sel.innerHTML = placeOptionsHtml(ev, place, "");
      sel.value = placeValue(place);
    }
    const line = wrap && wrap.querySelector(".review-compare");
    if (line) line.textContent = compareText(ev, place);
    const hits = wrap && wrap.querySelector(".place-hits");
    if (hits) { hits.hidden = true; hits.innerHTML = ""; }
    const q = wrap && wrap.querySelector("[data-review-place-q]");
    if (q) q.value = "";
  }

  function fillPlaceHits(wrap, url, query) {
    const box = wrap && wrap.querySelector(".place-hits");
    if (!box) return;
    const q = String(query || "").trim();
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const ev = cardEvent(url);
    const hits = placementOptions(ev.card || { url, kind: ev.card && ev.card.kind }, ev.decision || {}, q);
    const id = encodeURIComponent(url);
    const btns = [`<button type="button" class="place-hit" data-place-pick="${esc(id)}" data-place-val="create">New product — not compared yet</button>`]
      .concat(hits.map((p) => {
        const stores = [...new Set(otherOffers(p, url).map((o) => o.store))];
        return `<button type="button" class="place-hit" data-place-pick="${esc(id)}" data-place-val="merge:${esc(p.id)}">${esc(p.name || p.id)}${stores.length ? ` <small>${esc(stores.join(" · "))}</small>` : ""}</button>`;
      }));
    box.hidden = false;
    box.innerHTML = btns.join("") || '<span class="muted">No catalog match</span>';
  }

  function otherOffers(product, skipUrl) {
    const skip = hostOf(skipUrl);
    return (product && product.offers || []).filter((o) => {
      if (!o.store) return false;
      if (skip && hostOf(o.url) === skip) return false;
      return true;
    });
  }

  function compareText(e, place) {
    const url = e.card.url;
    if (place.action === "merge" && place.candidateId) {
      const target = catalogProduct(place.candidateId);
      const stores = otherOffers(target, url);
      if (stores.length) {
        return "Compared with " + stores.map((o) => o.store + (o.price != null ? " " + o.price + " TL" : "")).join(" · ");
      }
    }
    const fromWorker = (e.compared || []).filter((c) => c.store && hostOf(c.url) !== hostOf(url));
    if (fromWorker.length) {
      const prefix = place.action === "merge" ? "Compared with " : "No other shops yet. Similar: ";
      return prefix + fromWorker.map((c) => (c.name ? c.name + " @ " : "") + c.store + (c.price != null ? " " + c.price + " TL" : "")).join(" · ");
    }
    return place.action === "merge"
      ? "On the catalog, but no other shop offers yet."
      : "New product — no other shops to compare yet.";
  }

  function reviewBoardHtml(job) {
    if (!job) return '<p class="muted">No product cards yet. Queue a run — cards appear as soon as listing pages are harvested.</p>';
    const cards = collectCards(job, state.data);
    if (!cards.length) return '<p class="muted">No product cards yet. Queue a run with the local worker online — harvested product URLs show up here immediately.</p>';
    const selected = state.reviewSelected.size;
    // Cards the deterministic pass could not place: no merge, no new row, no update.
    const unmatched = cards.filter((e) => {
      const a = e.decision && e.decision.action;
      return !!(e.card && e.card.url) && a !== "merge" && a !== "updated" && a !== "create";
    }).length;
    return `
      <div class="review-toolbar">
        <button class="btn-sm" type="button" id="select-all">Select all</button>
        <button class="btn-sm" type="button" id="flag-all">Flag all</button>
        <button class="btn-sm ghost" type="button" id="clear-review">Clear selection</button>
        <button class="btn-sm ghost" type="button" id="clear-flags">Clear flags</button>
        <button class="btn-sm danger" type="button" id="delete-flagged" ${state.reviewFlags.size ? "" : "disabled"}>Delete flagged (${state.reviewFlags.size})</button>
        <button class="btn-sm ok" type="button" id="publish-selected" ${selected ? "" : "disabled"}>Publish selected (${selected})</button>
        <span class="muted">${cards.length} gathered</span>
      </div>
      <div class="review-toolbar">
        <span class="muted">Aggressive AI help — for what the matcher could not sort. It may only choose an identity from the current catalog (or say "new"/"hold"), and it can never override a hard split:</span>
        <button class="btn-sm" type="button" id="gemma-unmatched" ${unmatched ? "" : "disabled"}>Ask AI: all unmatched (${unmatched})</button>
        <button class="btn-sm" type="button" id="gemma-selected" ${selected ? "" : "disabled"}>Ask AI: selected (${selected})</button>
      </div>
      <div class="review-board" id="review-board">
        ${cards.map((e) => {
          const c = e.card || {};
          const url = c.url || "";
          const dec = e.decision || {};
          const id = encodeURIComponent(url);
          const place = defaultPlace(e);
          const isSel = state.reviewSelected.has(url);
          const isFlag = state.reviewFlags.has(url);
          const mismatch = e.mismatch || c.mismatch;
          const detected = mismatch && (mismatch.detectedType || mismatch.detected);
          const declared = mismatch && (mismatch.declaredType || mismatch.declared);
          const where = mismatch
            ? "⚠ category mismatch — detected: " + (detected || "other") + ", declared: " + (declared || "printer")
            : e.error ? "Held: " + String(e.error).slice(0, 160)
            : dec.action === "merge" ? "Worker match: merge → " + (dec.candidateName || dec.candidateId)
            : dec.action === "updated" ? "Worker match: update → " + (dec.candidateName || "existing")
            : dec.action === "create" ? "Worker match: new " + (dec.shelf || c.kind || "product")
            : dec.action === "held" || dec.action === "hold" ? "Worker match: held — " + String(dec.reason || (dec.candidateName && "compared with " + dec.candidateName) || "needs a look").slice(0, 120)
            : "gathered — waiting for match";
          const visualNote = typeof dec.visual === "number" ? " · visual " + dec.visual.toFixed(2) : "";
          const pathNote = dec.matchPath === "gemma-catalog-guided" ? " · AI (catalog-guided)" + (dec.identityId ? " · " + dec.identityId : "") + (dec.rejected ? " · rejected: " + dec.rejected : "")
            : dec.matchPath === "gemma-gray" ? " · AI-gray"
            : dec.nearDupe ? (dec.photoMatch ? " · near duplicate — same thumbnail, confirm" : " · near duplicate — review") + visualNote
            : dec.matchPath === "magellan+visual" ? " · Magellan + visual" + visualNote
            : (dec.matchPath === "magellan" || dec.rule === "magellan") ? " · Magellan" : "";
          const mismatchActions = mismatch ? `<div class="mismatch-actions">
              <button type="button" class="btn-sm" data-mismatch-create="${esc(id)}" data-detected="${esc(detected || "other")}">Create new category: ${esc((detected || "other").charAt(0).toUpperCase() + (detected || "other").slice(1))}</button>
              <button type="button" class="btn-sm danger" data-mismatch-discard="${esc(id)}">Discard</button>
            </div>` : "";
          return `<article class="review-card${isSel ? " is-selected" : ""}${isFlag ? " flagged" : ""}${mismatch ? " is-mismatch" : ""}">
            <div class="review-top">
              <label><input type="checkbox" data-review-select="${esc(id)}" ${isSel ? "checked" : ""}> Select</label>
              <label><input type="checkbox" data-review-flag="${esc(id)}" ${isFlag ? "checked" : ""}> Flag</label>
            </div>
            <div class="review-mid">
              ${productImg(c.image)}
              <span class="review-main">
                <strong>${esc(c.name || url)}</strong>
                <small>${esc([c.brand, c.kind, c.color, c.weight, c.polymer ? "polymer " + c.polymer : ""].filter(Boolean).join(" · ") || url)}</small>
                <small class="muted">${esc(where + pathNote)}</small>
                ${c.price ? `<b>${esc(String(c.price))} TL</b>` : ""}
                ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">open ↗</a>` : ""}
              </span>
            </div>
            <div class="review-place-label">Goes to
              <input type="search" data-review-place-q="${esc(id)}" placeholder="Search catalog…" autocomplete="off" aria-label="Search where ${esc(c.name || "this product")} goes">
              <div class="place-hits" hidden></div>
              <select data-review-place="${esc(id)}" aria-label="Where ${esc(c.name || "this product")} goes">${placeOptionsHtml(e, place, "")}</select>
              <button type="button" class="btn-sm ghost" data-restore-place="${esc(id)}">Restore default</button>
            </div>
            <p class="review-compare">${esc(mismatch ? where : compareText(e, place))}</p>
            ${mismatchActions}
          </article>`;
        }).join("")}
      </div>
    `;
  }

  function rerenderRuns() {
    const d = state.data;
    if (!d || state.tab !== "runs") return;
    const url = $("#shop-url") ? $("#shop-url").value : "";
    const kind = $("#shop-kind") ? $("#shop-kind").value : "";
    const max = $("#shop-max") ? $("#shop-max").value : "";
    const cat = $("#run-cat") ? $("#run-cat").value : "";
    const shop = $("#run-shop") ? $("#run-shop").value : "";
    const llm = $("#run-llm") ? $("#run-llm").checked : undefined;
    $("#tab-runs").innerHTML = runsHtml(d);
    if ($("#shop-url")) { $("#shop-url").value = url; $("#shop-kind").value = kind; $("#shop-max").value = max; }
    if ($("#run-llm") && llm !== undefined) $("#run-llm").checked = llm;
    if ($("#run-shop") && shop) $("#run-shop").value = shop;
    fillRunCategories(shop || $("#run-shop")?.value, cat);
  }

  function updateReviewToolbar() {
    const pub = $("#publish-selected");
    if (pub) {
      const n = state.reviewSelected.size;
      pub.disabled = !n;
      pub.textContent = "Publish selected (" + n + ")";
    }
    const del = $("#delete-flagged");
    if (del) {
      const n = state.reviewFlags.size;
      del.disabled = !n;
      del.textContent = "Delete flagged (" + n + ")";
    }
  }

  // Stock ages: the sweep re-reads the product pages we already link to and pulls vendors
  // that ran out out of the comparison. Oldest checks first, so pressing again continues.
  function stockPanelHtml(d) {
    const offers = allProducts().flatMap((p) => (p.offers || []).map((o) => ({ ...o, product: p })));
    const withUrl = offers.filter((o) => /^https?:\/\//i.test(o.url || ""));
    const now = Date.now();
    const stale = withUrl.filter((o) => {
      const at = Date.parse(o.stockCheckedAt || "");
      return !Number.isFinite(at) || (now - at) / 36e5 >= 6;
    }).length;
    const dead = withUrl.filter((o) => o.stockStatus === "out_of_stock").length;
    const unknown = withUrl.filter((o) => !o.stockStatus || o.stockStatus === "unknown").length;
    return `<div class="panel">
        <h2>Stock</h2>
        <p class="muted">Re-reads the product pages we link to and leaves out vendors that are out of stock. ${withUrl.length} offers: ${dead} out of stock, ${unknown} unverified, ${stale} older than 6h.</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn-sm primary" type="button" id="check-stock">Check stock now (${stale} stale)</button>
          <button class="btn-sm ghost" type="button" id="check-stock-all">Check every offer (${withUrl.length})</button>
          <small class="muted" id="stock-result"></small>
        </div>
      </div>`;
  }

  function catalogHtml(d) {
    const products = filteredProducts();
    const savedAt = d.catalog && d.catalog.savedAt ? new Date(d.catalog.savedAt).toLocaleString() : "never";
    return `
      ${stockPanelHtml(d)}
      <div class="panel">
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;align-items:center">
          <h2 style="margin:0">Saved catalog</h2>
          <span class="muted">Last saved: ${esc(savedAt)}</span>
          <button class="btn-sm ghost" type="button" id="select-all-catalog">Select all</button>
          <button class="btn-sm" type="button" id="merge-selected-catalog" ${state.catalogSelected.size > 1 ? "" : "disabled"}>Merge selected (${state.catalogSelected.size})…</button>
          <button class="btn-sm ghost" type="button" id="find-duplicates">Find duplicate groups</button>
          ${state.catalogUndo ? `<button class="btn-sm ghost" type="button" id="undo-merge">Undo last merge</button>` : ""}
          <button class="btn-sm danger" type="button" id="delete-selected-catalog" ${state.catalogSelected.size ? "" : "disabled"}>Delete selected (${state.catalogSelected.size})</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0">
          <label class="muted" style="font-size:12px">Shop
            <select id="catalog-shop"><option value="">all shops</option>${[...new Set(allProducts().flatMap((p) => (p.offers || []).map((o) => o.store)).filter(Boolean))].sort().map((x) => `<option value="${esc(x)}" ${state.catalogShop === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
          </label>
          <label class="muted" style="font-size:12px">Variant
            <select id="catalog-variant">
              <option value="">any</option>
              <option value="bare" ${state.catalogVariant === "bare" ? "selected" : ""}>Bare (no combo/AMS)</option>
              <option value="combo" ${state.catalogVariant === "combo" ? "selected" : ""}>Combo</option>
              <option value="ams2" ${state.catalogVariant === "ams2" ? "selected" : ""}>AMS 2 Pro</option>
              <option value="mini" ${state.catalogVariant === "mini" ? "selected" : ""}>Mini</option>
              <option value="laser" ${state.catalogVariant === "laser" ? "selected" : ""}>Laser</option>
            </select>
          </label>
          <label class="muted" style="font-size:12px;display:flex;gap:6px;align-items:center"><input type="checkbox" id="dupes-only" ${state.dupesOnly ? "checked" : ""}> Duplicates only${state.dupes ? ` (${state.dupes.clusters.length} groups)` : " — press Find duplicate groups first"}</label>
        </div>
        <p class="muted">Edits here are saved to the online catalog and take effect immediately on the storefront.</p>
        ${backupsPanel()}
        <details class="danger-zone" ${detailAttrs("danger")}><summary>Danger zone</summary>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <button class="btn-sm danger" type="button" id="delete-all-catalog">Delete every catalog product</button>
            <button class="btn-sm danger" type="button" id="collapse-duplicates">Merge exact-title duplicates (all at once)</button>
            <button class="btn-sm danger" type="button" id="dedupe-offer-urls" ${(state.data && state.data.duplicateOffers || []).length ? "" : "disabled"}>Fix one listing in two products (${(state.data && state.data.duplicateOffers || []).length})</button>
            <small class="muted">The third one keeps a store's listing on a single product, so the same shop is never compared twice.</small>
            <small class="muted">The second one merges rows whose titles are identical after folding — it never merges Bare with Combo, Mini or a laser variant.</small>
          </div>
        </details>
        <div class="search"><input id="catalog-search" aria-label="Search catalog" type="search" placeholder="Search name, brand, color, polymer…" value="${esc(state.catalogQuery)}"><span class="muted" id="catalog-count">${products.length} shown</span>
          <button class="btn-sm ghost" type="button" id="catalog-refresh">Refresh live data</button>
        </div>
        <datalist id="catalog-targets">${allProducts().map((x) => `<option value="${esc(x.name || x.id)}"></option>`).join("")}</datalist>
        ${mergeBarHtml()}
        ${dupesPanelHtml()}
        <div class="catalog-results" id="catalog-results">${products.map(productCard).join("") || '<div class="empty">No products found.</div>'}</div>
        <button class="ghost" id="catalog-more" style="margin-top:20px" ${products.length < state.catalogLimit ? "hidden" : ""}>Show more products</button>
      </div>
    `;
  }

  // Grouping is the job here: pick the keeper explicitly, then merge.
  function mergeBarHtml() {
    const picked = allProducts().filter((p) => state.catalogSelected.has(p.id));
    if (picked.length < 2) return "";
    const keeper = picked.find((p) => p.id === state.keeperId) || picked[0];
    return `<div class="panel merge-bar">
      <h3 style="margin-top:0">Merge ${picked.length} products into one keeper</h3>
      <p class="muted">Offers are combined onto the keeper and the other rows disappear. Undo last merge puts it back.</p>
      <ul class="keeper-list">${picked.map((p) => `<li>
        <label><input type="radio" name="keeper" data-keeper="${esc(p.id)}" ${p.id === keeper.id ? "checked" : ""}> <strong>${esc(p.name || p.id)}</strong>
        <span class="muted">${(p.offers || []).length} offers · ${esc(p.id)}${p.axes ? " · " + esc(p.axes.label) : ""}</span></label>
      </li>`).join("")}</ul>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <button class="btn-sm" type="button" id="merge-selected-go">Merge into ${esc(keeper.name || keeper.id)}</button>
        <button class="btn-sm ghost" type="button" id="merge-cancel">Cancel</button>
        <small class="muted" id="merge-result"></small>
      </div>
    </div>`;
  }

  // The duplicates inbox: proposed groups with a keeper, and the pairs that look alike but
  // differ on a hard axis, which can never be merged here.
  function dupesPanelHtml() {
    const d = state.dupes;
    if (!d) return "";
    const clusters = d.clusters || [];
    if (!clusters.length && !(d.blocked || []).length) return '<div class="panel"><p class="muted">No duplicate groups found.</p></div>';
    return `<div class="panel dupes-panel">
      <h3 style="margin-top:0">Duplicates inbox</h3>
      <p class="muted">${clusters.length} group${clusters.length === 1 ? "" : "s"} of rows that are the same product by title. Suggested keeper first. Pairs that look alike but differ on Combo / Mini / laser / variant are listed as blocked.</p>
      ${clusters.map((c) => `<div class="dupe-cluster">
        <div class="dupe-head">
          <strong>${esc(c.name || c.key)}</strong>
          <span class="badge">${c.rows.length} rows</span>
          <span class="muted">${c.exact ? "exact title" : "near-duplicate"} · keep ${esc(c.keeperId)}</span>
          <button class="btn-sm" type="button" data-merge-cluster="${esc(c.key)}">Merge this group</button>
        </div>
        <ul>${c.rows.map((r) => `<li><span class="muted">${esc(r.id)}</span> ${esc(r.name || "")} — ${r.offers} offers${r.axes ? " · " + esc(r.axes.label) : ""}${r.stores && r.stores.length ? " · " + esc(r.stores.join(", ")) : ""}${r.id === c.keeperId ? ' <span class="badge">keeper</span>' : ""}</li>`).join("")}</ul>
      </div>`).join("")}
      ${(d.blocked || []).length ? `<details ${detailAttrs("blocked")}><summary>${d.blocked.length} pairs look alike but must not merge</summary><ul>${d.blocked.map((b) => `<li>${esc(b.a.name || b.a.id)} ↔ ${esc(b.b.name || b.b.id)} <span class="muted">(${esc(b.conflicts.join(", "))})</span></li>`).join("")}</ul></details>` : ""}
    </div>`;
  }

  // "possible duplicate of …" straight from the inbox, so the row itself says why.
  function dupeHint(p) {
    const d = state.dupes;
    if (!d) return "";
    const hit = (d.clusters || []).find((c) => (c.rows || []).some((r) => r.id === p.id));
    if (!hit) return "";
    const others = hit.rows.filter((r) => r.id !== p.id).map((r) => r.name || r.id);
    return others.length ? `<span class="dupe-hint" title="same product by title">possible duplicate of ${esc(others.slice(0, 2).join(" / "))}${others.length > 2 ? " +" + (others.length - 2) : ""}</span>` : "";
  }

  function productCard(p) {
    const edit = state.editing.get(p.id) || { ...p, shelf: p.shelf };
    const common = (k) => esc(edit[k] ?? p[k] ?? "");
    const on = state.catalogSelected.has(p.id);
    return `<div class="product-card${on ? " is-selected" : ""}" data-product-id="${esc(p.id)}">
      <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><input type="checkbox" data-catalog-select="${esc(p.id)}" ${on ? "checked" : ""}> Select</label>
      ${p.image ? productImg(p.image) : '<div style="height:110px;background:#e8ebef;border-radius:8px"></div>'}
      <div class="name">${esc(p.name || p.title || p.id)}</div>
      <div class="meta">
        ${p.axes ? `<span class="axis-badge${p.axes.combo ? " is-combo" : " is-bare"}">${esc(p.axes.label || (p.axes.combo ? "Combo" : "Bare"))}</span>` : ""}
        <span class="muted">${esc([p.brand, p.shelf === "filament" ? p.polymer : p.aisle, p.unit].filter(Boolean).join(" · "))} · ${(p.offers || []).length} offers</span>
        <span class="muted" title="product id">${esc(p.id)}</span>
        ${dupeHint(p)}
      </div>
      <input aria-label="Product name" data-field="name" value="${common("name")}" placeholder="Name">
      <div style="display:flex;gap:6px">
        <input style="flex:1" aria-label="Product brand" data-field="brand" value="${common("brand")}" placeholder="Brand">
        <input style="flex:1" aria-label="Product color" data-field="color" value="${common("color")}" placeholder="Color">
      </div>
      ${p.shelf === "filament" ? `<div style="display:flex;gap:6px"><select aria-label="Product polymer" data-field="polymer">${["pla", "petg", "abs", "asa", "tpu", "pc", "pa", "pet", "plabs", "other"].map((x) => `<option ${(edit.polymer || p.polymer) === x ? "selected" : ""}>${x}</option>`).join("")}</select><select aria-label="Product variant" data-field="variant">${["standard", "plus", "rapid", "silk", "matte", "cf", "gf", "wood", "glow", "marble", "rainbow", "combo", "basic", "pure"].map((x) => `<option ${(edit.variant || p.variant) === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>` : `<input aria-label="Product aisle" data-field="aisle" value="${common("aisle")}" placeholder="Aisle">`}
      ${offersPanel(p)}
      <div class="actions"><button class="btn-sm" data-save-product="${esc(p.id)}">Save</button><button class="btn-sm ghost" data-reset-product="${esc(p.id)}">Reset</button></div>
    </div>`;
  }

  // Where every offer on this row actually came from, and the two ways out of a wrong group:
  // move it onto another product, or branch it out as a product of its own.
  function offersPanel(p) {
    const offers = p.offers || [];
    if (!offers.length) return "";
    const rows = offers.map((o, i) => {
      const slug = String(o.url || "").split("/").pop() || "";
      return `<li class="offer-src" data-offer-url="${esc(o.url)}">
        <div class="offer-src-head">
          <strong>${esc(o.store || "?")}</strong>
          <span class="muted">${esc(o.price != null ? String(o.price) : "")}</span>
          ${/^https?:\/\//i.test(o.url || "") ? `<a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">source ↗</a>` : ""}
          <span class="muted">${esc(o.stockStatus || "stock ?")}</span>
          ${o.priceSuspect ? `<span class="badge failed" title="the number on the page looked wrong, so this price is not trusted">price suspect: ${esc(o.priceSuspect)}</span>` : ""}
        </div>
        <div class="muted" title="scraped title">scraped: ${esc(o.sourceTitle || "(not recorded yet — re-run the shop)")}</div>
        <div class="muted" title="worker title">worker: ${esc(p.name || p.id)}</div>
        <div class="muted" title="url slug">${esc(slug)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input list="catalog-targets" data-offer-move-q="${esc(o.url)}" placeholder="Move to product…" style="flex:1;min-width:140px">
          <button class="btn-sm" type="button" data-offer-move="${esc(o.url)}" data-offer-from="${esc(p.id)}" data-offer-name="${esc(p.name || "")}">Move</button>
          <button class="btn-sm ghost" type="button" data-offer-branch="${esc(o.url)}" data-offer-from="${esc(p.id)}" title="Split this offer into a product of its own, named from the scraped title">Branch as own product</button>
        </div>
      </li>`;
    }).join("");
    return `<details class="offer-src-box" ${detailAttrs("offers:" + p.id)}>
      <summary>${offers.length} offer${offers.length === 1 ? "" : "s"} — source, scraped title, worker title</summary>
      <ul class="offer-src-list">${rows}</ul>
    </details>`;
  }

  function shopsHtml(d) {
    const desk = d.desk || { shops: [] };
    return `
      <div class="panel">
        <h2>Shops</h2>
        <p class="muted">Create a category name once (Filament). It shows in every shop’s dropdown and on Shop runs. Each shop still gets its own unique URL.</p>
        <div class="shop-grid" id="shop-list">${(desk.shops || []).map((s) => {
          const mine = shopCategories(s);
          const names = categoryNames(d);
          return `<article class="shop-card">
            <div class="shop-card-head">
              <div>
                <strong>${esc(s.name || s.id)}</strong>
                <small class="muted">${esc(s.url || "")}</small>
              </div>
              <button class="btn-sm ghost" data-toggle-shop="${esc(s.id)}" data-enabled="${s.enabled !== false}">${s.enabled === false ? "Enable" : "Disable"}</button>
            </div>
            <label class="muted" style="font-size:12px">KDV
              <select data-shop-vat="${esc(s.id)}" aria-label="KDV for ${esc(s.name || s.id)}">
                <option value="included" ${s.vat !== "excluded" ? "selected" : ""}>Prices include KDV %20</option>
                <option value="excluded" ${s.vat === "excluded" ? "selected" : ""}>Prices exclude KDV (we add %20)</option>
              </select>
            </label>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0">
              <button class="btn-sm primary" type="button" data-update-shop-prices="${esc(s.id)}" title="Re-price every offer this shop already has in the catalog, using the KDV setting above. Safe to press more than once.">Save &amp; update prices</button>
              <small class="muted">${s.vat === "excluded" ? "will add KDV %20 to this shop’s stored prices" : "stored prices already include KDV"}</small>
            </div>
            <label class="muted" style="font-size:12px">Select category
              <select data-shop-cat-name="${esc(s.id)}" aria-label="Category names for ${esc(s.name || s.id)}">${nameOptionsHtml(names, "")}</select>
            </label>
            <ul class="shop-cats">${mine.map((c) => `<li><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.url || "")}</small></span><button class="btn-sm danger" type="button" data-delete-shop-cat="${esc(c.id || c.url)}" data-shop="${esc(s.id)}">Delete</button></li>`).join("") || '<li class="muted">No categories on this shop yet.</li>'}</ul>
            <form class="form-row add-shop-cat" data-add-shop-cat="${esc(s.id)}">
              <div class="field"><label>Category name</label><input name="name" type="text" required placeholder="Filament"></div>
              <div class="field" style="flex:2"><label>Category URL</label><input name="url" type="url" required placeholder="https://this-shop.com/filament"></div>
              <button class="btn-sm" type="submit">Add category</button>
            </form>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px">
              <button class="btn-sm danger" type="button" data-purge-shop="${esc(s.id)}" data-purge-runs="0">Delete this shop’s products + categories</button>
              <button class="btn-sm danger" type="button" data-purge-shop="${esc(s.id)}" data-purge-runs="1">…and its runs</button>
            </div>
          </article>`;
        }).join("") || '<p class="muted">No shops yet. Add a name and URL below.</p>'}
        </div>
        <form class="form-row" id="add-shop-form" style="margin-top:16px">
          <div class="field"><label for="new-shop-name">Shop name</label><input id="new-shop-name" type="text" required placeholder="Robolink"></div>
          <div class="field" style="flex:2"><label for="new-shop-url">Shop URL</label><input id="new-shop-url" type="url" required placeholder="https://www.robolinkmarket.com"></div>
          <div class="field"><label for="new-shop-vat">KDV</label><select id="new-shop-vat"><option value="included">Prices include KDV %20</option><option value="excluded">Prices exclude KDV (we add %20)</option></select></div>
          <button class="primary" type="submit">Add shop</button>
        </form>
      </div>
    `;
  }

  function merchHtml(d) {
    const desk = d.desk || { banners: [], promoted: [] };
    state.bannersDraft = state.bannersDraft || JSON.parse(JSON.stringify(desk.banners || []));
    return `
      <div class="panel">
        <h2>Banners</h2>
        <div id="banner-list">${(state.bannersDraft || []).map((b, i) => `
          <div class="banner-card">
            <input aria-label="Banner kicker" data-banner="${i}" data-k="kicker" value="${esc(b.kicker || "")}" placeholder="Kicker">
            <input aria-label="Banner title" data-banner="${i}" data-k="title" value="${esc(b.title || "")}" placeholder="Title">
            <input aria-label="Banner subtitle" data-banner="${i}" data-k="subtitle" value="${esc(b.subtitle || "")}" placeholder="Subtitle">
            <input aria-label="Banner href" data-banner="${i}" data-k="href" value="${esc(b.href || "")}" placeholder="Live link https://…">
            <input aria-label="Banner image" data-banner="${i}" data-k="image" value="${esc(b.image || "")}" placeholder="Image path">
            <label style="display:flex;align-items:center;gap:6px;margin-top:6px"><input type="checkbox" data-banner="${i}" data-k="enabled" ${b.enabled !== false ? "checked" : ""}> Enabled</label>
          </div>`).join("") || '<div class="muted">No banners yet.</div>'}
        </div><div style="display:flex;gap:8px;margin-top:10px"><button class="primary" id="save-banners">Save banners</button><button class="ghost" id="add-banner">Add banner</button></div>
      </div>
      <div class="panel">
        <h2>Paid and promoted pins</h2>
        <div class="search"><input id="pin-search" aria-label="Find a product to pin" type="search" placeholder="Find a catalog product to pin"><button class="btn-sm" id="pin-pick" disabled>Pick</button></div>
        <div id="pin-hits" style="margin-bottom:10px"></div>
        <form class="form-row" id="pin-form"><div class="field"><label for="pin-query">Related search query</label><input id="pin-query" placeholder="e.g. bambu a1"></div><div class="field"><label for="pin-slot">Slot</label><select id="pin-slot"><option value="paid">Paid</option><option value="promoted">Promoted</option></select></div><button class="primary" type="submit">Add pin</button></form>
        <ul class="row-list">${(desk.promoted || []).map((p) => `<li><span><strong>${esc(p.slot)}</strong> — ${esc(p.productId)}<br><small class="muted">${esc(p.query || "")}</small></span><button class="btn-sm danger" data-unpin="${esc(p.id)}">Remove</button></li>`).join("") || '<li class="muted">No pins.</li>'}</ul>
      </div>
    `;
  }

  function aiStatusHtml(d) {
    const hb = d.heartbeat;
    const live = state.workerLive;
    const online = heartbeatFresh(d) || !!(live && live.ok);
    const c = (live && live.ok && live.connection) || (hb && hb.connection) || null;
    const model = (live && live.ok && live.model) || (hb && hb.model) || "";
    if (!online) {
      const where = (live && live.workerUrl) || "http://127.0.0.1:8788";
      const err = live && live.error ? " Could not reach " + esc(where) + " (" + esc(live.error) + ")." : "";
      return '<p class="muted">Local worker offline. Start <code>node worker/online-worker.cjs</code> on this PC. It finds LM Studio (1234/1235) and Ollama (11434) by itself.' + err + ' If the browser asks to allow local network / loopback access, choose Allow.</p>';
    }
    if (c && c.error) return '<p><span class="badge complete">worker online</span></p><p class="error">' + esc(c.error) + '</p><p class="muted">Load a chat model, then click Detect.</p>';
    if (!model) return '<p><span class="badge complete">worker online</span></p><p class="muted">Worker reached. Click Detect — it scans ports 1234, 1235 and 11434 on this PC.</p>';
    const where = c && c.modelUrl ? ' at ' + esc(c.modelUrl) : '';
    return '<p><span class="badge complete">' + (c && c.loadedVerified ? 'Loaded model detected' : 'Available model detected') + '</span></p><h3>' + esc(model) + '</h3><p class="muted">' + (c && c.loadedVerified ? 'Found' + where + ' and will be used automatically.' : 'This server lists models but does not report which are in memory.') + '</p>' + (c && c.models && c.models.length > 1 ? '<p class="muted">Multiple chat models found. Using the first reported model. Models: ' + c.models.map(esc).join(', ') + '</p>' : '');
  }

  function aiHtml(d) {
    const desk = d.desk || {};
    const shown = (state.workerLive && state.workerLive.connection && state.workerLive.connection.modelUrl) || desk.modelUrl || "";
    return '<div class="panel"><h2>Local AI server</h2><p class="muted">The worker on this PC scans LM Studio (ports 1234 and 1235) and Ollama (11434). Paste a URL only if you use a different address.</p><form id="ai-form" class="form-row" novalidate><div class="field"><label for="ai-url">AI server URL (optional)</label><input id="ai-url" type="text" inputmode="url" autocomplete="off" placeholder="auto-detect" value="' + esc(shown) + '"><small class="muted">Leave blank and click Detect.</small></div><button type="button" class="ghost" id="ai-detect">Detect</button><button type="submit" class="primary">Save &amp; connect</button></form><label class="muted" style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="auto-llm-match" ' + (desk.autoLlmMatch === true ? "checked" : "") + '> Auto AI match (extreme uncertainty only)</label><p class="muted">Off (default): Magellan only; gray titles wait for you. On: one short AI ask only when Magellan is in the extreme gray band. Never for stock, VAT, or price.</p></div><div class="panel"><h2>Connection status</h2><div id="ai-status" role="status">' + aiStatusHtml(d) + '</div></div>';
  }

  function jobsHtml(d) {
    const jobs = d.jobs || [];
    return `<div class="panel"><h2>Jobs</h2>${jobs.length ? `<div class="tape" style="max-height:none">${jobs.map((j) => `
      <div style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px;margin:6px 0">
        <b>${esc(j.type)}</b> <span class="badge ${esc(j.status)}">${esc(j.status)}</span> ${esc(j.progress || "")}<br>
        <span style="color:#8aa">${esc(j.url || "")} · ${new Date(j.createdAt || Date.now()).toLocaleString()}</span>
        ${j.error ? `<div style="color:#ffa4a4">${esc(j.error)}</div>` : ""}
        ${j.summary ? `<div style="color:#8aa">verified ${j.summary.verified || 0} · held ${j.summary.held || 0} · candidate ${esc(j.summary.candidateFile || "n/a")}</div>` : ""}
        <div style="display:flex;gap:6px;margin-top:6px">${j.status === "complete" || j.status === "failed" || j.status === "aborted" ? `<button class="btn-sm ghost" data-delete-job="${esc(j.id)}">Delete</button>` : `<button class="btn-sm danger" data-abort-job="${esc(j.id)}">Abort</button>`}</div>
      </div>`).join("")}</div>` : '<p class="empty">No jobs yet.</p>'}</div>`;
  }

  // ---------- events ----------

  function bindTabs() {
    window.addEventListener("hashchange", selectPage);
    selectPage();
  }

  function bindLogin() {
    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const err = $("#login-error");
      const btn = e.target.querySelector("button[type=submit]");
      err.textContent = "";
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = "Signing in…";
      try {
        await api("/api/auth", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
        $("#password").value = "";
        showApp();
      } catch (ex) {
        err.textContent = ex.message || "Login failed. Please try again.";
      } finally {
        btn.disabled = false;
        btn.textContent = original;
      }
    });
    $("#logout").addEventListener("click", async () => {
      await fetch("/api/auth", { method: "DELETE" });
      showLogin();
    });
  }

  function bindAppEvents() {
    document.addEventListener("click", async (e) => {
      if (e.target.closest("#ai-detect")) {
        const btn = e.target.closest("#ai-detect");
        btn.disabled = true;
        state.loading = true;
        try {
          if ($("#ai-status")) $("#ai-status").innerHTML = '<p class="muted">Scanning ports 1234, 1235 and 11434…</p>';
          const typed = ($("#ai-url") && $("#ai-url").value.trim()) || "";
          const info = await requestDetect({ scan: true, modelUrl: typed });
          const origin = (info.connection && info.connection.modelUrl) || typed;
          if (origin) await adoptDetectedUrl(origin);
          if ($("#ai-status")) $("#ai-status").innerHTML = aiStatusHtml(state.data);
          toast(info.model ? "Detected " + info.model : (info.connection && info.connection.error) || "No local chat model found.");
        } catch (err) {
          toast(err.message);
          if ($("#ai-status")) $("#ai-status").innerHTML = '<p class="error">' + esc(err.message) + "</p>" + aiStatusHtml(state.data);
        } finally {
          state.loading = false;
          btn.disabled = false;
        }
        return;
      }
      if (e.target.closest("#select-all-catalog")) {
        allProducts().forEach((p) => state.catalogSelected.add(p.id));
        paint("#tab-catalog", catalogHtml(state.data));
        return;
      }
      if (e.target.closest("#collapse-duplicates")) {
        if (!confirm("Merge rows whose titles are IDENTICAL after folding into one product (offers combined)? Rows that differ on Bare/Combo, Mini, laser or variant are never touched. Undo is not offered for a bulk merge — use the Duplicates inbox for one group at a time.")) return;
        try {
          const res = await action({ action: "collapseDuplicates" });
          state.catalogSelected.clear();
          toast(res.removed ? "Collapsed " + res.removed + " duplicate row" + (res.removed === 1 ? "" : "s") + "." : "No duplicate titles found.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#delete-selected-catalog")) {
        const ids = [...state.catalogSelected];
        if (!ids.length) return;
        if (!confirm("Delete " + ids.length + " selected product" + (ids.length === 1 ? "" : "s") + " from the live catalog?")) return;
        try {
          await action({ action: "deleteCatalogProducts", ids });
          state.catalogSelected.clear();
          toast("Deleted selected products.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.matches("[data-catalog-select]")) {
        const id = e.target.dataset.catalogSelect;
        if (e.target.checked) state.catalogSelected.add(id); else state.catalogSelected.delete(id);
        e.target.closest(".product-card")?.classList.toggle("is-selected", e.target.checked);
        const btn = $("#delete-selected-catalog");
        if (btn) {
          btn.disabled = !state.catalogSelected.size;
          btn.textContent = "Delete selected (" + state.catalogSelected.size + ")";
        }
        return;
      }
      if (e.target.closest("#find-duplicates")) {
        const btn = e.target.closest("#find-duplicates");
        btn.disabled = true;
        btn.textContent = "Scanning…";
        try {
          const res = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "suggestDuplicates" }) });
          state.dupes = { clusters: res.clusters || [], blocked: res.blocked || [] };
          const n = state.dupes.clusters.length;
          toast(n ? n + " duplicate group" + (n === 1 ? "" : "s") + " found — review each before merging." : "No duplicate groups found.");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = "Find duplicate groups";
          render();
        }
        return;
      }
      if (e.target.closest("[data-keeper]")) {
        state.keeperId = e.target.closest("[data-keeper]").dataset.keeper;
        render();
        return;
      }
      if (e.target.closest("#merge-cancel")) {
        state.keeperId = "";
        state.catalogSelected.clear();
        render();
        toast("Merge cancelled.");
        return;
      }
      if (e.target.closest("[data-merge-cluster]") || e.target.closest("#merge-selected-go")) {
        const clusterKey = e.target.closest("[data-merge-cluster]") ? e.target.closest("[data-merge-cluster]").dataset.mergeCluster : "";
        const cluster = clusterKey ? (state.dupes && state.dupes.clusters || []).find((c) => c.key === clusterKey) : null;
        const ids = cluster ? cluster.rows.map((r) => r.id) : allProducts().filter((p) => state.catalogSelected.has(p.id)).map((p) => p.id);
        const keeperId = cluster ? cluster.keeperId : (state.keeperId || ids[0]);
        if (ids.length < 2) { toast("Nothing to merge."); return; }
        if (!confirm("Merge " + ids.length + " rows into " + keeperId + "? Offers are combined; the other rows disappear. Undo is available right after.")) return;
        const btn = e.target.closest("button");
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Merging…";
        try {
          // Keep the previous catalog so a wrong merge can be put back in one press.
          state.catalogUndo = state.data && state.data.catalog ? JSON.parse(JSON.stringify(state.data.catalog)) : null;
          const res = await action({ action: "mergeProducts", ids, keeperId });
          state.catalogSelected.clear();
          state.keeperId = "";
          state.dupes = null;
          state.dupesOnly = false;
          toast("Merged " + (res.merged + 1) + " rows into " + (res.keeper.name || res.keeper.id) + " (" + res.keeper.offers + " offers). Undo is in the toolbar.");
        } catch (err) {
          state.catalogUndo = null;
          toast(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
        return;
      }
      if (e.target.closest("#undo-merge")) {
        const prev = state.catalogUndo;
        if (!prev) { toast("Nothing to undo."); return; }
        if (!confirm("Put the catalog back to how it was before that merge?")) return;
        try {
          await action({ action: "saveCatalog", catalog: prev });
          state.catalogUndo = null;
          state.dupes = null;
          toast("Merge undone — the catalog is back as it was.");
        } catch (err) {
          toast(err.message);
        }
        return;
      }
      if (e.target.closest("#dedupe-offer-urls")) {
        const n = ((state.data && state.data.duplicateOffers) || []).length;
        if (!confirm("Move " + n + " duplicated store listing" + (n === 1 ? "" : "s") + " onto a single product each? The storefront stops comparing that shop twice.")) return;
        action({ action: "dedupeOfferUrls" })
          .then((r) => toast(r.groups ? "Fixed " + r.groups + " duplicated listing" + (r.groups === 1 ? "" : "s") + " (removed " + r.removed + " copies)." : "Nothing to fix."))
          .catch((err) => toast(err.message));
        return;
      }
      if (e.target.closest("#backup-create")) {
        const input = $("#backup-name");
        const name = (input && input.value.trim()) || ("backup " + new Date().toISOString().slice(0, 16).replace("T", " "));
        const btn = e.target.closest("#backup-create");
        btn.disabled = true;
        action({ action: "createBackup", name })
          .then((r) => {
            if (input) input.value = "";
            toast('Backed up as "' + r.backup.name + '" — ' + r.backup.rows + ' products, ' + r.backup.offers + ' offers.');
          })
          .catch((err) => toast(err.message))
          .finally(() => { btn.disabled = false; });
        return;
      }
      const restoreKey = e.target.closest("[data-backup-restore]") && e.target.closest("[data-backup-restore]").dataset.backupRestore;
      if (restoreKey) {
        const entry = ((state.data && state.data.backups) || []).find((b) => b.key === restoreKey) || {};
        if (
          !confirm(
            'Restore "' + (entry.name || restoreKey) + '"?\n\nThis REPLACES the current catalog, draft, shops and runs with that backup. Everything since it was saved is lost.'
          )
        )
          return;
        action({ action: "restoreBackup", key: restoreKey })
          .then((r) => {
            state.catalogSelected = new Set();
            toast('Restored "' + r.restored.name + '" — ' + r.restored.rows + ' products, ' + r.restored.offers + ' offers. The site now serves that state.');
          })
          .catch((err) => toast(err.message));
        return;
      }
      const deleteKey = e.target.closest("[data-backup-delete]") && e.target.closest("[data-backup-delete]").dataset.backupDelete;
      if (deleteKey) {
        if (!confirm("Delete this backup? The live data is untouched.")) return;
        action({ action: "deleteBackup", key: deleteKey })
          .then(() => toast("Backup deleted."))
          .catch((err) => toast(err.message));
        return;
      }
      if (e.target.closest("#backup-fresh")) {
        const n = allProducts().length;
        if (!confirm("Empty the live catalog? " + (n ? "All " + n + " products are removed" : "It is already empty") + " — make a backup first if you want it back.")) return;
        action({ action: "deleteAllCatalog" })
          .then(() => toast("Catalog emptied. Restore a backup to bring it back."))
          .catch((err) => toast(err.message));
        return;
      }
      if (e.target.closest("#delete-all-catalog")) {
        const n = allProducts().length;
        if (!n) { toast("Catalog is already empty."); return; }
        if (!confirm("Delete all " + n + " catalog products from the live site? This cannot be undone.")) return;
        try {
          await action({ action: "deleteAllCatalog" });
          state.editing.clear();
          state.catalogSelected.clear();
          toast("Catalog emptied.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#catalog-more")) {
        state.catalogLimit += 40;
        paint("#tab-catalog", catalogHtml(state.data));
      }
      if (e.target.closest("[data-mismatch-discard]")) {
        const url = decodeURIComponent(e.target.closest("[data-mismatch-discard]").dataset.mismatchDiscard);
        if (!confirm("Discard this listing from the run?")) return;
        try {
          await action({ action: "deleteFlagged", urls: [url] });
          state.reviewSelected.delete(url);
          state.reviewFlags.delete(url);
          toast("Discarded.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-mismatch-create]")) {
        const btn = e.target.closest("[data-mismatch-create]");
        const url = decodeURIComponent(btn.dataset.mismatchCreate);
        const detected = btn.dataset.detected || "other";
        const desk = state.data.desk;
        const name = detected.charAt(0).toUpperCase() + detected.slice(1);
        const shop = shopForUrl(state.data, url);
        if (!shop) { toast("No shop matches this listing."); return; }
        shop.categories = shop.categories || [];
        if (!shop.categories.some((c) => String(c.name || "").toLowerCase() === name.toLowerCase() && urlHostOf(c.url) === shopHostOf(shop))) {
          shop.categories.push({ id: "cat-" + Date.now().toString(36), name, url: shop.url });
        }
        try {
          await action({ action: "saveDesk", desk });
          toast("Added " + name + " on " + (shop.name || shop.id) + ".");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#select-all")) {
        $$("[data-review-select]").forEach((el) => {
          el.checked = true;
          state.reviewSelected.add(decodeURIComponent(el.dataset.reviewSelect));
          el.closest(".review-card")?.classList.add("is-selected");
        });
        updateReviewToolbar();
        return;
      }
      if (e.target.closest("#flag-all")) {
        $$("[data-review-flag]").forEach((el) => {
          el.checked = true;
          state.reviewFlags.add(decodeURIComponent(el.dataset.reviewFlag));
          el.closest(".review-card")?.classList.add("flagged");
        });
        updateReviewToolbar();
        return;
      }
      if (e.target.closest("#clear-review")) {
        state.reviewSelected.clear();
        $$("[data-review-select]").forEach((el) => {
          el.checked = false;
          el.closest(".review-card")?.classList.remove("is-selected");
        });
        updateReviewToolbar();
        return;
      }
      if (e.target.closest("#clear-flags")) {
        state.reviewFlags.clear();
        $$("[data-review-flag]").forEach((el) => {
          el.checked = false;
          el.closest(".review-card")?.classList.remove("flagged");
        });
        updateReviewToolbar();
        return;
      }
      if (e.target.closest("[data-place-pick]")) {
        const btn = e.target.closest("[data-place-pick]");
        const url = decodeURIComponent(btn.dataset.placePick);
        const raw = btn.dataset.placeVal || "create";
        const place = raw.startsWith("merge:")
          ? { action: "merge", candidateId: raw.slice(6) }
          : { action: "create", candidateId: "" };
        applyPlace(btn.closest(".review-card"), url, place);
        return;
      }
      if (e.target.closest("[data-restore-place]")) {
        const url = decodeURIComponent(e.target.closest("[data-restore-place]").dataset.restorePlace);
        state.reviewPlace.delete(url);
        const ev = cardEvent(url);
        const place = workerPlace(ev);
        const wrap = e.target.closest(".review-card");
        const q = wrap && wrap.querySelector("[data-review-place-q]");
        const sel = wrap && wrap.querySelector("[data-review-place]");
        if (q) q.value = "";
        if (sel) {
          sel.innerHTML = placeOptionsHtml(ev, place, "");
          sel.value = placeValue(place);
        }
        const hits = wrap && wrap.querySelector(".place-hits");
        if (hits) { hits.hidden = true; hits.innerHTML = ""; }
        const line = wrap && wrap.querySelector(".review-compare");
        if (line) line.textContent = compareText(ev, place);
        toast("Restored worker match.");
        return;
      }
      if (e.target.closest("#delete-flagged")) {
        const urls = [...(state.reviewFlags.size ? state.reviewFlags : state.reviewSelected)];
        if (!urls.length) return;
        if (!confirm("Delete " + urls.length + " flagged product" + (urls.length === 1 ? "" : "s") + " from this run? They will not be published.")) return;
        try {
          await action({ action: "deleteFlagged", urls });
          urls.forEach((u) => {
            state.reviewFlags.delete(u);
            state.reviewSelected.delete(u);
          });
          toast("Deleted " + urls.length + " products from the run.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#catalog-refresh")) {
        const btn = e.target.closest("#catalog-refresh");
        btn.disabled = true;
        try {
          await loadData();
          render();
          toast("Reloaded from the live catalog.");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (e.target.closest("[data-offer-branch]")) {
        const btn = e.target.closest("[data-offer-branch]");
        const url = btn.dataset.offerBranch;
        const from = btn.dataset.offerFrom;
        if (!confirm("Take this offer off this product and make it a product of its own, named from its scraped title?")) return;
        btn.disabled = true;
        try {
          const res = await action({ action: "retargetOffer", url, from, to: "new" });
          toast("Branched: " + (res.scrapedTitle || "new product") + " is now its own row.");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (e.target.closest("[data-offer-move]")) {
        const btn = e.target.closest("[data-offer-move]");
        const url = btn.dataset.offerMove;
        const from = btn.dataset.offerFrom;
        const box = btn.closest(".offer-src");
        const typed = ((box && box.querySelector("[data-offer-move-q]")) || {}).value || "";
        const want = typed.trim().toLowerCase();
        const target = allProducts().find((x) => String(x.name || "").toLowerCase() === want)
          || allProducts().find((x) => (x.name || "").toLowerCase().includes(want) && want.length > 3);
        if (!target) {
          toast("Type the name of the product this offer belongs to (pick one from the list).");
          return;
        }
        if (target.id === from) {
          toast("It is already on that product.");
          return;
        }
        btn.disabled = true;
        try {
          await action({ action: "retargetOffer", url, from, to: target.id });
          toast("Moved onto " + (target.name || target.id) + ".");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (e.target.closest("#check-stock") || e.target.closest("#check-stock-all")) {
        const btn = e.target.closest("button");
        const all = !!e.target.closest("#check-stock-all");
        const label = btn.textContent;
        const out = $("#stock-result");
        btn.disabled = true;
        btn.textContent = "Checking pages…";
        try {
          // staleHours 0 means "every offer", which is what the second button is for.
          const query = "/api/stock-refresh?limit=" + (all ? 60 : 25) + "&staleHours=" + (all ? 0 : 6);
          const data = await api(query);
          const s = data.summary || {};
          const changes = (data.changes || []).slice(0, 6).map((c) => c.store + " " + c.before + " → " + c.after).join(" · ");
          if (out) out.textContent = "checked " + s.checked + " of " + s.stale + " · " + s.outOfStock + " newly out of stock" + (s.skipped ? " · " + s.skipped + " left, press again" : "") + (changes ? " — " + changes : " — nothing changed");
          toast("Stock: " + s.checked + " checked, " + s.outOfStock + " now out of stock" + (s.skipped ? ", " + s.skipped + " still to do" : ""));
          await loadData();
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
        return;
      }
      if (e.target.closest("#gemma-unmatched") || e.target.closest("#gemma-selected")) {
        // Second opinion after the fact: never runs during a run, never publishes by itself.
        // It only fills in "where this card goes"; you still press Publish selected.
        const onlySelected = !!e.target.closest("#gemma-selected");
        const job = reviewJob(state.data || { jobs: [] });
        const targets = collectCards(job, state.data).filter((ev) => {
          const url = ev.card && ev.card.url;
          if (!url) return false;
          if (onlySelected) return state.reviewSelected.has(url);
          const a = ev.decision && ev.decision.action;
          return a !== "merge" && a !== "updated" && a !== "create";
        });
        if (!targets.length) {
          toast(onlySelected ? "Select some cards first." : "Nothing unmatched — the matcher already placed every card.");
          return;
        }
        const btn = e.target.closest("button");
        const label = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Asking AI…";
        try {
          const live = await pingWorker();
          if (!live.ok) throw new Error(live.error || "Local worker offline — start it with node worker/online-worker.cjs on this PC.");
          const res = await workerFetch("/rematch", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              cards: targets.map((ev) => ({ ...ev.card, kind: ev.card.kind || (ev.decision && ev.decision.shelf) || "printer" }))
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "AI pass failed");
          let merged = 0, created = 0, held = 0;
          for (const r of data.results || []) {
            if (r.action === "merge" && r.matchId) { state.reviewPlace.set(r.url, { action: "merge", candidateId: r.matchId }); merged += 1; }
            else if (r.action === "create") { state.reviewPlace.set(r.url, { action: "create", candidateId: "" }); created += 1; }
            else held += 1;
          }
          toast("AI answered " + data.asked + " of " + targets.length + ": " + merged + " merge, " + created + " new, " + held + " still unsure. Check the board, then publish.");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
        return;
      }
      if (e.target.closest("#publish-selected")) {
        const ids = [...state.reviewSelected];
        if (!ids.length) return;
        if (!confirm("Publish the selected products to the live catalog?")) return;
        const job = reviewJob(state.data || { jobs: [] });
        const byUrl = new Map();
        collectCards(job, state.data).forEach((ev) => { if (ev.card?.url) byUrl.set(ev.card.url, ev); });
        const placements = ids.map((url) => {
          const ev = byUrl.get(url) || cardEvent(url);
          const place = defaultPlace(ev);
          return { url, action: place.action, candidateId: place.candidateId, card: ev.card };
        });
        try {
          await action({ action: "publishSelected", ids, placements });
          state.reviewSelected.clear();
          toast("Selected products published.");
        } catch (err) { toast(err.message); }
      }
      if (e.target.matches("[data-review-select]")) {
        const key = decodeURIComponent(e.target.dataset.reviewSelect);
        if (e.target.checked) state.reviewSelected.add(key); else state.reviewSelected.delete(key);
        e.target.closest(".review-card")?.classList.toggle("is-selected", e.target.checked);
        updateReviewToolbar();
        return;
      }
      if (e.target.matches("[data-review-flag]")) {
        const key = decodeURIComponent(e.target.dataset.reviewFlag);
        if (e.target.checked) state.reviewFlags.add(key); else state.reviewFlags.delete(key);
        e.target.closest(".review-card")?.classList.toggle("flagged", e.target.checked);
        updateReviewToolbar();
        return;
      }
      if (e.target.closest("#publish-candidate")) {
        if (!confirm("Publish the waiting candidate as the live catalog?")) return;
        try { await action({ action: "publishCandidate" }); toast("Catalog published."); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("#delete-run")) {
        const job = activeJob(state.data || { jobs: [] });
        if (!job) return;
        if (!confirm("Delete run " + job.id + " and its activity log? The catalog is not touched.")) return;
        try { const res = await action({ action: "deleteJobs", id: job.id }); toast("Deleted " + res.removed + " run."); } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#delete-all-runs")) {
        if (!confirm("Delete every run and its activity log? The catalog is not touched.")) return;
        try { const res = await action({ action: "deleteJobs" }); toast("Deleted " + res.removed + " runs."); } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-update-shop-prices]")) {
        const btn = e.target.closest("[data-update-shop-prices]");
        const shop = ((state.data && state.data.desk && state.data.desk.shops) || []).find((s) => s.id === btn.dataset.updateShopPrices);
        if (!shop) return;
        const label = shop.name || shop.id;
        const vat = shop.vat === "excluded" ? "excluded" : "included";
        btn.disabled = true;
        try {
          const res = await action({ action: "saveShopVat", shop: shop.id, vat });
          const verb = vat === "excluded" ? "added KDV %20 to" : "removed KDV %20 from";
          toast(res.offers
            ? "Updated " + label + ": " + verb + " " + res.offers + " of " + res.checked + " offers" + (res.skipped ? ", " + res.skipped + " left on their page’s own +KDV" : "") + ". Reload the storefront to see it."
            : "No change needed: all " + res.checked + " offers for " + label + " already match this KDV setting.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-purge-shop]")) {
        const btn = e.target.closest("[data-purge-shop]");
        const shop = ((state.data && state.data.desk && state.data.desk.shops) || []).find((s) => s.id === btn.dataset.purgeShop);
        if (!shop) return;
        const withRuns = btn.dataset.purgeRuns === "1";
        const label = shop.name || shop.id;
        if (!confirm("Delete every product, offer and category that came from " + label + (withRuns ? ", and all of its runs" : "") + "?\n\nOffers from other shops on the same products are kept. Products left with no offers are removed from the catalog.")) return;
        try {
          const res = await action({ action: "purgeShop", shop: shop.id, runs: withRuns });
          toast("Removed " + res.offers + " offers, " + res.rows + " products, " + res.categories + " categories" + (res.jobs ? " and " + res.jobs + " runs" : "") + " from " + label + ".");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#discard-candidate")) {
        try { await action({ action: "discardCandidate" }); toast("Candidate discarded."); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("#abort-active")) {
        const job = activeJob(state.data || { jobs: [] });
        if (!job) return;
        try { await action({ action: "abortJob", id: job.id }); toast("Abort requested."); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("[data-delete-shop-cat]")) {
        const btn = e.target.closest("[data-delete-shop-cat]");
        const key = btn.dataset.deleteShopCat;
        const shopId = btn.dataset.shop;
        const desk = state.data.desk;
        const shop = (desk.shops || []).find((s) => s.id === shopId);
        if (!shop) return;
        shop.categories = (shop.categories || []).filter((c) => c.id !== key && c.url !== key);
        shop.categoryIds = (shop.categoryIds || []).filter((id) => id !== key);
        try { await action({ action: "saveDesk", desk }); toast("Category deleted."); } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-toggle-shop]")) {
        const btn = e.target.closest("[data-toggle-shop]");
        const desk = state.data.desk;
        const id = btn.dataset.toggleShop;
        const shop = (desk.shops || []).find((s) => s.id === id);
        if (!shop) return;
        shop.enabled = btn.dataset.enabled === "true" ? false : true;
        try { await action({ action: "saveDesk", desk }); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("[data-unpin]")) {
        const btn = e.target.closest("[data-unpin]");
        const desk = state.data.desk;
        desk.promoted = (desk.promoted || []).filter((p) => p.id !== btn.dataset.unpin);
        try { await action({ action: "saveDesk", desk }); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("#save-banners")) {
        const desk = state.data.desk;
        desk.banners = (state.bannersDraft || []).map((b) => ({ ...b, enabled: b.enabled !== false }));
        try { await action({ action: "saveDesk", desk }); state.bannersDraft = null; toast("Banners saved."); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("#add-banner")) {
        state.bannersDraft = state.bannersDraft || [];
        state.bannersDraft.push({ id: "banner-" + Date.now().toString(36), kicker: "", title: "", subtitle: "", href: "", image: "", enabled: true });
        render();
      }
      if (e.target.closest("[data-save-product]")) {
        const id = e.target.closest("[data-save-product]").dataset.saveProduct;
        const patch = state.editing.get(id) || {};
        try { await action({ action: "updateProduct", id, patch }); state.editing.delete(id); toast("Product saved."); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("[data-reset-product]")) {
        state.editing.delete(e.target.closest("[data-reset-product]").dataset.resetProduct);
        render();
      }
      if (e.target.closest("[data-abort-job]")) {
        const id = e.target.closest("[data-abort-job]").dataset.abortJob;
        try { await action({ action: "abortJob", id }); toast("Abort requested."); } catch (err) { toast(err.message); }
      }
      if (e.target.closest("[data-delete-job]")) {
        const id = e.target.closest("[data-delete-job]").dataset.deleteJob;
        try { await action({ action: "deleteJob", id }); toast("Job deleted."); } catch (err) { toast(err.message); }
      }
    });

    document.addEventListener("submit", async (e) => {
      if (e.target.id === "ai-form") {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        state.loading = true;
        try {
          const modelUrl = $("#ai-url").value.trim();
          if (modelUrl) {
            const saved = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "saveModelConnection", url: modelUrl }) });
            if (saved && saved.desk && state.data) state.data.desk = { ...state.data.desk, ...saved.desk };
          }
          const live = await pingWorker();
          if (live.ok) {
            const info = await requestDetect({ scan: !modelUrl, modelUrl });
            const origin = (info.connection && info.connection.modelUrl) || modelUrl;
            if (origin) await adoptDetectedUrl(origin);
            if ($("#ai-status")) $("#ai-status").innerHTML = aiStatusHtml(state.data);
            toast(info.model ? "Connected. Using " + info.model : "Worker online. Load a chat model on the AI server.");
            return;
          }
          if ($("#ai-status")) $("#ai-status").innerHTML = aiStatusHtml(state.data);
          toast(heartbeatFresh(state.data) ? "Saved. Worker will use this AI server." : "Saved the AI URL, but the worker at " + workerBase() + " is offline. Start node worker/online-worker.cjs on this PC" + (live.error ? " (" + live.error + ")" : "") + ".");
        } catch (err) {
          toast(err.message);
          if ($("#ai-status")) $("#ai-status").innerHTML = '<p class="error">' + esc(err.message) + "</p>" + aiStatusHtml(state.data);
        }
        finally { state.loading = false; btn.disabled = false; }
      }
      // "+ Shop" clones the first row so one submit can queue several shops.
      if (e.target.id === "add-shop-row") {
        e.preventDefault();
        const container = $("#run-rows");
        const first = container && container.querySelector(".run-row");
        if (!first) return;
        const row = first.cloneNode(true);
        // Row 1 keeps the ids the rest of the code refers to; a clone must not duplicate them.
        row.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
        row.querySelectorAll("label").forEach((el) => el.removeAttribute("for"));
        row.querySelectorAll("input").forEach((el) => { el.value = ""; });
        row.querySelectorAll("select").forEach((el) => { el.selectedIndex = 0; });
        row.querySelectorAll("button").forEach((el) => el.remove());
        const n = container.querySelectorAll(".run-row").length + 1;
        row.dataset.row = String(n);
        const label = row.querySelector("label");
        if (label) label.textContent = "Shop " + n;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "ghost danger remove-shop-row";
        remove.textContent = "Remove";
        row.appendChild(remove);
        container.appendChild(row);
        return;
      }
      if (e.target.classList && e.target.classList.contains("remove-shop-row")) {
        const row = e.target.closest(".run-row");
        if (row) row.remove();
        return;
      }
      if (e.target.id === "quick-run" || e.target.id === "run-form") {
        e.preventDefault();
        const isQuick = e.target.id === "quick-run";
        const kind = ($(isQuick ? "#run-kind" : "#shop-kind") || {}).value || "both";
        const maxProducts = Number(($("#shop-max") || {}).value || 200);
        const llmValue = $("#run-llm") ? $("#run-llm").checked : undefined;

        // One row per shop, each queued as its own job: the worker takes them one at a time, so several
        // shops can be started from a single submit without waiting.
        const rows = isQuick
          ? [{ shop: null, cat: "", url: ((($("#run-url") || {}).value) || "").trim() }]
          : Array.from(document.querySelectorAll("#run-rows .run-row")).map((el) => {
              const s = el.querySelector(".run-shop");
              const c = el.querySelector(".run-cat");
              const u = el.querySelector(".run-url");
              return {
                shop: shopById(state.data, s ? s.value : ""),
                cat: c ? c.value : "",
                url: u ? u.value.trim() : ""
              };
            });

        // A row the user added and left blank must not block the ones that are filled in.
        const filled = rows.filter((r) => r.url || (r.shop && r.shop.id));
        if (!filled.length) { toast("Pick a shop and its category URL."); return; }

        const problems = [];
        let queued = 0;
        for (const r of filled) {
          const who = r.shop ? (r.shop.name || r.shop.id) : "the shop";
          if (!/^https:\/\//i.test(r.url)) { problems.push(who + ": use an HTTPS shop URL"); continue; }
          if (!isQuick) {
            if (!r.shop) { problems.push("Pick a shop on every row."); continue; }
            if (r.cat && !categoryUrlForShop(r.shop, r.cat)) {
              problems.push("Add " + who + "’s own URL for " + r.cat + " on Shops. Do not reuse another shop’s link.");
              continue;
            }
            if (urlHostOf(r.url) !== shopHostOf(r.shop)) { problems.push("That category URL is not on " + who + "."); continue; }
          }
          try {
            const created = await action({ action: "createJob", type: "shop", url: r.url, kind, maxProducts, autoLlmMatch: llmValue });
            queued += 1;
            try { await notifyWorker(created.job); } catch (kickErr) { console.warn(kickErr); }
          } catch (err) { problems.push(err.message); }
        }
        if (queued > 1) toast(queued + " runs queued, one per shop. The worker takes them one at a time.");
        else if (queued === 1) toast("Run sent to the worker.");
        else toast("Queued. Start the worker on this PC if it stays on Waiting: node worker/online-worker.cjs");
        if (problems.length) toast(problems[0] + (problems.length > 1 ? " (+" + (problems.length - 1) + " more)" : ""));
      }
      if (e.target.matches(".add-shop-cat") || e.target.closest(".add-shop-cat") === e.target) {
        e.preventDefault();
        const form = e.target.closest(".add-shop-cat") || e.target;
        const shopId = form.dataset.addShopCat;
        const name = (form.querySelector('[name="name"]') || {}).value.trim();
        const raw = (form.querySelector('[name="url"]') || {}).value.trim();
        if (!name || !raw) return;
        try {
          const u = new URL(raw);
          if (u.protocol !== "https:") { toast("Category URL must be HTTPS."); return; }
          const desk = state.data.desk;
          const shop = (desk.shops || []).find((s) => s.id === shopId);
          if (!shop) return;
          if (urlHostOf(u.href) !== shopHostOf(shop)) {
            toast("That URL is not on " + (shop.name || shopHostOf(shop)) + ".");
            return;
          }
          const taken = (desk.shops || []).some((s) => s.id !== shop.id && (s.categories || []).some((c) => c.url === u.href));
          if (taken) { toast("That URL already belongs to another shop."); return; }
          shop.categories = shop.categories || [];
          const sameName = shop.categories.find((c) => foldCatName(c.name) === foldCatName(name));
          if (sameName) {
            sameName.url = u.href;
          } else {
            const cat = { id: "cat-" + Date.now().toString(36), name, url: u.href };
            shop.categories.push(cat);
            shop.categoryIds = [...new Set([...(shop.categoryIds || []), cat.id])];
          }
          await action({ action: "saveDesk", desk });
          toast(name + " saved for " + (shop.name || shop.id) + ".");
        } catch (err) { toast("Invalid category URL"); }
        return;
      }
      if (e.target.id === "add-shop-form") {
        e.preventDefault();
        const desk = state.data.desk;
        const url = $("#new-shop-url").value.trim();
        const name = $("#new-shop-name").value.trim();
        if (!name) { toast("Add a shop name."); return; }
        try {
          const u = new URL(url);
          const host = u.hostname.replace(/^www\./, "").toLowerCase();
          const existing = (desk.shops || []).find((s) => s.id === host || (s.url && new URL(s.url).hostname.replace(/^www\./, "").toLowerCase() === host));
          if (existing) {
            existing.enabled = true;
            existing.name = name || existing.name;
            existing.url = u.origin;
            existing.vat = $("#new-shop-vat")?.value === "excluded" ? "excluded" : existing.vat || "included";
            existing.categories = existing.categories || [];
          } else {
            desk.shops = desk.shops || [];
            desk.shops.push({ id: host, name, url: u.origin, enabled: true, vat: $("#new-shop-vat")?.value === "excluded" ? "excluded" : "included", categories: [], addedAt: new Date().toISOString() });
          }
          await action({ action: "saveDesk", desk });
          $("#new-shop-url").value = ""; $("#new-shop-name").value = "";
        } catch (err) { toast("Invalid shop URL"); }
      }
      if (e.target.id === "pin-form") {
        e.preventDefault();
        if (!state.pickedPin) return;
        const desk = state.data.desk;
        const pin = { id: "pin-" + Date.now().toString(36), productId: state.pickedPin, query: $("#pin-query").value.trim(), slot: $("#pin-slot").value, enabled: true };
        desk.promoted = desk.promoted || [];
        desk.promoted.push(pin);
        await action({ action: "saveDesk", desk });
        state.pickedPin = null;
        $("#pin-search").value = "";
        $("#pin-hits").innerHTML = "";
        $("#pin-pick").disabled = true;
      }
    });

    document.addEventListener("change", (e) => {
      if (e.target.id === "auto-llm-match") {
        const on = e.target.checked === true;
        action({ action: "saveMatchSettings", autoLlmMatch: on }).then((saved) => {
          if (saved && saved.desk && state.data) state.data.desk = { ...state.data.desk, ...saved.desk };
          toast(on ? "Auto AI match on: one AI ask, extreme gray only." : "Auto AI match off: Magellan only, no AI server needed.");
        }).catch((err) => toast(err.message));
        return;
      }
      if (e.target.id === "run-shop") {
        fillRunCategories(e.target.value, $("#run-cat") && $("#run-cat").value);
        return;
      }
      if (e.target.id === "run-cat") {
        const shopId = $("#run-shop") && $("#run-shop").value;
        const url = applyRunCategoryUrl(shopId, e.target.value);
        if (e.target.value && shopId && !url) toast("Add " + e.target.value + "’s URL on this shop. Names are shared; URLs are unique.");
        return;
      }
      if (e.target.dataset.shopCatName != null) {
        const form = e.target.closest(".shop-card") && e.target.closest(".shop-card").querySelector(".add-shop-cat");
        const nameInput = form && form.querySelector('[name="name"]');
        const urlInput = form && form.querySelector('[name="url"]');
        if (nameInput && e.target.value) nameInput.value = e.target.value;
        if (urlInput) urlInput.value = "";
        if (e.target.value) toast("Name filled. Paste this shop’s own " + e.target.value + " URL.");
        return;
      }
      if (e.target.dataset.shopVat) {
        const id = e.target.dataset.shopVat;
        const desk = state.data && state.data.desk;
        const shop = (desk.shops || []).find((s) => s.id === id);
        if (!shop) return;
        const vat = e.target.value === "excluded" ? "excluded" : "included";
        const label = shop.name || shop.id;
        const verb = vat === "excluded" ? "added KDV %20 to" : "removed KDV %20 from";
        action({ action: "saveShopVat", shop: id, vat })
          .then((res) => toast("Saved KDV for " + label + ". " + verb + " " + res.offers + " offer" + (res.offers === 1 ? "" : "s") + (res.skipped ? " (" + res.skipped + " kept their page’s own +KDV)" : "") + ". Reload the storefront to see it."))
          .catch((err) => { e.target.value = vat === "excluded" ? "included" : "excluded"; toast(err.message); });
        return;
      }
      if (e.target.dataset.reviewPlace == null) return;
      const url = decodeURIComponent(e.target.dataset.reviewPlace);
      const raw = e.target.value || "create";
      const place = raw.startsWith("merge:")
        ? { action: "merge", candidateId: raw.slice(6) }
        : { action: "create", candidateId: "" };
      state.reviewPlace.set(url, place);
      const job = reviewJob(state.data || { jobs: [] });
      const ev = (job?.events || []).find((x) => x.card?.url === url) || { card: { url }, compared: [] };
      const line = e.target.closest(".review-card")?.querySelector(".review-compare");
      if (line) line.textContent = compareText(ev, place);
    });

    document.addEventListener("input", (e) => {
      const placeQ = e.target.getAttribute && e.target.getAttribute("data-review-place-q");
      if (placeQ != null) {
        fillPlaceHits(e.target.closest(".review-card"), decodeURIComponent(placeQ), e.target.value);
        return;
      }
      if (e.target.id === "review-job-select") {
        state.reviewJobId = e.target.value;
        state.reviewSelected.clear();
        state.reviewPlace.clear();
        render();
        toast(state.reviewJobId ? "Showing run " + state.reviewJobId + " — collected cards are visible again." : "Showing the newest run with cards.");
        return;
      }
      if (e.target.id === "catalog-shop" || e.target.id === "catalog-variant" || e.target.id === "dupes-only") {
        if (e.target.id === "catalog-shop") state.catalogShop = e.target.value;
        if (e.target.id === "catalog-variant") state.catalogVariant = e.target.value;
        if (e.target.id === "dupes-only") state.dupesOnly = e.target.checked;
        state.catalogLimit = 40;
        render();
        return;
      }
      if (e.target.id === "catalog-search") {
        state.catalogQuery = e.target.value;
        state.catalogLimit = 40;
        const list = filteredProducts();
        $("#catalog-count").textContent = list.length + " shown";
        $("#catalog-more").hidden = list.length < state.catalogLimit;
        const box = $("#catalog-results");
        if (box) box.innerHTML = list.map(productCard).join("") || '<div class="empty">No products found.</div>';
        return;
      }
      if (e.target.dataset.banner != null) {
        const i = Number(e.target.dataset.banner);
        const k = e.target.dataset.k;
        state.bannersDraft[i][k] = e.target.type === "checkbox" ? e.target.checked : e.target.value;
        return;
      }
      if (e.target.id === "pin-search") {
        clearTimeout(window._pinTimer);
        window._pinTimer = setTimeout(() => {
          const q = e.target.value.trim().toLowerCase();
          const all = allProducts().filter((p) => [p.id, p.name, p.brand, p.color, p.polymer].filter(Boolean).join(" ").toLowerCase().includes(q)).slice(0, 12);
          $("#pin-hits").innerHTML = all.map((p) => `<button type="button" class="btn-sm ghost" data-pin-id="${esc(p.id)}" style="margin:2px">${esc(p.name || p.id)}</button>`).join("");
        }, 200);
        return;
      }
      const card = e.target.closest("[data-product-id]");
      if (!card) return;
      const id = card.dataset.productId;
      const original = allProducts().find((p) => p.id === id);
      if (!original) return;
      const edit = state.editing.get(id) || { ...original };
      edit[e.target.dataset.field] = e.target.type === "number" ? Number(e.target.value) : e.target.value;
      state.editing.set(id, edit);
    });

    document.addEventListener("click", (e) => {
      const pinBtn = e.target.closest("[data-pin-id]");
      if (pinBtn) {
        state.pickedPin = pinBtn.dataset.pinId;
        $("#pin-pick").disabled = false;
        toast("Picked: " + state.pickedPin);
        return;
      }
    });
  }

  // ---------- init ----------

  async function init() {
    bindTabs();
    bindLogin();
    bindAppEvents();
    try {
      await api("/api/auth");
      showApp();
    } catch (_) {
      showLogin();
    }
  }

  globalThis.test = { state, rememberDetails, openAttr };
  init();
})();
