(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = {
    data: null,
    runRows: null,
    tab: "overview",
    catalogQuery: "",
    baselineQuery: "",
    baselineCategory: "",
    baselineEdit: new Map(),
    baselineDupes: null,
    baselineRemoved: new Set(),
    runAllActive: false,
    runAllStop: false,
    catalogLimit: 40,
    editing: new Map(), // productId -> {shelf, object}
    pendingImages: new Map(),
    bannersDraft: null,
    pickedPin: null,
    reviewSelected: new Set(),
    reviewFlags: new Set(),
    // Shop Runs search box text
    reviewQuery: "",
    // Cards per page on the Shop runs board and the Uncertain list (12, 24, 36, 48; 0 = all) and the page each is on.
    pageSize: loadPageSize(),
    // Cards already published stay on the Shop runs board (marked) so a mistake can be fixed; this hides them.
    hidePublished: loadHidePublished(),
    pager: { runs: { page: 1 }, uncertain: { page: 1 } },
    reviewPlace: new Map(),
    catalogSelected: new Set(),
    catalogShop: "",
    catalogVariant: "",
    // Catalog category: "" (all), "product" (printers) or "filament".
    catalogShelf: "",
    dupesOnly: false,
    dupes: null,
    reviewJobId: "",
    uncertainShop: "",
    uncertainEdit: new Map(),
    uncertainSaved: new Set(),
    uncertainPublished: new Map(),
    // Cards deleted this page view. They stay in the grid, covered, until a full refresh.
    uncertainHeld: new Map(),
    // Find duplicates on Uncertain: groups of URLs (null until the button is pressed).
    uncertainDupes: null,
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
    // Offer cards are built only when their list is opened (the catalog holds hundreds of offers).
    const lazy = el.open && el.querySelector && el.querySelector("[data-lazy-offers]");
    if (lazy && !lazy.childElementCount) lazy.innerHTML = offerCardsFor(lazy.dataset.lazyOffers);
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

  function prepareThumbnail(file) {
    if (!file || !/^image\/(?:jpeg|png|webp)$/.test(file.type)) return Promise.reject(new Error("Choose a JPG, PNG or WebP image."));
    if (file.size > 12 * 1024 * 1024) return Promise.reject(new Error("Choose an image smaller than 12 MB."));
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("Could not decode that image."));
        image.onload = () => {
          const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          canvas.toBlob((blob) => {
            if (!blob || blob.size > 1024 * 1024) return reject(new Error("The resized thumbnail is still larger than 1 MB."));
            const out = new FileReader();
            out.onerror = () => reject(new Error("Could not prepare that image."));
            out.onload = () => resolve({ type: blob.type, data: String(out.result).split(",")[1], preview: out.result });
            out.readAsDataURL(blob);
          }, "image/webp", 0.86);
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
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
      if (/^https?:\/\//i.test(origin || "") && info.model) await adoptDetectedUrl(origin);
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
          markOtherTabsStale(state.tab);
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
            rememberRunRows();
            const max = $("#shop-max")?.value, llm = $("#run-llm")?.checked;
            paint("#tab-runs", runsHtml(data));
            if ($("#shop-max")) $("#shop-max").value = max;
            if ($("#run-llm") && llm !== undefined) $("#run-llm").checked = llm;
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

  function catalogUpdateCount() {
    return new Set([...state.editing.keys(), ...state.pendingImages.keys(), ...state.catalogSelected]).size;
  }

  function showCatalogDirtyCount() {
    const btn = $("#update-catalog");
    if (!btn) return;
    const changed = catalogUpdateCount();
    btn.disabled = !changed;
    btn.textContent = "Update catalog" + (changed ? " (" + changed + ")" : "");
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
      if (state.catalogShelf && p.shelf !== state.catalogShelf) return false;
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
  function fitTextareas(root) {
    const scope = root || document;
    const fields = scope.matches && scope.matches("textarea") ? [scope] : scope.querySelectorAll ? $$("textarea", scope) : [];
    fields.forEach((el) => {
      if (!el.style) return;
      el.style.height = "auto";
      el.style.height = Math.max(el.scrollHeight || 0, 42) + "px";
    });
  }

  function paint(sel, html) {
    const el = $(sel);
    if (!el) return;
    if (painted.get(sel) === html) return;
    painted.set(sel, html);
    const active = document.activeElement;
    const keep = active && active.id === "review-search" && typeof el.contains === "function" && el.contains(active) ? { start: active.selectionStart, end: active.selectionEnd } : null;
    el.innerHTML = html;
    if (sel === "#tab-runs") {
      applyReviewSearch();
      if (keep) { const box = document.getElementById("review-search"); if (box) { box.focus(); try { box.setSelectionRange(keep.start, keep.end); } catch (_) { /* no caret in a search input on some browsers */ } } }
    }
  }

  // Only the tab on screen is drawn; the others are drawn when you open them. (Building the HTML of every card
  // of every tab on each refresh is what made the page slow.)
  const tabPainters = {
    overview: (d) => paint("#tab-overview", overviewHtml(d)),
    runs: (d) => paint("#tab-runs", runsHtml(d)),
    uncertain: (d) => paint("#tab-uncertain", uncertainHtml(d)),
    catalog: (d) => paint("#tab-catalog", catalogHtml(d)),
    baseline: (d) => paint("#tab-baseline", baselineHtml(d)),
    shops: (d) => paint("#tab-shops", shopsHtml(d)),
    merch: (d) => paint("#tab-merch", merchHtml(d)),
    ai: (d) => paint("#tab-ai", aiHtml(d)),
    jobs: (d) => paint("#tab-jobs", jobsHtml(d))
  };
  const staleTabs = new Set();
  function markOtherTabsStale(active) {
    for (const name of Object.keys(tabPainters)) if (name !== active) staleTabs.add(name);
  }

  function render() {
    const d = state.data;
    if (!d) return;
    const requested = location.hash.slice(1);
    const active = Object.hasOwn(pages, requested) ? requested : "overview";
    markOtherTabsStale(active);
    staleTabs.delete(active);
    tabPainters[active](d);
    renderHeaderOnly();
    selectPage();
  }

  const pages = {
    overview: ["Overview", "Your catalog, shop activity, and next steps at a glance."],
    catalog: ["Catalog", "Review and edit the products visible on your storefront."],
    baseline: ["Baseline", "Human-approved models, grouped by category. No shop offers. Survives a catalog wipe."],
    shops: ["Shops", "Manage the shops included in your price comparison."],
    runs: ["Shop runs", "Collect products from a shop and follow its progress."],
    uncertain: ["Uncertain", "Unmatched shop cards and what Laya did with them. Edit, then force-publish."],
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
    if (state.data && staleTabs.has(state.tab)) { staleTabs.delete(state.tab); tabPainters[state.tab](state.data); }
    $("#page-title").textContent = pages[state.tab][0];
    $("#page-description").textContent = pages[state.tab][1];
    document.title = pages[state.tab][0] + " — 3D Price Desk";
    fitTextareas($("#tab-" + state.tab));
  }

  function activeJob(d) {
    const jobs = d.jobs || [];
    const running = jobs.filter((j) => j.status === "running");
    if (running.length) {
      return running.slice().sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
    }
    return jobs.find((j) => j.status === "queued") || null;
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

  function runRowsFromDom() {
    return $$("#run-rows .run-row").map((row) => ({
      shop: (row.querySelector(".run-shop") || {}).value || "",
      cat: (row.querySelector(".run-cat") || {}).value || "",
      url: ((row.querySelector(".run-url") || {}).value || "").trim()
    }));
  }

  function rememberRunRows() {
    const rows = runRowsFromDom();
    if (rows.length) state.runRows = rows;
    return rows;
  }

  function runCategoryFromRows(rows) {
    for (const r of rows || []) if (r && r.cat) return r.cat;
    return "";
  }

  function remainingRunShops(d, rows) {
    const used = new Set((rows || []).map((r) => r.shop).filter(Boolean));
    return deskShops(d).filter((s) => s.enabled !== false && !used.has(s.id));
  }

  function rowsWithRemainingShops(d, rows) {
    const cat = runCategoryFromRows(rows);
    const extra = remainingRunShops(d, rows).map((s) => ({
      shop: s.id,
      cat,
      url: categoryUrlForShop(s, cat) || ""
    }));
    const kept = (rows || []).filter((r) => r.shop);
    return { rows: kept.concat(extra), added: extra.length, cat };
  }

  function collectRunRows(isQuick) {
    if (isQuick) return [{ shop: null, cat: "", url: ((($("#run-url") || {}).value) || "").trim() }];
    return runRowsFromDom().map((r) => ({ ...r, shop: shopById(state.data, r.shop) }))
      .filter((r) => r.url || (r.shop && r.shop.id));
  }

  function kindForCategory(cat) {
    const c = String(cat || "").toLowerCase();
    if (c.includes("filament")) return "filament";
    if (c.includes("printer") || c.includes("yaz")) return "printer";
    return "both";
  }

  function runRowProblem(r) {
    if (!String(r.url || "").toLowerCase().startsWith("https://")) return "Use an HTTPS shop URL on every filled row.";
    if (!r.shop) return "Pick a shop on every filled row.";
    if (r.cat && !categoryUrlForShop(r.shop, r.cat)) return "Add the category URL for " + r.cat + " under Shops first. Do not reuse another shop link.";
    if (urlHostOf(r.url) !== shopHostOf(r.shop)) return "That category URL is not on " + (r.shop.name || r.shop.id) + ".";
    return "";
  }

  function waitForRunJob(id) {
    return new Promise((resolve) => {
      let waited = 0;
      const tick = async () => {
        if (state.runAllStop) return resolve({ status: "aborted" });
        try {
          const d = await api("/api/admin");
          const j = (d.jobs || []).find((x) => x.id === id);
          if (!j || ["complete", "failed", "aborted"].includes(j.status)) return resolve(j || null);
        } catch (_) { /* keep waiting */ }
        waited += 4000;
        if (waited > 3600000) return resolve(null);
        setTimeout(tick, 4000);
      };
      setTimeout(tick, 4000);
    });
  }

  function runsHtml(d) {
    const job = activeJob(d);
    const events = job ? (job.events || []).slice(-200) : [];
    const shops = deskShops(d).filter((s) => s.enabled !== false);
    const inferred = job && job.url ? shopForUrl(d, job.url) : null;
    const selectedShop = inferred;
    const selectedName = job && job.url ? categoryNameForUrl(d, job.url) : "";
    const names = categoryNames(d);
    const runRows = state.runRows && state.runRows.length ? state.runRows : [{
      shop: selectedShop ? selectedShop.id : "", cat: selectedName, url: (job && job.url) || ""
    }];
    const llmOn = (job && job.autoLlmMatch !== undefined ? job.autoLlmMatch === true : (d.desk && d.desk.autoLlmMatch) === true);
    const liveJobs = (d.jobs || []).filter((j) => ["queued", "running"].includes(j.status));
    return `
      <div class="panel">
        <h2>Start a shop run</h2>
        <p class="muted">Category names are shared (Filament, Printers). The URL is unique to the shop you pick — Robolink never crawls Rhino’s link.</p>
        <form class="form-row" id="run-form">
          <div id="run-rows" style="flex:1 0 100%;display:flex;flex-direction:column;gap:8px;border:1px solid #c7d2fe;border-radius:10px;padding:12px;background:#f8faff">
            ${runRows.map((r, i) => `
              <div class="run-row" data-run-index="${i}" style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
                <div class="field"><label${i === 0 ? ' for="run-shop"' : ""}>Shop ${i + 1}</label><select${i === 0 ? ' id="run-shop"' : ""} class="run-shop"><option value="">Choose a shop</option>${shops.map((s) => `<option value="${esc(s.id)}"${r.shop === s.id ? " selected" : ""}>${esc(s.name || s.id)}</option>`).join("")}</select></div>
                <div class="field" style="flex:2"><label${i === 0 ? ' for="run-cat"' : ""}>Category</label><select${i === 0 ? ' id="run-cat"' : ""} class="run-cat">${nameOptionsHtml(names, r.cat)}</select></div>
                <div class="field" style="flex:2"><label${i === 0 ? ' for="shop-url"' : ""}>Category URL</label><input${i === 0 ? ' id="shop-url"' : ""} class="run-url" type="text" required placeholder="https://www.shop.com/kategori/filament" value="${esc(r.url || "")}"></div>
                <div class="run-order"><button class="ghost" type="button" data-move-run="up" aria-label="Move shop ${i + 1} up" ${i === 0 ? "disabled" : ""}>↑</button><button class="ghost" type="button" data-move-run="down" aria-label="Move shop ${i + 1} down" ${i === runRows.length - 1 ? "disabled" : ""}>↓</button></div>
                ${runRows.length > 1 ? `<button class="ghost danger remove-shop-row" type="button">Remove</button>` : ""}
              </div>`).join("")}
            <button class="ghost" type="button" id="add-shop-row">+ Add another shop run</button>
            <button class="ghost" type="button" id="add-all-shops" ${remainingRunShops(d, runRows).length ? "" : "disabled"} title="Add every shop that is not already in the list, using the category already selected">Add all remaining shops</button>
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-top:1px dashed #c7d2fe;padding-top:8px">
              <button class="primary" type="button" id="run-all" ${state.runAllActive ? "disabled" : ""} title="Review every shop above, then run them one after another">${state.runAllActive ? "Running…" : "Review &amp; run all"}</button>
              <span class="muted" style="font-size:12px">Runs them top to bottom, one at a time, so each shop is matched against the ones already run.</span>
            </div>
          </div>
                    <div class="field"><label for="shop-max">Max products <span class="muted" style="font-weight:400">(empty = all)</span></label><input id="shop-max" type="number" min="1" step="1" placeholder="All products" title="Leave empty to scrape everything the category has. A number stops at that many." value="${(job && job.maxProducts) || ""}"></div>
          <label class="muted" style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="run-llm" ${llmOn ? "checked" : ""}> AI help on very close matches</label>
          <button class="primary" type="submit" ${job ? "disabled" : ""}>Queue run</button>
          ${job ? `<button class="ghost danger" type="button" id="abort-active">Abort job</button>` : ""}
          ${(job || liveJobs.length || state.runAllActive) ? `<button class="ghost danger" type="button" id="abort-all">Abort all</button>` : ""}
          ${job ? `<button class="ghost danger" type="button" id="delete-run">Delete run</button>` : ""}
        </form>
        <p class="muted">AI help off (default): Magellan decides and close calls wait for you. No AI server is needed either way. On: one short AI ask, text only, only when Magellan is in the gray band. Hard conflicts (AMS, Combo, mini, laser) are never merged either way.<br>Visual match: on — thumbnails are fingerprinted locally when titles are a close call, and a matching photo is flagged for you to confirm. Vision never merges on its own.</p>
        ${job ? `<p><span class="badge ${job.status}">${esc(job.status)}</span> ${esc(job.progress || "")}</p>` : "<p class='muted'>No active run.</p>"}
        ${runTimingHtml(d)}
        <h3>Live review board</h3>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0">
          <label class="muted" style="font-size:12px">Run
            <select id="review-job-select">
              <option value="">newest with cards</option>
              ${(d.jobs || []).slice(0, 25).map((j) => {
                const cards = Object.keys(j.cards || {}).length;
                const at = String(j.createdAt || "").replace("T", " ").slice(0, 16);
                return `<option value="${esc(j.id)}" ${state.reviewJobId === j.id ? "selected" : ""}>${esc(jobSiteLabel(j))} · ${esc(j.kind || "")} · ${esc(at)} · ${esc(j.status || "")} · ${cards} card${cards === 1 ? "" : "s"}${(j.published || []).length ? " · " + (j.published || []).length + " collected" : ""}</option>`;
              }).join("")}
            </select>
          </label>
          <small class="muted">${state.reviewJobId ? "Showing one run by hand — collected cards included, so its decisions stay editable." : "Gather a shop to fill this board."}</small>
        </div>
        ${boardFallbackNote(d)}
        <p class="muted">Cards appear as products are gathered. Select what to publish, flag anything unsure, and choose which catalog product each listing joins — that is who it will be price-compared against.</p>
        ${reviewBoardHtml(reviewJob(d))}
        <h3>Run activity <button class="btn-sm danger" type="button" id="delete-all-runs" style="margin-left:8px">Delete all runs</button></h3>
        <div class="tape">${events.length ? events.map((ev) => `<div><time>${esc(String(ev.at || "").slice(11, 19))}</time>${esc(ev.text || ev.error || JSON.stringify(ev))}</div>`).join("") : '<div class="empty">Waiting for worker events…</div>'}</div>
      </div>
    `;
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return "—";
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return h + "h " + m + "m " + String(sec).padStart(2, "0") + "s";
    if (m) return m + "m " + String(sec).padStart(2, "0") + "s";
    return sec + "s";
  }

  function jobSiteLabel(j) {
    if (j.site) return j.site;
    try { return new URL(j.url).hostname.replace(/^www\./, ""); } catch (_) { return j.url || j.id || "shop"; }
  }

  function jobElapsedMs(j, now) {
    const start = Date.parse(j.startedAt || "");
    if (!Number.isFinite(start)) return null;
    let end = Date.parse(j.finishedAt || "");
    if (!Number.isFinite(end)) end = j.status === "running" ? now : Date.parse(j.updatedAt || "");
    if (!Number.isFinite(end)) return null;
    return Math.max(0, end - start);
  }

  function runTimingHtml(d) {
    const jobs = d.jobs || [];
    const newest = jobs.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0];
    const focus = reviewJob(d);
    const anchor = focus && focus.id && focus.id !== "candidate" && jobs.some((j) => j.id === focus.id)
      ? jobs.find((j) => j.id === focus.id)
      : newest;
    if (!anchor) return `<h3>Shop run time</h3><p class="muted">No shop run yet. The total, then each website, shows up here.</p>`;
    const batch = anchor.batchId ? jobs.filter((j) => j.batchId === anchor.batchId) : [anchor];
    batch.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    const now = Date.now();
    const running = batch.some((j) => ["running", "queued"].includes(j.status));
    const starts = batch.map((j) => Date.parse(j.startedAt || "")).filter(Number.isFinite);
    const ends = batch.map((j) => {
      if (j.finishedAt) return Date.parse(j.finishedAt);
      if (["running", "queued"].includes(j.status)) return now;
      const updated = Date.parse(j.updatedAt || "");
      return Number.isFinite(updated) ? updated : NaN;
    }).filter(Number.isFinite);
    const total = starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : 0;
    return `<h3>Shop run time</h3>
      <p style="margin:4px 0 8px"><strong>${formatDuration(total)}</strong> <span class="muted">${running ? "still running — this is the whole run so far" : "whole run, from the first website starting to the last one finishing"}</span></p>
      <ul class="run-times" style="list-style:none;padding:0;margin:0 0 12px">
        ${batch.map((j) => {
          const ms = jobElapsedMs(j, now);
          const shown = ms == null ? (j.status === "queued" ? "waiting" : "—") : formatDuration(ms);
          return `<li style="display:flex;gap:10px;align-items:baseline;padding:2px 0"><span>${esc(jobSiteLabel(j))}</span><strong>${esc(shown)}</strong><span class="muted">${esc(j.status || "")}</span></li>`;
        }).join("")}
      </ul>`;
  }

  function titleFromUrl(url) {
    try {
      const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
      return last.replace(/[-_]+/g, " ").replace(/\.(html?|php)$/i, "") || url;
    } catch (_) {
      return String(url || "");
    }
  }

  // With no run picked, the board falls back to the newest run that still has cards. When that is not
  // the newest run, say so: a Robolink run that found nothing used to show the last Rhino run's cards
  // with no hint that they belonged to another shop.
  function boardFallbackNote(d) {
    if (state.reviewJobId) return "";
    const jobs = (d.jobs || []).slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
    const newest = jobs[0];
    const shown = reviewJob(d);
    if (!newest || !shown || !shown.id || shown.id === "candidate" || shown.id === newest.id) return "";
    const when = (j) => String(j.createdAt || "").replace("T", " ").slice(0, 16);
    return `<p class="board-fallback" role="status">The newest run (${esc(jobSiteLabel(newest))} · ${esc(newest.kind || "")} · ${esc(when(newest))} · ${esc(newest.status || "")}) has no cards to review. Showing the ${esc(jobSiteLabel(shown))} ${esc(shown.kind || "")} run from ${esc(when(shown))} instead — pick a run above to switch.</p>`;
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

  // collectCards reads every card of a run (its events, saved edits, the candidate catalog). It depends only on the
  // run's data and the chosen run, never on what is typed, so the result is kept until one of those objects is
  // replaced (a data reload, or a Save putting new job.cards). Typing in a card used to redo it for every key.
  const collectCardsMemo = new WeakMap();
  function collectCardsEntry(job, d) {
    const key = [d, d && d.candidate, state.data && state.data.catalog, job.url, job.page2Url, job.cards, job.events, job.published, job.dropped, job.variantParents, state.reviewJobId, state.hidePublished];
    const hit = collectCardsMemo.get(job);
    if (hit && hit.key.every((v, i) => v === key[i])) return hit;
    const list = collectCardsRaw(job, d);
    const entry = { key, list, byUrl: new Map(list.filter((x) => x.card && x.card.url).map((x) => [x.card.url, x])) };
    collectCardsMemo.set(job, entry);
    return entry;
  }
  function collectCards(job, d) { return collectCardsEntry(job, d).list.slice(); }

  function collectCardsRaw(job, d) {
    const byUrl = new Map();
    // Published cards stay on the board, marked, so a mistake can still be fixed (Hide published takes them off).
    const dropped = new Set([...(job.dropped || []), ...(state.hidePublished ? (job.published || []) : [])]);
    const rank = (d) => d && (d.action === "merge" || d.action === "updated") ? 2 : d && d.action === "create" ? 1 : 0;
    // The category page the run read is not a listing (older runs saved it as a card).
    const pageKey = (u) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/+$/, "") + x.search).toLowerCase(); } catch { return ""; } };
    const runPages = new Set([job.url, job.page2Url].filter(Boolean).map(pageKey));
    // Family cards whose colours were read from their product page: the colours are the cards.
    for (const u of [...(job.variantParents || []), ...(job.events || []).filter((e) => e.type === "variants").map((e) => e.url)]) if (u) dropped.add(u);
    const add = (url, patch) => {
      if (!url || dropped.has(url) || runPages.has(pageKey(url))) return;
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
        name: (patch.card && patch.card.name) || prev.card.name,
        listingTitles: [...new Set([...(prev.card.listingTitles || []), patch.card && patch.card.sourceTitle, patch.card && patch.card.name].filter(Boolean))],
        price: (patch.card && Number(patch.card.price) > 0) ? patch.card.price : prev.card.price
      },
        decision,
        compared: patch.compared || prev.compared,
        error: patch.error || prev.error,
        laya: patch.laya || prev.laya
      });
    };
    Object.values(job.cards || {}).forEach((c) => {
      const row = (c && c.card) || c;
      if (row && row.url) add(row.url, { card: row, decision: row.decision || c.decision, compared: row.compared || c.compared, error: row.error || c.error, laya: row.laya || c.laya });
    });
    (job.events || []).forEach((e) => {
      (e.urls || []).forEach((u) => add(u, { card: { name: titleFromUrl(u), url: u } }));
      (e.items || []).forEach((it) => it && it.url && add(it.url, {
        card: { name: it.name || titleFromUrl(it.url), url: it.url, image: it.image || "", kind: it.kind, price: it.price, mismatch: it.mismatch },
        mismatch: it.mismatch || e.mismatch,
        error: it.mismatch ? "category_mismatch" : undefined
      }));
      if (e.type === "done") return;
      if (e.card && e.card.url) add(e.card.url, { ...e, error: e.error || (e.type === "extract" ? e.text : undefined) });
      else if (e.url) add(e.url, { card: { name: e.name || titleFromUrl(e.url), url: e.url }, error: e.error || e.text, mismatch: e.mismatch });
      if (e.type === "mismatch" && (e.items || []).length) {
        e.items.forEach((it) => it && it.url && add(it.url, {
          card: { name: it.name || titleFromUrl(it.url), url: it.url, image: it.image || "", kind: it.kind || (it.mismatch && it.mismatch.detectedType), price: it.price, mismatch: it.mismatch },
          mismatch: it.mismatch,
          error: "category_mismatch"
        }));
      }
    });
    // Uncertain "Save" edits must beat the harvest events replayed above.
    Object.values(job.cards || {}).forEach((c) => { if (c && c.handEdited && c.url) add(c.url, { card: c }); });
    const cand = d && d.candidate;
    if (cand) {
      const liveIds = new Set();
      const live = currentCatalog();
      [...(live.products || []), ...(live.filaments || [])].forEach((p) => {
        if (p.id) liveIds.add(p.id);
      });
      [...(cand.products || []), ...(cand.filaments || [])].forEach((p) => {
        (p.offers || []).forEach((o) => {
          // Candidate is global across every shop and category. It may enrich a URL gathered by
          // this run, but it must never inject a different category's listing onto this board.
          if (!o.url || !byUrl.has(o.url)) return;
          const scraped = byUrl.get(o.url).card || {};
          add(o.url, {
            card: {
              name: scraped.name || p.name, brand: scraped.brand || p.brand, kind: scraped.kind || p.kind, price: o.price, url: o.url,
              image: scraped.image || o.image || p.image, polymer: scraped.polymer || p.polymer, variant: scraped.variant || p.variant,
              color: scraped.color || p.color, weight: scraped.weight || p.weight, diameter: scraped.diameter || p.diameter,
              packaging: scraped.packaging || p.packaging
            },
            // Merge or new comes from the row it landed on, not from the offer URL being new.
            decision: { action: liveIds.has(p.id) ? "merge" : "create", candidateId: p.id, candidateName: p.name, shelf: p.kind }
          });
        });
      });
    }
    const exactTitles = new Map();
    const quality = (e) => {
      const c = e.card || {};
      return (!e.error ? 16 : 0) + (Number(c.price) > 0 ? 8 : 0) + (rank(e.decision) * 2) + (c.image ? 2 : 0) + (!/[?#]/.test(c.url || "") ? 1 : 0);
    };
    for (const e of byUrl.values()) {
      const c = e.card || {};
      const title = adminFold(c.name || "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      // Colour code alone is too coarse ("Green Apple" and "Green" share green): the listing's colour
      // name and the URL's colour decide too, so different spools never hide each other.
      const sku = c.kind === "filament" ? [c.color, c.colorName, colourId(String(c.url || "").replace(/[-_/]+/g, " ")) || c.url, c.weight, c.diameter, c.packaging].map(adminFold).join("|") : "";
      const key = title ? hostOf(c.url) + "\n" + title + "\n" + sku : c.url;
      const prev = exactTitles.get(key);
      if (!prev || quality(e) > quality(prev)) exactTitles.set(key, e);
    }
    const publishedUrls = new Set(job.published || []);
    return [...exactTitles.values()].map((e) => (publishedUrls.has(e.card && e.card.url) ? { ...e, published: true } : e));
  }

  function editedCard(ev) {
    const card = (ev && ev.card) || {};
    const edited = { ...card, ...(state.uncertainEdit.get(card.url) || {}) };
    if (edited.kind === "filament" && !edited.packaging) edited.packaging = "spool";
    return edited;
  }

  function baselinePendingIds() {
    const baselineIds = new Set((((state.data || {}).baseline || {}).items || []).map((it) => it.id));
    return [...new Set([...state.baselineEdit.keys(), ...state.pendingImages.keys()].filter((id) => baselineIds.has(id)))];
  }

  function showBaselineDirtyCount() {
    const btn = $("#save-all-baseline");
    if (!btn) return;
    const count = baselinePendingIds().length;
    btn.disabled = !count;
    btn.textContent = "Save all baseline changes" + (count ? " (" + count + ")" : "");
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
  }

  function catalogProduct(id) {
    if (!id || !state.data) return null;
    if (String(id).startsWith("baseline:")) {
      const bid = String(id).slice(9);
      const items = (state.data.baseline && state.data.baseline.items) || [];
      const it = items.find((x) => x.id === bid);
      if (it) {
        const shown = it.entityType === "sku" && it.parentId ? (items.find((x) => x.id === it.parentId) || it) : it;
        const live = currentCatalog();
        const product = [...(live.products || []), ...(live.filaments || [])].find((p) => p.id === bid || p.baselineId === bid);
        return { id, name: shown.name, brand: shown.brand, image: shown.image, offers: product?.offers || [], baseline: true, shownId: shown.id };
      }
    }
    const bags = [state.data.candidate, currentCatalog()];
    for (const bag of bags) {
      if (!bag) continue;
      const hit = [...(bag.products || []), ...(bag.filaments || [])].find((p) => p.id === id);
      if (hit) return hit;
    }
    return null;
  }

  // limit: the select keeps a short list; the ▾ list and the search show every model of the right category.
  // cheap: names only (no offer lookups), for the select that every card carries.
  function placementOptions(card, decision, query, limit, cheap) {
    const q = adminFold(query || "");
    // cardKind, not the stored kind: a spool the shop filed as a printer must still list filament baselines.
    const kind = cardKind(card) === "filament" ? "filaments" : "printers";
    const models = ((state.data && state.data.baseline && state.data.baseline.items) || []).filter((it) => {
      if (kind === "filaments" ? it.category !== "filaments" : it.category === "filaments") return false;
      if (kind === "filaments" && (it.entityType === "sku" || it.parentId)) return false;
      if (!q) return true;
      return adminFold([it.name, it.brand, it.id].join(" ")).includes(q);
    });
    const list = models.map((it) => (cheap ? { id: "baseline:" + it.id, name: it.name, brand: it.brand || "", baseline: true, shownId: it.id } : catalogProduct("baseline:" + it.id)));
    if (decision.candidateId) {
      const picked = catalogProduct(decision.candidateId);
      if (picked && picked.baseline) {
        const duplicate = list.findIndex((h) => h.shownId === picked.shownId);
        if (duplicate >= 0) list.splice(duplicate, 1);
        list.unshift(picked);
      }
    }
    list.sort((a, b) => {
      if (a.id === decision.candidateId) return -1;
      if (b.id === decision.candidateId) return 1;
      return 0;
    });
    return list.slice(0, limit || (q ? 50 : 25));
  }

  function workerPlace(e) {
    const d = (e && e.decision) || {};
    if ((d.action === "merge" || d.action === "updated") && d.candidateId) {
      return { action: "merge", candidateId: d.candidateId };
    }
    return { action: "create", candidateId: d.candidateId || "" };
  }

  function baselinePlace(place) {
    if (!place || place.action !== "merge" || !place.candidateId) return { action: "create", candidateId: "" };
    const id = String(place.candidateId);
    if (id.startsWith("baseline:")) return { action: "merge", candidateId: id };
    const baseline = ((state.data && state.data.baseline && state.data.baseline.items) || []);
    const bags = [currentCatalog(), state.data && state.data.candidate];
    const row = bags.flatMap((bag) => [...((bag && bag.products) || []), ...((bag && bag.filaments) || [])]).find((p) => p.id === id);
    const baselineId = (row && row.baselineId) || (baseline.some((it) => it.id === id) ? id : "");
    return baselineId ? { action: "merge", candidateId: "baseline:" + baselineId } : { action: "create", candidateId: "" };
  }

  function layaOf(e) {
    return (e && e.laya) || (e && e.card && e.card.laya) || null;
  }

  function magellanUnsure(e) {
    if (e && e.error) return false;
    const a = e && e.decision && e.decision.action;
    return a !== "merge" && a !== "updated" && a !== "create";
  }

  function defaultPlace(e) {
    const url = e.card && e.card.url;
    if (url && state.reviewPlace.has(url)) return baselinePlace(state.reviewPlace.get(url));
    if (e.card && e.card.reviewState === "uncertain") return { action: "create", candidateId: "" };
    const laya = layaOf(e);
    if (laya && laya.action === "merge" && laya.matchId) return baselinePlace({ action: "merge", candidateId: laya.matchId });
    if (laya && laya.action === "create") return { action: "create", candidateId: "" };
    const d = e.decision || {};
    if (d.baselineId) return baselinePlace({ action: "merge", candidateId: String(d.baselineId).startsWith("baseline:") ? d.baselineId : "baseline:" + d.baselineId });
    return baselinePlace(workerPlace(e));
  }

  function collectUncertain(d) {
    const out = [];
    const seen = new Set();
    for (const job of (d && d.jobs) || []) {
      const published = new Set(job.published || []);
      const shopHost = hostOf(job.url) || job.site || "";
      const shop = shopForUrl(d, job.url);
      const shopName = (shop && (shop.name || shop.id)) || shopHost || job.id;
      for (const ev of collectCards(job, d)) {
        const url = ev.card && ev.card.url;
        if (!url || seen.has(url) || published.has(url)) continue;
        const laya = layaOf(ev);
        if (defaultPlace(ev).action === "merge" && !magellanUnsure(ev) && !laya) continue;
        seen.add(url);
        out.push({ ...ev, laya, jobId: job.id, shopHost, shopName });
      }
    }
    return out;
  }

  function layaLabel(laya) {
    if (!laya) return "Laya has not looked at this card yet";
    if (laya.action === "merge") return "Laya: merge → " + (laya.matchName || laya.matchId || "catalog row");
    if (laya.action === "create") return "Laya: new product";
    return "Laya: still unsure" + (laya.reason ? " — " + laya.reason : "");
  }

  async function forcePublishUrls(urls) {
    const byUrl = new Map();
    for (const job of (state.data && state.data.jobs) || []) {
      collectCards(job, state.data).forEach((ev) => { if (ev.card && ev.card.url) byUrl.set(ev.card.url, ev); });
    }
    const placements = urls.map((url) => {
      const ev = byUrl.get(url) || state.uncertainPublished.get(url)?.ev || { card: { url } };
      const edit = state.uncertainEdit.get(url) || {};
      const card = {
        ...(ev.card || {}),
        url,
        name: edit.name != null ? edit.name : (ev.card && ev.card.name),
        brand: edit.brand != null ? edit.brand : (ev.card && ev.card.brand),
        subBrand: edit.subBrand != null ? edit.subBrand : (ev.card && ev.card.subBrand),
        polymer: edit.polymer != null ? edit.polymer : (ev.card && ev.card.polymer),
        variant: edit.variant != null ? edit.variant : (ev.card && ev.card.variant),
        color: edit.color != null ? edit.color : (ev.card && ev.card.color),
        kind: cardKind(ev.card),
        packaging: edit.packaging != null ? edit.packaging : ((ev.card && ev.card.packaging) || (cardKind(ev.card) === "filament" ? "spool" : ""))
      };
      for (const k of ["colorName", "colorTone", "colorHex", "colorHexes", "colorSet", "colorEffect", "weight", "spoolMaterial", "rfid", "packCount", "bundle"]) if (edit[k] != null) card[k] = edit[k];
      // What the card on screen says goes (auto match, your pick or Laya); off screen, the same rule.
      const domSel = (typeof document.querySelectorAll === "function" ? $$(".uncertain-card").find((el) => el.dataset.uncertainUrl === url)?.querySelector("[data-review-place]") : null)
        || (ev.card && ev.card.name ? detachedCard(uncertainCard(ev), "[data-review-place]") : null);
      const place = domSel ? parsePlace(domSel.value) : uncertainPlace(ev);
      return { url, action: place.action === "merge" ? "merge" : "create", candidateId: place.candidateId, card };
    });
    return api("/api/admin", { method: "POST", body: JSON.stringify({ action: "publishSelected", placements }) });
  }

  function parsePlace(raw) {
    const v = String(raw || "create");
    return v.startsWith("merge:") ? { action: "merge", candidateId: v.slice(6) } : { action: "create", candidateId: "" };
  }

  // Automatic "Goes to": the baseline model this card already is. Filaments: same brand, polymer and
  // variant (and sub-brand when either side has one) on a family row; colour lives below the family.
  // Printers: only an exact model name, because Combo / Pro / Max are different machines.
  function autoBaselinePlace(f) {
    const items = (state.data && state.data.baseline && state.data.baseline.items) || [];
    const vset = (v) => splitTags(v).map(adminFold).sort().join("+");
    let best = null, score = 0;
    // Baseline models are single spools: a pack is its own product, picked by hand if at all.
    if (f.kind === "filament" && (f.bundle === true || Number(f.packCount) >= 2)) return null;
    if (f.kind === "filament") {
      for (const it of items) {
        if (it.category !== "filaments" || it.entityType === "sku" || it.parentId) continue;
        if (adminFold(it.brand) !== adminFold(f.brand) || !f.brand) continue;
        if (adminFold(it.polymer) !== adminFold(f.polymer) || vset(it.variant) !== vset(f.variant)) continue;
        // A sub-brand is part of the identity: "Creality TPU" is not "Creality CR TPU", in either direction.
        const itSub = adminFold(splitTags(it.subBrand)[0] || ""), cardSub = adminFold(splitTags(f.subBrand)[0] || "");
        if (itSub !== cardSub) continue;
        if (diameterValue(it.diameter) !== diameterValue(f.diameter)) continue;
        const s = 1 + (itSub ? 2 : 0);
        if (s > score) { best = it; score = s; }
      }
    } else {
      const title = adminFold(f.name).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      best = items.find((it) => it.category !== "filaments" && title && [it.name, [it.brand, it.name].join(" ")].some((n) => adminFold(n).replace(/[^\p{L}\p{N}]+/gu, " ").trim() === title)) || null;
    }
    return best ? { action: "merge", candidateId: "baseline:" + best.id, auto: true, name: best.name } : null;
  }

  // Linked (default): Goes to follows the automatic match, else Laya / Magellan. Picking one yourself
  // breaks the link and your pick sticks (saved with the card); the chain links it again.
  function uncertainPlace(ev, fields) {
    const c = withEarlierSave(ev.card || {});
    const edit = state.uncertainEdit.get(c.url) || {};
    const linked = edit.placeLinked != null ? edit.placeLinked : c.placeLinked !== false;
    if (!linked) {
      const own = edit.place != null ? edit.place : c.place;
      return { ...(own ? parsePlace(own) : defaultPlace(ev)), linked: false };
    }
    const f = fields || { kind: c.kind, name: edit.name != null ? edit.name : c.name, brand: edit.brand != null ? edit.brand : c.brand, subBrand: edit.subBrand != null ? edit.subBrand : c.subBrand, polymer: edit.polymer != null ? edit.polymer : c.polymer, variant: edit.variant != null ? edit.variant : c.variant, diameter: edit.diameter != null ? edit.diameter : c.diameter, bundle: edit.bundle != null ? edit.bundle : c.bundle, packCount: edit.packCount != null ? edit.packCount : c.packCount };
    return { ...(autoBaselinePlace(f) || defaultPlace(ev)), linked: true };
  }
  // While linked, Goes to follows the card live: typing a new brand, sub-brand, polymer or variant
  // re-runs the automatic match at once (CR → no longer "Creality TPU").
  function refreshAutoPlace(card) {
    const chain = card && card.querySelector("[data-place-chain]");
    const sel = card && card.querySelector("[data-review-place]");
    if (!chain || !sel || chain.getAttribute("aria-pressed") !== "true") return;
    const url = card.dataset.uncertainUrl;
    const ev = cardEvent(url);
    const f = uncertainFields(card);
    const place = uncertainPlace(ev, { kind: card.dataset.kind || cardKind(ev.card), name: f.name, brand: f.brand, subBrand: f.subBrand, polymer: f.polymer, variant: f.variant, diameter: f.diameter, bundle: f.bundle, packCount: f.packCount });
    sel.innerHTML = placeOptionsHtml(ev, place, "");
    sel.value = placeValue(place);
    const wrap = sel.closest(".review-place-label");
    const note = wrap.querySelector(".place-auto");
    const text = place.auto ? "Auto: matched baseline " + place.name : "";
    if (note && !text) note.remove();
    else if (note) note.textContent = text;
    else if (text) wrap.insertAdjacentHTML("beforeend", `<small class="muted place-auto">${esc(text)}</small>`);
    const line = card.querySelector(".review-compare");
    if (line) line.textContent = compareText(ev, place);
  }

  function placeChain(linked) {
    return `<button type="button" class="btn-sm ghost spool-chain place-chain" data-place-chain aria-pressed="${linked ? "true" : "false"}" title="${linked ? "Linked: follows the automatic baseline match. Click to choose by hand." : "Unlinked: your own pick. Click to follow the automatic match again."}" aria-label="${linked ? "Break baseline link" : "Link baseline"}">${linked ? CHAIN : CHAIN_BROKEN}</button>`;
  }

  function placeValue(place) {
    return place.action === "merge" && place.candidateId ? "merge:" + place.candidateId : "create";
  }

  // full: every baseline model of the card's category (filled when the dropdown is opened; a page of 200
  // cards would otherwise carry 200 × every model).
  function placeOptionsHtml(e, place, query, full) {
    const c = e.card || {};
    const url = c.url || "";
    const dec = e.decision || {};
    const options = placementOptions(c, dec, query, full ? 2000 : 25, true);
    if (place.action === "merge" && place.candidateId && !options.some((p) => p.id === place.candidateId)) {
      const extra = catalogProduct(place.candidateId);
      if (extra && extra.baseline) options.unshift(extra);
    }
    const selected = placeValue(place);
    return [`<option value="create"${selected === "create" ? " selected" : ""}>New product — not compared yet</option>`]
      .concat(options.map((p) => {
        const label = "Baseline · " + p.name + (p.brand ? " — " + p.brand : "");
        const val = "merge:" + p.id;
        return `<option value="${esc(val)}"${selected === val ? " selected" : ""}>${esc(label)}</option>`;
      })).join("");
  }

  // The same card collectUncertain(d).find(url) gives, without building the whole queue (this runs on every key
  // typed in a card).
  function uncertainEventFor(d, url) {
    for (const job of (d && d.jobs) || []) {
      const ev = collectCardsEntry(job, d).byUrl.get(url);
      if (!ev || new Set(job.published || []).has(url)) continue;
      const laya = layaOf(ev);
      if (defaultPlace(ev).action === "merge" && !magellanUnsure(ev) && !laya) continue;
      const shopHost = hostOf(job.url) || job.site || "";
      const shop = shopForUrl(d, job.url);
      return { ...ev, laya, jobId: job.id, shopHost, shopName: (shop && (shop.name || shop.id)) || shopHost || job.id };
    }
    return null;
  }

  function cardEvent(url) {
    const fromAll = uncertainEventFor(state.data || {}, url);
    if (fromAll) return fromAll;
    // A published offer card (Catalog / Baseline) is not in the Uncertain queue: use the event it was drawn from.
    const asOffer = offerEventsByUrl.get(url);
    if (asOffer) return asOffer;
    const job = reviewJob(state.data || { jobs: [] });
    if (!job) return { card: { url }, decision: {}, compared: [] };
    return collectCardsEntry(job, state.data).byUrl.get(url) || { card: { url }, decision: {}, compared: [] };
  }

  function placeCard(el) {
    return el && (el.closest(".uncertain-card") || el.closest(".review-card"));
  }

  // Your own pick on an Uncertain card breaks the automatic link and is saved with the card.
  function unlinkPlace(card, place) {
    if (!card) return;
    const url = card.dataset.uncertainUrl;
    state.uncertainEdit.set(url, { ...state.uncertainEdit.get(url), placeLinked: false, place: placeValue(place) });
    const chain = card.querySelector("[data-place-chain]");
    if (chain) chain.outerHTML = placeChain(false);
    const note = card.querySelector(".place-auto");
    if (note) note.remove();
    scheduleAutosave(card);
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

  function fillPlaceHits(wrap, url, query, opts) {
    const box = wrap && wrap.querySelector(".place-hits");
    const sel = wrap && wrap.querySelector("[data-review-place]");
    const ev = cardEvent(url);
    const place = sel && sel.value ? parsePlace(sel.value) : defaultPlace(ev);
    const q = String(query || "").trim();
    const openAll = !!(opts && opts.openAll);
    if (sel) {
      sel.innerHTML = placeOptionsHtml(ev, place, q);
      sel.value = placeValue(place);
    }
    if (!box) return;
    if (!q && !openAll) { box.hidden = true; box.innerHTML = ""; return; }
    const hits = placementOptions(ev.card || { url }, ev.decision || {}, q, 1000);
    const id = encodeURIComponent(url);
    const btns = [`<button type="button" class="place-hit" data-place-pick="${esc(id)}" data-place-val="create">New product — not compared yet</button>`]
      .concat(hits.map((p) => {
        const name = "Baseline · " + (p.name || p.id) + (p.brand ? " — " + p.brand : "");
        const baselineId = String(p.id || "").startsWith("baseline:") ? String(p.id).slice(9) : "";
        return `<span class="place-hit-row"><button type="button" class="place-hit" data-place-pick="${esc(id)}" data-place-val="merge:${esc(p.id)}">${esc(name)}</button>${baselineId ? `<button type="button" class="place-del place-rename" data-place-rename="${esc(baselineId)}" data-place-url="${esc(id)}" data-place-name="${esc(p.name || p.id)}" title="Rename this baseline model" aria-label="Rename baseline ${esc(p.name || p.id)}">✎</button>` : ""}${baselineId ? `<button type="button" class="place-del" data-place-del="${esc(baselineId)}" data-place-url="${esc(id)}" data-place-name="${esc(p.name || p.id)}" title="Delete this wrong baseline model" aria-label="Delete baseline ${esc(p.name || p.id)}">×</button>` : ""}</span>`;
      }));
    box.hidden = false;
    box.innerHTML = btns.join("") || '<span class="muted">No baseline match</span>';
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

  // One card of the Shop runs board as it is drawn. Also used off screen (see reviewCardDom).
  function reviewCardHtml(job, e) {
    const c = editedCard(e);
    const shopHost = hostOf(job.url) || job.site || "";
    const shop = shopForUrl(state.data, job.url);
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
    const pathNote = dec.matchPath === "laya-baseline" ? " · Laya (baseline-trained)" + (dec.rejected ? " · rejected: " + dec.rejected : "")
      : dec.nearDupe ? (dec.photoMatch ? " · near duplicate — same thumbnail, confirm" : " · near duplicate — review") + visualNote
      : dec.matchPath === "magellan+visual" ? " · Magellan + visual" + visualNote
      : (dec.matchPath === "magellan" || dec.rule === "magellan") ? " · Magellan" : "";
    const mismatchActions = mismatch ? `<div class="mismatch-actions">
        <button type="button" class="btn-sm" data-mismatch-create="${esc(id)}" data-detected="${esc(detected || "other")}">Create new category: ${esc((detected || "other").charAt(0).toUpperCase() + (detected || "other").slice(1))}</button>
        <button type="button" class="btn-sm danger" data-mismatch-discard="${esc(id)}">Discard</button>
      </div>` : "";
    // Same card as Uncertain: autofill, colours, weight, spool chain, RFID, undo / redo, Goes to chain.
    return uncertainCard({ ...e, jobId: job.id, shopHost, shopName: (shop && (shop.name || shop.id)) || shopHost }, false, { isSel, isFlag, mismatch, where: where + pathNote, mismatchActions });
  }

  function reviewBoardHtml(job) {
    if (!job) return '<p class="muted">No product cards yet. Queue a run — cards appear as soon as listing pages are harvested.</p>';
    const cards = collectCards(job, state.data);
    if (!cards.length) return '<p class="muted">No product cards yet. Queue a run with the local worker online — harvested product URLs show up here immediately.</p>';
    const selected = state.reviewSelected.size;
    // Cards the deterministic pass could not place: no merge, no new row, no update.
    const unmatched = cards.filter((e) => {
      const a = e.decision && e.decision.action;
      return !e.error && !e.published && !!(e.card && e.card.url) && a !== "merge" && a !== "updated" && a !== "create";
    }).length;
    const publishedCount = cards.filter((e) => e.published).length;
    return `
      <div class="review-search">
        <input id="review-search" type="search" value="${esc(state.reviewQuery)}" autocomplete="off" spellcheck="false" aria-label="Search this run" placeholder='Search this run…  bambu red   "exact phrase"   -wood   price:<700   weight:1kg   shop:rhino    (press / to focus)'>
        <span class="muted" id="review-search-info"></span>
        <details class="review-search-help"><summary>How to search</summary>
          <p class="muted">Every word must match, in any order, and typos are forgiven. Partial words work (<code>bam</code> finds Bambu) and Turkish colours too (<code>siyah</code>, <code>kırmızı</code>). Use <code>"quotes"</code> for an exact phrase and <code>-word</code> to leave something out.</p>
          <p class="muted">Filters: <code>brand:</code> <code>sub:</code> <code>polymer:</code> <code>variant:</code> <code>color:</code> <code>weight:1kg</code> <code>price:&lt;700</code> <code>price:500-800</code> <code>diameter:2.85</code> <code>shop:</code> <code>status:</code> (<code>held</code> <code>unmatched</code> <code>mismatch</code> <code>flagged</code> <code>selected</code> <code>edited</code> <code>rfid</code> <code>no price</code>) <code>place:</code> (the baseline it goes to) <code>name:</code> <code>url:</code>. Best matches come first.</p>
        </details>
        <div class="rs-chips" id="review-search-chips"></div>
      </div>
      <div class="review-toolbar">
        <button class="btn-sm" type="button" id="select-all">Select all</button>
        <button class="btn-sm" type="button" id="flag-all">Flag all</button>
        <button class="btn-sm ghost" type="button" id="clear-review">Clear selection</button>
        <button class="btn-sm ghost" type="button" id="clear-flags">Clear flags</button>
        <button class="btn-sm danger" type="button" id="delete-flagged" ${state.reviewFlags.size ? "" : "disabled"}>Delete flagged (${state.reviewFlags.size})</button>
        <button class="btn-sm danger" type="button" id="delete-all-review" title="Remove every gathered listing from every shop in this collect, no selection needed">Delete all</button>
        <button class="btn-sm ok" type="button" id="publish-selected" ${selected ? "" : "disabled"}>Save &amp; publish selected (${selected})</button>
        <span class="muted">${cards.length} gathered${publishedCount ? " · " + publishedCount + " published" : ""}</span>
        <label class="muted" title="Published cards stay here, marked, so you can fix a mistake. Tick to take them off the board."><input type="checkbox" id="hide-published" ${state.hidePublished ? "checked" : ""}> Hide published</label>
      </div>
      <div class="review-toolbar">
        <span class="muted">Baseline-trained Laya help — scores only current catalog candidates and cannot override a hard split:</span>
        <button class="btn-sm" type="button" id="laya-unmatched" ${unmatched ? "" : "disabled"}>Ask Laya: all unmatched (${unmatched})</button>
        <button class="btn-sm" type="button" id="laya-selected" ${selected ? "" : "disabled"}>Ask Laya: selected (${selected})</button>
      </div>
      <div class="review-board" id="review-board">
        ${optionGroupsHtml(cards, (e) => reviewCardHtml(job, e), String(state.reviewQuery || "").trim() ? "" : "runs")}
      </div>
    `;
  }

  // ============================================================================================
  // Products sold in several options (the colours of one filament). Each option stays its own
  // listing (own URL, price, stock, Goes to), but the board draws them as one card: a dot per
  // option showing that option's own picture; a click on a dot shows that option's fields.
  //   Filament Marketim: options read from one product page carry variantOf (that page).
  //   Rhino: every colour is its own listing in the category; same shop, model, brand, pack and
  //   weight make them one product.
  // ============================================================================================
  function optionGroupKey(e) {
    const c = (e && e.card) || {};
    if (e.mismatch || c.mismatch || e.error === "category_mismatch" || cardKind(c) !== "filament") return "";
    const host = hostOf(c.url);
    if (c.variantOf) return host + "|of|" + c.variantOf;
    if (!(Number(c.price) > 0)) return "";
    const model = adminFold(listingName(c)).replace(/[^\p{L}\p{N}+]+/gu, " ").trim();
    if (!model) return "";
    return [host, "model", model, adminFold(c.brand || ""), Number(c.packCount) || "", weightOf(c) || "", diameterValue(c.diameter)].join("|");
  }

  // pictures: the options carry pictures of their own (not one product photo repeated); else the dot is
  // the colour itself.
  function optionDot(c, i, on, pictures) {
    const img = pictures ? (imageUrl({ image: c.optionThumb || "" }) || imageUrl({ image: c.image || "" })) : "";
    const st = cardColour(c, state.uncertainEdit.get(c.url) || {}, colourNameOf(c));
    const fill = colourFill(st);
    const ring = Array.isArray(fill) ? fill[0] : fill === "rainbow" ? "#888" : fill || "#cbd5e1";
    const name = colourNameOf(c) || listingName(c);
    return `<button type="button" class="opt-dot${on ? " is-on" : ""}" data-opt-dot="${i}" style="--ring:${esc(ring || "#cbd5e1")}" title="${esc(name + (Number(c.price) > 0 ? " · " + c.price + " TL" : ""))}" aria-label="${esc(name)}" aria-pressed="${on ? "true" : "false"}">${img ? `<img src="${esc(img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="opt-dot-fill" style="background:${esc(Array.isArray(fill) ? "conic-gradient(" + fill.join(",") + ")" : fill === "rainbow" ? RAINBOW : fill || "#e5e7eb")}"></span>`}</button>`;
  }

  // list: card events in board order; render(event) → that option's card HTML. Groups take the place of
  // their first option; a product with one option is drawn as before.
  // A "unit" is what the board counts as one card: a group of options or a single listing. Units are cut
  // into pages whole, so the options of one product never end up on two pages.
  function optionGroupUnits(list) {
    const groups = new Map();
    const order = [];
    for (const e of list) {
      const key = optionGroupKey(e);
      if (key && groups.has(key)) { groups.get(key).push(e); continue; }
      if (key) groups.set(key, [e]);
      order.push(key ? { key } : { single: e });
    }
    return order.map((slot) => (slot.single ? slot : { key: slot.key, members: groups.get(slot.key) }));
  }

  function renderOptionUnit(slot, render) {
    if (slot.single) return render(slot.single);
    const members = slot.members;
    if (members.length < 2) return render(members[0]);
    const at = Math.max(0, Math.min(members.length - 1, Number(state.optionAt && state.optionAt.get(slot.key)) || 0));
    const first = editedCard(members[at]);
    // One photo for every option is the product's photo, not the colours': draw colours instead.
    const pics = members.map((m) => { const c = editedCard(m); return c.optionThumb || c.image || ""; });
    const pictures = pics.every(Boolean) && new Set(pics).size === pics.length;
    const prices = members.map((m) => Number(m.card && m.card.price)).filter((n) => n > 0);
    const min = prices.length ? Math.min(...prices) : 0;
    const max = prices.length ? Math.max(...prices) : 0;
    // Each option's own card shows that option's picture (a colour button's own thumbnail when the shop
    // gives one), so the photo follows the dots; one photo for all of them is said so on the card.
    // The card shows the colour's big photo when each colour has one; the dot its swatch picture.
    const bigs = members.map((m) => editedCard(m).image || "");
    const bigOwn = bigs.every(Boolean) && new Set(bigs).size === bigs.length;
    const cards = members.map((m, i) => render({ ...m, optionGroup: { pic: bigOwn ? bigs[i] : pictures ? pics[i] : "", sharedPhoto: !pictures && !bigOwn, size: members.length, linked: groupLinked(m) } }).replace(/^(\s*<div class="[^"]*)"/, `$1 opt-member${i === at ? "" : " opt-hidden"}" data-opt-index="${i}"`));
    return `<div class="option-group" data-option-group="${esc(slot.key)}">
      <div class="option-group-head">
        <div class="option-group-title"><strong>${esc(listingName(first))}</strong> <span class="muted">${members.length} options${min ? " · " + (min === max ? min + " TL" : min + "–" + max + " TL") : ""}</span></div>
        <div class="option-dots" role="group" aria-label="Options">${members.map((m, i) => optionDot(editedCard(m), i, i === at, pictures)).join("")}</div>
      </div>
      ${cards.join("")}
    </div>`;
  }

  // pagerKey: "runs" or "uncertain" shows one page of units with a pager above and below; without it every unit is drawn.
  function optionGroupsHtml(list, render, pagerKey) {
    const units = optionGroupUnits(list);
    if (!pagerKey || !units.length) return units.map((slot) => renderOptionUnit(slot, render)).join("");
    const view = pagerView(pagerKey, units.length);
    const cards = units.slice(view.from, view.to).map((slot) => renderOptionUnit(slot, render)).join("");
    return pagerBarHtml(pagerKey, view) + cards + (view.pages > 1 ? pagerBarHtml(pagerKey, view) : "");
  }

  const PAGE_SIZES = [12, 24, 36, 48];
  function loadPageSize() {
    try {
      const stored = localStorage.getItem("admin.pageSize");
      const v = Number(stored);
      if (stored !== null && stored !== "" && (v === 0 || [12, 24, 36, 48].includes(v))) return v;
    } catch (_) { /* storage blocked: the default */ }
    return 24;
  }
  function loadHidePublished() {
    try { return localStorage.getItem("admin.hidePublished") === "1"; } catch (_) { return false; }
  }
  function pagerView(key, total) {
    const size = state.pageSize;
    const pages = size ? Math.max(1, Math.ceil(total / size)) : 1;
    const slot = state.pager[key] || (state.pager[key] = { page: 1 });
    slot.page = Math.min(Math.max(1, Number(slot.page) || 1), pages);
    const from = size ? (slot.page - 1) * size : 0;
    return { total, size, pages, page: slot.page, from, to: size ? Math.min(total, from + size) : total };
  }
  function pagerBarHtml(key, v) {
    if (v.total <= PAGE_SIZES[0]) return "";
    const wanted = new Set([1, v.pages, v.page - 1, v.page, v.page + 1]);
    const nums = [...wanted].filter((n) => n >= 1 && n <= v.pages).sort((a, b) => a - b);
    const buttons = [];
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) buttons.push('<span class="muted">…</span>');
      buttons.push(`<button type="button" class="btn-sm${n === v.page ? "" : " ghost"}" data-pager-page="${n}" ${n === v.page ? 'aria-current="page"' : ""}>${n}</button>`);
    });
    return `<div class="pager" data-pager="${esc(key)}">
      <span class="muted">${v.size ? `Showing ${v.from + 1}–${v.to} of ${v.total}` : `Showing all ${v.total}`} cards</span>
      <label class="muted">Per page <select data-pager-size aria-label="Cards per page">${PAGE_SIZES.map((n) => `<option value="${n}"${v.size === n ? " selected" : ""}>${n}</option>`).join("")}<option value="0"${v.size === 0 ? " selected" : ""}>All</option></select></label>
      ${v.pages > 1 ? `<span class="pager-pages"><button type="button" class="btn-sm ghost" data-pager-page="${v.page - 1}" ${v.page <= 1 ? "disabled" : ""}>‹ Prev</button>${buttons.join("")}<button type="button" class="btn-sm ghost" data-pager-page="${v.page + 1}" ${v.page >= v.pages ? "disabled" : ""}>Next ›</button></span>` : ""}
    </div>`;
  }
  // Redraw the list a pager belongs to and bring its top into view.
  function repaintPager(key) {
    if (key === "runs") repaintRuns();
    else { painted.delete("#tab-uncertain"); paint("#tab-uncertain", uncertainHtml(state.data)); }
    const bar = document.querySelector(`[data-pager="${key}"]`);
    if (bar && typeof bar.scrollIntoView === "function") bar.scrollIntoView({ block: "start" });
  }
  // Redraw the Shop runs tab, keeping what is typed in its start-a-run form.
  function repaintRuns() {
    if (!state.data) return;
    rememberRunRows();
    const max = $("#shop-max") && $("#shop-max").value, llm = $("#run-llm") && $("#run-llm").checked;
    painted.delete("#tab-runs");
    paint("#tab-runs", runsHtml(state.data));
    if ($("#shop-max") && max !== null) $("#shop-max").value = max;
    if ($("#run-llm") && llm !== null) $("#run-llm").checked = llm;
  }
  // A card as it is drawn, whether or not its page is on screen. Fields a card works out when it is drawn (the
  // polymer or variant read from its title, the pack, where it "Goes to") are read from it; a card on another page
  // is drawn off screen for that, once, when you act on it, so it is treated exactly like one on screen.
  function detachedCard(html, selector) {
    if (typeof document.createElement !== "function") return null;
    const box = document.createElement("div");
    box.innerHTML = html;
    return box.querySelector(selector);
  }
  function reviewCardDom(job, ev, url) {
    const live = typeof document.querySelectorAll === "function" ? $$(".review-card").find((el) => el.dataset.uncertainUrl === url) : null;
    return live || (ev && ev.card ? detachedCard(reviewCardHtml(job, ev), ".review-card") : null);
  }

  // A search (when words are typed) draws every card so it can find any of them; no words, one page.
  function setReviewQuery(value) {
    const was = !!String(state.reviewQuery || "").trim();
    state.reviewQuery = value;
    if (was !== !!String(value || "").trim()) { state.pager.runs.page = 1; repaintRuns(); }
    else applyReviewSearch();
  }
  // Tick or untick the cards on screen to match what is selected / flagged (the sets span every page).
  function syncReviewMarks() {
    $$("[data-review-select]").forEach((el) => {
      const on = state.reviewSelected.has(decodeURIComponent(el.dataset.reviewSelect));
      el.checked = on;
      el.closest(".review-card")?.classList.toggle("is-selected", on);
    });
    $$("[data-review-flag]").forEach((el) => {
      const on = state.reviewFlags.has(decodeURIComponent(el.dataset.reviewFlag));
      el.checked = on;
      el.closest(".review-card")?.classList.toggle("flagged", on);
    });
  }

  function showOption(group, i) {
    if (!group) return;
    const key = group.dataset.optionGroup;
    if (!state.optionAt) state.optionAt = new Map();
    state.optionAt.set(key, i);
    group.querySelectorAll(":scope > .opt-member").forEach((el) => el.classList.toggle("opt-hidden", Number(el.dataset.optIndex) !== i));
    group.querySelectorAll("[data-opt-dot]").forEach((d) => { const on = Number(d.dataset.optDot) === i; d.classList.toggle("is-on", on); d.setAttribute("aria-pressed", on ? "true" : "false"); });
  }

  // The colours of one card are one product: linked (the default), what you set on one colour is set on
  // all of them (brand, polymer, variant, weight, diameter, pack, packaging, spool, RFID, Goes to), and
  // Save / Save & publish take them all. Colour, price, picture and URL stay each colour's own. Break the
  // link on a colour that differs (a cardboard spool among plastic ones, a colour of another family).
  const GROUP_FIELDS = ["brand", "subBrand", "polymer", "variant", "weight", "diameter", "bundle", "packCount", "packaging", "spoolMaterial", "rfid"];
  function groupLinked(ev) {
    const c = withEarlierSave((ev && ev.card) || {}) || {};
    const edit = state.uncertainEdit.get(c.url) || {};
    return edit.groupLinked != null ? edit.groupLinked !== false : c.groupLinked !== false;
  }
  function groupLinkButton(linked, size) {
    const others = size - 1;
    return `<div class="group-link"><button type="button" class="btn-sm ghost spool-chain group-chain" data-group-link aria-pressed="${linked ? "true" : "false"}" title="${linked ? "Linked: what you set here is set on the other " + others + " colours, and Save / Save & publish take them all. Break it only for a colour that differs (spool material, another family)." : "Unlinked: this colour keeps its own settings. Click to link it to the other colours again."}" aria-label="${linked ? "Break the link to the other colours" : "Link to the other colours"}">${linked ? CHAIN : CHAIN_BROKEN}</button><small class="muted">${linked ? "Linked with the other " + others + " colour" + (others === 1 ? "" : "s") : "Own settings: not linked to the other colours"}</small></div>`;
  }
  // The cards a Save, Save & publish or edit on this card applies to: itself and its linked colours.
  function linkedMembers(card) {
    const group = card && card.closest && card.closest(".option-group");
    if (!group || card.dataset.groupLinked !== "true") return [card];
    return [...group.querySelectorAll(":scope > .opt-member")].filter((el) => el === card || (el.dataset.groupLinked === "true" && !el.classList.contains("is-held")));
  }
  function copyGroupField(from, to, k) {
    const a = from.querySelector(`[data-uncertain-field="${k}"]`);
    const b = to.querySelector(`[data-uncertain-field="${k}"]`);
    if (!a || !b) return;
    b.value = a.value;
    if (a.hasAttribute("aria-pressed")) b.setAttribute("aria-pressed", a.getAttribute("aria-pressed"));
    const rowA = a.closest(".tag-field") && a.closest(".tag-field").querySelector(".tag-row");
    const rowB = b.closest(".tag-field") && b.closest(".tag-field").querySelector(".tag-row");
    if (rowA && rowB) {
      rowB.querySelectorAll("[data-tag]").forEach((t) => t.remove());
      const add = rowB.querySelector(".tag-new");
      rowA.querySelectorAll("[data-tag]").forEach((t) => add.insertAdjacentHTML("beforebegin", tagChip(t.dataset.tag)));
    }
  }
  // Copies the fields keys from card to its linked colours; returns how many cards followed.
  function syncGroupFields(card, keys) {
    const others = linkedMembers(card).filter((o) => o !== card);
    for (const other of others) {
      for (const k of keys) copyGroupField(card, other, k);
      const f = uncertainFields(other);
      const cur = { ...(state.uncertainEdit.get(other.dataset.uncertainUrl) || {}) };
      for (const k of keys) if (f[k] !== undefined) cur[k] = f[k];
      state.uncertainEdit.set(other.dataset.uncertainUrl, cur);
      refreshAutoPlace(other);
      scheduleAutosave(other);
    }
    return others.length;
  }
  // Goes to, picked by hand on one colour: the same pick on its linked colours.
  function syncGroupPlace(card, place) {
    for (const other of linkedMembers(card).filter((o) => o !== card)) {
      applyPlace(other, other.dataset.uncertainUrl, place);
      unlinkPlace(other, place);
    }
  }

  // ============================================================================================
  // Shop Runs search, built to behave like a web search box:
  //  - every word must match, in any order; partial words work ("bam" finds Bambu)
  //  - typos are forgiven ("bmabu", "sillk"); Turkish letters fold ("siyah" = black, "kırmızı" = red)
  //  - "exact phrase", -exclude, and operators: brand: sub: polymer: variant: color: weight: price:
  //    shop: status: name: url: place: diameter:   e.g.  price:<700  weight:1kg  price:500-800  is:flagged
  //  - best matches first; refinement chips for the cards that are left; "did you mean" on a miss
  // ============================================================================================
  const RS_KEYS = { brand: "brand", marka: "brand", sub: "sub", series: "sub", subbrand: "sub", polymer: "polymer", material: "polymer", type: "polymer", variant: "variant", color: "color", colour: "color", renk: "color", weight: "weight", kg: "weight", size: "weight", price: "price", fiyat: "price", tl: "price", shop: "shop", store: "shop", site: "shop", status: "status", is: "status", name: "name", title: "name", url: "url", place: "place", baseline: "place", goes: "place", diameter: "diameter", mm: "diameter" };
  const RS_SYNONYMS = [["grey", "gray", "gri"], ["siyah", "black"], ["beyaz", "white"], ["kirmizi", "red"], ["mavi", "blue"], ["yesil", "green"], ["sari", "yellow"], ["turuncu", "orange"], ["mor", "purple", "violet"], ["pembe", "pink"], ["kahverengi", "brown"], ["gumus", "silver"], ["altin", "gold"], ["seffaf", "transparent", "clear"], ["yazici", "printer"], ["makarali", "spool"], ["makarasiz", "refill"], ["karbon", "carbon"], ["ahsap", "wood"], ["hiz", "speed"], ["hizli", "speed", "rapid"], ["pla+", "plus"]];
  const RS_ALTS = new Map();
  RS_SYNONYMS.forEach((group) => group.forEach((w) => RS_ALTS.set(w, group)));
  const rsSplit = (text) => adminFold(text).split(/[^\p{L}\p{N}+]+/u).filter(Boolean);

  // Edits between two words, a swap of two neighbours counting as one; gives up past `max`.
  function editDistance(a, b, max) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev2 = null;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev;
      prev = cur;
    }
    return prev[b.length];
  }

  // Everything a person could search a card by, folded and split once.
  const rsIndexCache = { data: null, byUrl: new Map() };
  function reviewIndexOf(ev) {
    const d = state.data;
    if (rsIndexCache.data !== d) { rsIndexCache.data = d; rsIndexCache.byUrl = new Map(); }
    const url = (ev.card && ev.card.url) || "";
    if (rsIndexCache.byUrl.has(url)) return rsIndexCache.byUrl.get(url);
    const c = withEarlierSave(ev.card || {});
    const table = (d && d.filamentColours) || {};
    const filament = cardKind(c) === "filament";
    const colourName = colourNameOf(c) || c.colorName || "";
    const ids = [...new Set([...coloursIn(colourName), ...String(c.colorTone || "").split("+").filter((x) => table[x]), ...String(c.color || "").split("+").filter((x) => table[x])])];
    const grams = gramsOf(weightOf(c)) || (filament ? 1000 : 0);
    const dec = ev.decision || {};
    const place = uncertainPlace(ev);
    const model = place.candidateId ? (((d && d.baseline && d.baseline.items) || []).find((i) => "baseline:" + i.id === place.candidateId) || {}) : {};
    const host = hostOf(c.url) || "";
    const fields = {
      name: [c.name, c.sourceTitle, ...(c.listingTitles || [])].filter(Boolean).join(" "),
      brand: c.brand || "",
      sub: (c.subBrand || "").replace(/,/g, " "),
      polymer: [c.polymer, c.polymer && (((window.__filLabels || {}).polymers || {})[c.polymer])].filter(Boolean).join(" "),
      variant: (c.variant || "").replace(/[-,]/g, " "),
      color: [colourName, c.color, c.colorTone, ...ids.flatMap((id) => [id.replace(/-/g, " "), table[id] && table[id].name, ...(((table[id] && table[id].aliases) || []))])].filter(Boolean).join(" ").replace(/[+]/g, " "),
      weight: grams ? [grams + "g", grams + " g", grams + "gr", grams >= 1000 ? (grams / 1000) + "kg " + (grams / 1000) + " kg" : ""].join(" ") : "",
      shop: host + " " + (ev.shopName || ""),
      url: String(c.url || "").replace(/^https?:\/\//, "").replace(/[-_/.]+/g, " "),
      status: [dec.action, magellanUnsure(ev) ? "unmatched" : "", ev.mismatch || c.mismatch ? "mismatch category" : "", ev.error ? "error blocked " + ev.error : "", Number(c.price) > 0 ? "" : "no price missing", state.reviewSelected.has(c.url) ? "selected" : "", state.reviewFlags.has(c.url) ? "flagged" : "", c.rfid ? "rfid" : "", c.handEdited ? "edited saved" : ""].filter(Boolean).join(" "),
      place: (model.name || "") + " " + (place.candidateId ? "" : "new product"),
      diameter: filament ? diameterValue(c.diameter) + " " + diameterValue(c.diameter).replace(" mm", "mm") : ""
    };
    const words = {};
    let all = [];
    for (const [k, v] of Object.entries(fields)) { words[k] = rsSplit(v); all = all.concat(words[k]); }
    const ix = { c, fields, words, all, allSet: new Set(all), allText: " " + all.join(" ") + " ", keyWords: new Set([...words.name, ...words.brand, ...words.color]), price: Number(c.price) || 0, grams, mm: parseFloat(diameterValue(c.diameter)) || 0, order: 0 };
    rsIndexCache.byUrl.set(url, ix);
    return ix;
  }

  // One word of the query against a list of words: exact > starts with > inside > a typo away.
  function rsWordScore(alts, words, set, text) {
    let best = 0;
    for (const alt of alts) {
      if (!alt) continue;
      if (set.has(alt)) return 3;
      if (alt.length >= 2 && words.some((w) => w.startsWith(alt))) best = Math.max(best, 2);
      else if (alt.length >= 3 && text.includes(alt)) best = Math.max(best, 1.5);
      else if (alt.length >= 4) {
        const max = alt.length >= 8 ? 2 : 1;
        if (words.some((w) => Math.abs(w.length - alt.length) <= max && (editDistance(w, alt, max) <= max || (w.length > alt.length && editDistance(w.slice(0, alt.length), alt, max) <= max)))) best = Math.max(best, 1);
      }
    }
    return best;
  }
  const rsAlts = (term) => { const t = adminFold(term); return RS_ALTS.get(t) || [t]; };

  // 'bambu "pla matte" -wood price:<700 color:"light blue"' → a parsed query.
  function parseReviewQuery(raw) {
    const q = { terms: [], phrases: [], not: [], ops: [] };
    const re = /(-?)(?:([\p{L}]+):)?(?:"([^"]*)"|(\S+))/gu;
    let m;
    while ((m = re.exec(String(raw || "")))) {
      const neg = m[1] === "-";
      const key = m[2] && RS_KEYS[adminFold(m[2])];
      const val = (m[3] != null ? m[3] : m[4] || "").trim();
      if (!val) continue;
      if (key) q.ops.push({ key, val, neg });
      else if (m[2] && !key) q.terms.push(...rsSplit(m[2] + ":" + val).map((t) => ({ t })));
      else if (neg) q.not.push(val);
      else if (m[3] != null) q.phrases.push(adminFold(val));
      else q.terms.push(...rsSplit(val).map((t) => ({ t })));
    }
    return q;
  }
  // "<700", ">=500", "500-800", "700" → a test on a number
  function rsNumberTest(val, unit) {
    const m = String(val).replace(",", ".").match(/^(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?\s*(kg|gr|g|mm|tl)?$/i);
    if (!m) return null;
    const scale = (n, u) => (unit === "grams" ? (/^kg$/i.test(u || "") || (!u && n <= 20) ? n * 1000 : n) : n);
    const a = scale(Number(m[2]), m[4]);
    if (m[3] != null) { const b = scale(Number(m[3]), m[4]); return (x) => x >= Math.min(a, b) && x <= Math.max(a, b); }
    if (m[1] === "<") return (x) => x < a;
    if (m[1] === "<=") return (x) => x <= a;
    if (m[1] === ">") return (x) => x > a;
    if (m[1] === ">=") return (x) => x >= a;
    return (x) => Math.abs(x - a) < 0.5 || Math.floor(x) === Math.floor(a);
  }

  // null = does not match; otherwise a relevance score (more is better).
  function scoreReview(ix, q, relaxed) {
    let score = 0;
    for (const op of q.ops) {
      let ok;
      if (op.key === "price") { const t = rsNumberTest(op.val); ok = t ? ix.price > 0 && t(ix.price) : false; }
      else if (op.key === "weight") { const t = rsNumberTest(op.val, "grams"); ok = t ? ix.grams > 0 && t(ix.grams) : rsWordScore(rsAlts(op.val), ix.words.weight, new Set(ix.words.weight), " " + ix.words.weight.join(" ") + " ") > 0; }
      else if (op.key === "diameter") { const t = rsNumberTest(op.val); ok = t ? ix.mm > 0 && t(ix.mm) : false; }
      else {
        const words = ix.words[op.key] || [];
        const phrase = adminFold(op.val);
        ok = op.val.includes(" ") || /\s/.test(op.val)
          ? (" " + words.join(" ") + " ").includes(" " + phrase + " ") || (" " + words.join(" ") + " ").includes(phrase)
          : rsWordScore(rsAlts(op.val), words, new Set(words), " " + words.join(" ") + " ") > 0;
      }
      if (op.neg ? ok : !ok) return null;
      if (!op.neg) score += 3;
    }
    for (const w of q.not) if (rsWordScore(rsAlts(w).map((x) => x), ix.all, ix.allSet, ix.allText) >= 1.5) return null;
    for (const p of q.phrases) { if (!ix.allText.includes(p.replace(/\s+/g, " "))) return null; score += 4; }
    let hit = 0;
    for (const { t } of q.terms) {
      const bare = t.match(/^(\d+(?:\.\d+)?)(kg|gr|g|gram|kilo)$/);
      let s = 0;
      if (bare) { const g = Math.round(Number(bare[1]) * (/^k/.test(bare[2]) ? 1000 : 1)); s = ix.grams && g === ix.grams ? 3 : 0; }
      if (!s) s = rsWordScore(rsAlts(t), ix.all, ix.allSet, ix.allText);
      if (!s && /^\d+$/.test(t)) s = ix.price && Math.floor(ix.price) === Number(t) ? 2 : 0;
      if (s) { hit += 1; score += s + (rsAlts(t).some((a) => ix.keyWords.has(a)) ? 0.5 : 0); }
    }
    const need = relaxed ? Math.max(1, Math.ceil(q.terms.length / 2)) : q.terms.length;
    if (hit < need) return null;
    // Words that sit next to each other in the title, in the order typed, beat a scatter of matches.
    if (q.terms.length > 1 && ix.fields.name) {
      const name = " " + rsSplit(ix.fields.name).join(" ") + " ";
      if (name.includes(" " + q.terms.map((x) => adminFold(x.t)).join(" "))) score += 2;
    }
    return score;
  }

  // The closest word the run actually contains, for "did you mean".
  function rsVocabulary(indexes) {
    const v = new Map();
    for (const ix of indexes) for (const w of ix.allSet) if (w.length >= 3 && !/^\d/.test(w)) v.set(w, (v.get(w) || 0) + 1);
    return v;
  }
  function rsDidYouMean(q, raw, indexes) {
    const vocab = rsVocabulary(indexes);
    let changed = false;
    let fixed = String(raw);
    for (const { t } of q.terms) {
      if (t.length < 4 || vocab.has(t) || [...vocab.keys()].some((w) => w.startsWith(t))) continue;
      let best = null;
      for (const [w, n] of vocab) {
        const dist = editDistance(w, t, 2);
        if (dist <= 2 && (!best || dist < best.dist || (dist === best.dist && n > best.n))) best = { w, dist, n };
      }
      if (best) { fixed = fixed.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), best.w); changed = true; }
    }
    return changed && fixed !== raw ? fixed : "";
  }

  function tokenInQuery(raw, token) { return String(raw || "").split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).includes(token); }

  function applyReviewSearch() {
    if (typeof document.getElementById !== "function" || !document.getElementById("review-board")) return;
    const board = document.getElementById("review-board");
    const info = document.getElementById("review-search-info");
    const chips = document.getElementById("review-search-chips");
    if (!board) return;
    const cards = Array.from(board.querySelectorAll(".review-card"));
    const raw = (state.reviewQuery || "").trim();
    // While searching, every option of a product is its own card again, found and ranked on its own.
    board.classList.toggle("is-searching", !!raw);
    if (!raw) {
      cards.forEach((el) => { el.hidden = false; el.style.order = ""; });
      if (info) info.innerHTML = "";
      if (chips) chips.innerHTML = "";
      return;
    }
    const job = reviewJob(state.data || { jobs: [] });
    const events = new Map(collectCards(job, state.data).map((ev) => [ev.card && ev.card.url, ev]));
    const q = parseReviewQuery(raw);
    const indexed = cards.map((el) => ({ el, ev: events.get(el.dataset.uncertainUrl) })).filter((x) => x.ev).map((x) => ({ ...x, ix: reviewIndexOf(x.ev) }));
    let relaxed = false;
    let scored = indexed.map((x) => ({ ...x, score: scoreReview(x.ix, q, false) }));
    if (!scored.some((x) => x.score != null) && q.terms.length > 1) { relaxed = true; scored = indexed.map((x) => ({ ...x, score: scoreReview(x.ix, q, true) })); }
    const shown = scored.filter((x) => x.score != null).sort((a, b) => b.score - a.score);
    const rank = new Map(shown.map((x, i) => [x.el, i]));
    cards.forEach((el) => { const r = rank.get(el); el.hidden = r == null; el.style.order = r == null ? "" : String(r); });
    const dym = shown.length ? "" : rsDidYouMean(q, raw, indexed.map((x) => x.ix));
    if (info) {
      info.innerHTML = `<strong>${shown.length}</strong> of ${cards.length} cards${relaxed && shown.length ? " · no card has every word, showing the closest" : ""}${!shown.length ? ' · nothing matches' : ""}${dym ? ` · Did you mean <a href="#" data-review-search-set="${esc(dym)}">${esc(dym)}</a>?` : ""}`;
    }
    // Refinements drawn from the cards that are left: one click narrows the search further.
    if (chips) {
      const groups = [["brand", (ix) => ix.c.brand], ["polymer", (ix) => ix.c.polymer], ["color", (ix) => colourNameOf(ix.c)], ["shop", (ix) => hostOf(ix.c.url)], ["status", (ix) => (ix.fields.status.match(/\b(held|merge|create|unmatched|mismatch|flagged|selected)\b/) || [])[0]]];
      const html = groups.map(([key, get]) => {
        const count = new Map();
        shown.forEach((x) => { const v = String(get(x.ix) || "").trim(); if (v) count.set(v, (count.get(v) || 0) + 1); });
        const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
        if (top.length < 2) return "";
        return `<span class="rs-chip-label">${key}</span>` + top.map(([v, n]) => { const token = `${key}:${/\s/.test(v) ? `"${v}"` : v}`; const on = tokenInQuery(raw, token); return `<button type="button" class="rs-chip${on ? " is-on" : ""}" data-review-search-token="${esc(token)}" title="${on ? "remove" : "add"} ${esc(token)}">${esc(v)} <em>${n}</em></button>`; }).join("");
      }).join("");
      chips.innerHTML = html;
    }
  }
  let reviewSearchTimer = null;

  function updateReviewToolbar() {
    const pub = $("#publish-selected");
    if (pub) {
      const n = state.reviewSelected.size;
      pub.disabled = !n;
      pub.textContent = "Save & publish selected (" + n + ")";
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
        <p class="muted">The PC worker renders product pages, waits for JavaScript buy controls, and leaves out vendors that are out of stock. ${withUrl.length} offers: ${dead} out of stock, ${unknown} unverified, ${stale} older than 6h.</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn-sm primary" type="button" id="check-stock">Check stock now (${stale} stale)</button>
          <button class="btn-sm ghost" type="button" id="check-stock-all">Check every offer (${withUrl.length})</button>
          <small class="muted" id="stock-result"></small>
        </div>
      </div>`;
  }

  function baselineHtml(d) {
    const board = d.baseline || { categories: [{ id: "printers", name: "3D Printers" }], items: [] };
    const cats = board.categories && board.categories.length ? board.categories : [{ id: "printers", name: "3D Printers" }];
    const queryTokens = adminFold(state.baselineQuery || "").replace(/\+/g, " plus ").split(/[^a-z0-9]+/).filter(Boolean);
    const selectedCategory = cats.some((c) => c.id === state.baselineCategory) ? state.baselineCategory : "";
    const shownCats = selectedCategory ? cats.filter((c) => c.id === selectedCategory) : cats;
    const all = board.items || [];
    const parentIds = new Set(all.map((it) => it.id).filter(Boolean));
    const families = all.filter((it) => it.entityType === "family" || !it.parentId);
    // parentId is the durable relationship; entityType was added later and is
    // absent from some older live baseline rows.
    const isChild = (it) => Boolean(
      (it.parentId && parentIds.has(it.parentId))
      || (it.entityType === "sku")
      || families.some((parent) => parent.id !== it.id && adminFold(it.name).startsWith(adminFold(parent.name) + " "))
    );
    const topLevel = all.filter((it) => !isChild(it));
    const childrenByParent = new Map();
    for (const row of all) {
      if (!isChild(row) || !row.parentId) continue;
      const rows = childrenByParent.get(row.parentId) || [];
      rows.push(row);
      childrenByParent.set(row.parentId, rows);
    }
    const childrenOf = (it) => childrenByParent.get(it.id) || [];
    const searchable = (it) => [it.name, it.brand, it.toolSystem, it.motionType, it.packaging, it.reinforcement,
      it.buildVolumeX, it.buildVolumeY, it.buildVolumeZ, ...childrenOf(it).flatMap((row) => [row.name, row.color, row.weight])].join(" ");
    const match = (it) => (!selectedCategory || (it.category || "printers") === selectedCategory)
      && (!queryTokens.length || queryTokens.every((token) => adminFold(searchable(it)).replace(/\+/g, " plus ").includes(token)));
    return `<div class="panel">
      <h2>Baseline</h2>
      <p class="muted">Your models only. A shop run never writes here. Add one with the button on an Uncertain card, or by branching an offer into its own product in the catalog. You can also add a model on this page.</p>
      <div class="baseline-duplicate-tools"><button type="button" class="btn-sm primary" id="save-all-baseline" ${baselinePendingIds().length ? "" : "disabled"}>Save all baseline changes${baselinePendingIds().length ? " (" + baselinePendingIds().length + ")" : ""}</button><button type="button" class="btn-sm ghost" id="find-baseline-duplicates">Find duplicate baseline cards</button></div>
      <div id="baseline-duplicate-result">${baselineDuplicateHtml(topLevel, cats, all, childrenByParent)}</div>
      <div class="baseline-nav">
        <label>Category
          <select id="baseline-category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c.id)}" ${selectedCategory === c.id ? "selected" : ""}>${esc(c.name)} (${topLevel.filter((it) => (it.category || "printers") === c.id).length})</option>`).join("")}</select>
        </label>
        <label>Search
          <input id="baseline-q" type="search" placeholder="Search this category…" value="${esc(state.baselineQuery || "")}">
        </label>
      </div>
      <datalist id="baseline-filament-packaging"><option value="Spool"><option value="Spoolless"><option value="Refill"></datalist>
      <datalist id="baseline-filament-reinforcement"><option value="Plain polymer"><option value="Carbon fiber (CF)"><option value="Glass fiber (GF)"><option value="Aramid / Kevlar"><option value="Mineral filled"><option value="Wood filled"><option value="Metal filled"></datalist>
      ${recommendationHtml(d)}
      <div class="form-row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
        <input id="baseline-new-cat" type="text" placeholder="New category name" style="min-width:180px">
        <button type="button" class="btn-sm" id="baseline-add-cat">Add category</button>
        <input id="baseline-new-name" type="text" placeholder="New model name" style="min-width:180px">
        <input id="baseline-new-brand" type="text" placeholder="Brand" style="min-width:120px">
        <select id="baseline-new-parent">${cats.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select>
        <button type="button" class="btn-sm" id="baseline-add-item">Add model</button>
      </div>
      <p class="muted">${topLevel.filter(match).length} shown · ${topLevel.length} models · ${cats.length} categories</p>
      ${shownCats.map((c) => {
        const items = topLevel.filter((it) => (it.category || "printers") === c.id && match(it));
        return `<details class="baseline-cat" ${detailAttrs("bcat-" + c.id)} open>
          <summary><strong>${esc(c.name)}</strong> <span class="muted">${items.length}</span></summary>
          <div class="form-row" style="flex-wrap:wrap;gap:8px;margin:8px 0">
            <input data-baseline-cat-name="${esc(c.id)}" type="text" value="${esc(c.name)}" aria-label="Category name">
            <button type="button" class="btn-sm" data-baseline-cat-save="${esc(c.id)}">Save category</button>
          </div>
          <div class="catalog-results">${items.map((it) => baselineCard(it, cats, all, childrenByParent)).join("") || '<p class="muted">No models in this category.</p>'}</div>
        </details>`;
      }).join("")}
    </div>`;
  }

  function baselineDuplicateHtml(items, cats, allItems, childrenByParent) {
    if (!state.baselineDupes) return "";
    if (!state.baselineDupes.length) return '<p class="muted">No duplicate baseline cards found.</p>';
    return `<div class="baseline-duplicates"><strong>Duplicate pairs</strong><p class="muted">Compare each pair and remove the unwanted card.</p>${state.baselineDupes.map((group) => `<div class="baseline-duplicate-group">${group.map((it) => baselineCard(it, cats, allItems, childrenByParent)).join("")}</div>`).join("")}</div>`;
  }

  function recommendationHtml(d) {
    const items = (d.recommendations && d.recommendations.items) || [];
    return `<div class="panel" style="margin:12px 0;background:#f8fafc">
      <h3 style="margin-top:0">Recommended by the worker</h3>
      <p class="muted">New products the worker would add. They stay off the baseline until you confirm one.</p>
      ${items.length ? items.map((it) => `<div class="product-card baseline-card" data-rec-id="${esc(it.id)}">
        <div class="catalog-thumb">${it.image ? productImg(it.image) : '<div class="catalog-thumb-empty"></div>'}</div>
        <strong>${esc(it.name)}</strong>
        <p class="muted">${esc(it.brand || "No brand")} · ${esc(it.site || "shop")}</p>
        <p class="muted">${esc(it.reason || "")}</p>
        ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer">open ↗</a>` : ""}
        <div class="actions">
          <button class="btn-sm primary" type="button" data-rec-confirm="${esc(it.id)}">Add to baseline</button>
          <button class="btn-sm ghost" type="button" data-rec-dismiss="${esc(it.id)}">Dismiss</button>
        </div>
      </div>`).join("") : '<p class="muted">Nothing waiting. A shop run that finds a product you do not already have will leave it here.</p>'}
    </div>`;
  }

  // ponytail: extra sub-brands / variants ride in the same string field, comma-joined — no schema change.
  // First value stays in the original input; the rest render as tag chips beside a "+" button.
  function splitTags(v) { return String(v || "").split(",").map((s) => s.trim()).filter(Boolean); }
  function tagChip(t) { return `<span class="tag-chip" data-tag="${esc(t)}">${esc(t)}<button type="button" data-tag-remove aria-label="Remove ${esc(t)}">×</button></span>`; }
  function tagField(fieldHtml, extras, list) {
    return `<div class="tag-field">${fieldHtml}<div class="tag-row">${extras.map(tagChip).join("")}<input class="tag-new" list="${list}" aria-label="Add another" placeholder="Add another…"><button type="button" class="btn-sm ghost" data-tag-add aria-label="Add">+</button></div></div>`;
  }
  function tagFieldValue(el) {
    if (!el) return undefined;
    const extras = [...(el.closest?.(".tag-field")?.querySelectorAll("[data-tag]") || [])].map((t) => t.dataset.tag);
    return extras.length ? [el.value.trim(), ...extras].filter(Boolean).join(", ") : el.value;
  }
  function addTagsFrom(row) {
    const input = row.querySelector(".tag-new");
    for (const t of splitTags(input.value)) input.insertAdjacentHTML("beforebegin", tagChip(t));
    input.value = "";
    row.closest(".tag-field").querySelector("[data-baseline-field],[data-uncertain-field]").dispatchEvent(new Event("input", { bubbles: true }));
  }

  // Colour dot + "From image": named colours and their hex come from data/filament-taxonomy.json.
  // Weight: stored as grams ("1000 g"), shown as grams under 1 kg and as kg from 1 kg up.
  // Same parser as api/filament-classify.js gramsFromText (thousands separators, 50 g – 20 kg sanity).
  function gramsOf(value) {
    const re = /(\d+(?:[.,]\d+)?)\s*(kilogram|kilo|kgs?|grams?|gr|g)(?![\p{L}\p{N}])/giu;
    for (const m of String(value || "").matchAll(re)) {
      const kg = /^k/i.test(m[2]);
      const num = !kg && /^\d{1,3}[.,]\d{3}$/.test(m[1]) ? Number(m[1].replace(/[.,]/, "")) : Number(m[1].replace(",", "."));
      const grams = Math.round(num * (kg ? 1000 : 1));
      if (grams >= 50 && grams <= 20000) return grams;
    }
    return 0;
  }
  function weightLabel(value) {
    const g = gramsOf(value);
    if (!g) return String(value || "");
    return g >= 1000 ? String(Math.round(g / 10) / 100) + " kg" : g + " g";
  }
  // Older cards may lack a weight; the titles they were seen under and the URL slug often carry it.
  function weightOf(c) {
    for (const t of [c.weight, c.sourceTitle, ...(c.listingTitles || []), c.name, String(c.url || "").replace(/[-_/]+/g, " ")]) {
      const g = gramsOf(t);
      if (g) return g + " g";
    }
    return "";
  }

  // Colour code for any written colour: the longest known name/alias inside it ("Dark Red" → red).
  function colourId(value) {
    const words = titleWords(value);
    let best = "", len = 0;
    for (const [id, c] of Object.entries((state.data && state.data.filamentColours) || {})) {
      for (const a of [id, c.name, ...(c.aliases || [])]) {
        const w = titleWords(a);
        if (w.trim() && w.length > len && words.includes(w)) { best = id; len = w.length; }
      }
    }
    return best;
  }
  function colourHex(value) {
    const v = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v;
    const row = ((state.data && state.data.filamentColours) || {})[colourId(v)];
    return row ? row.hex : "";
  }
  // Older runs cut only part of a colour tail ("… - Dark Red" became "… - Dark"). When an earlier title
  // ends in " - <colour>", its head is the clean product line.
  function listingName(c) {
    const name = c.name || "";
    for (const t of [c.sourceTitle, ...(c.listingTitles || [])].filter(Boolean)) {
      const parts = String(t).split(/\s+[-–—|]\s+/);
      if (parts.length < 2 || !colourId(parts[parts.length - 1])) continue;
      const head = parts.slice(0, -1).join(" - ").trim();
      if (adminFold(name).startsWith(adminFold(head))) return head;
    }
    return name;
  }

  // The colour as the listing wrote it. New runs store it (colorName); older cards get it back from the
  // titles they were seen under: a " - Dark Red" tail first, else the matching alias as written.
  function colourNameOf(c) {
    // Runs before the tail fix stored "Black 1Kg": drop weight / diameter from a stored name too.
    const stored = String(c.colorName || "").replace(/(?:^|\s)\d+(?:[.,]\d+)?\s*(?:kilogram|kilo|kgs?|grams?|gr|g|mm)(?=\s|$)/giu, " ").replace(/\s+/g, " ").trim();
    if (stored) return stored;
    const titles = [c.sourceTitle, ...(c.listingTitles || []), c.name].filter(Boolean);
    for (const t of titles) {
      const parts = String(t).split(/\s+[-–—|]\s+/);
      // "Black 1Kg": weight and diameter share the tail but are not the colour.
      const tail = parts.length > 1 ? parts[parts.length - 1].replace(/(?:^|\s)\d+(?:[.,]\d+)?\s*(?:kilogram|kilo|kgs?|grams?|gr|g|mm)(?=\s|$)/giu, " ").replace(/\s+/g, " ").trim() : "";
      if (tail && colourId(tail)) return tail;
    }
    const row = ((state.data && state.data.filamentColours) || {})[c.color];
    for (const a of ((row && row.aliases) || []).slice().sort((x, y) => y.length - x.length)) {
      if (titles.some((t) => titleWords(t).includes(titleWords(a)))) return a;
    }
    // Multicolour: the colourway the title names ("Rainbow Spring Lake" → Spring Lake), and never a
    // single colour that only came from the photo (the cardboard spool read as "light brown").
    if (isMultiTitle(titles)) return multiColourName(titles.join(" ")) || "";
    return row ? row.name : (c.color || "");
  }
  const MULTI_TITLE_RE = /\b(?:dual|tri|multi)[\s-]*(?:colou?r|renk)|\b\d\s*renkli\b|\b(?:çift|cift|üç|uc)\s*renk|\brainbow\b|\bgradi(?:ent|yan)\b|g[öo]kku[şs]a[ğg]|\bco-?extru/i;
  function isMultiTitle(titles) { return MULTI_TITLE_RE.test(titles.filter(Boolean).join(" ")); }
  // Mirrors api/filament-classify.js multiColourName.
  function multiColourName(value) {
    const m = String(value || "").match(/\b(?:rainbow|gradient|gradyan|multicolou?r|(?:dual|tri|multi)[\s-]*(?:colou?r|renk)|\d\s*renkli)\s+(.+?)(?=\s+(?:filament|filaman|\d)|\s*$)/i);
    const name = m ? m[1].trim() : "";
    return name && !/\b(?:pla\+?|petg|abs|asa|tpu|pctg|silk|matte|hyper|speed|filament)\b/i.test(name) ? name : "";
  }
  // One colour, a split dot for dual / tri colour, or a rainbow for gradients with no named colours.
  const RAINBOW = "conic-gradient(#e53935, #fb8c00, #fdd835, #43a047, #1e88e5, #8e24aa, #e53935)";
  function colourDot(hex, fx) {
    const list = Array.isArray(hex) ? hex.filter(Boolean) : [];
    const fill = list.length > 1 ? "conic-gradient(" + list.map((h, i) => `${h} ${Math.round(i * 100 / list.length)}% ${Math.round((i + 1) * 100 / list.length)}%`).join(", ") + ")"
      : list.length === 1 ? list[0] : hex === "rainbow" ? RAINBOW : Array.isArray(hex) ? "" : hex;
    return `<span class="colour-dot${fill ? "" : " is-empty"}${fx === "marble" || fx === "galaxy" ? " fx-" + fx : ""}" style="--dot:${esc(fill || "transparent")}" title="${esc((list.join(" · ") || (hex === "rainbow" ? "Multicolour" : hex) || "No colour yet") + (fx ? " · " + fx : "") + " · double-click for marble / galaxy")}"></span>`;
  }
  // Every named colour in a colour name, longest first ("Rose Dark Blue Green" → rose, dark-blue, green).
  function coloursIn(value) {
    let rest = titleWords(value);
    const table = (state.data && state.data.filamentColours) || {};
    const names = Object.entries(table).flatMap(([id, c]) => [id, c.name, ...(c.aliases || [])].map((a) => ({ id, w: titleWords(a) })))
      .filter((x) => x.w.trim()).sort((a, b) => b.w.length - a.w.length);
    const out = [];
    for (const { id, w } of names) {
      if (rest.includes(w)) { out.push(id); rest = rest.replace(w, " "); }
    }
    return [...new Set(out)];
  }
  // A card's colour state: the colours (one per slot), the shade picked for each slot, and a finish.
  // It lives on the .colour-row element so the eyedropper, minus, finish menu and autosave share it.
  const MARBLE_RE = /\bmarble\b|\bmermer\b/i;
  const GALAXY_RE = /\bgalaxy\b|\bglitter\b|\bsparkle\b|\bsimli\b|\bgalaksi\b/i;
  function cardColour(c, edit, name) {
    const ids = coloursIn(name);
    const own = edit.colorSet != null ? edit.colorSet : edit.colorName == null && Array.isArray(c.colorSet) && c.colorSet.length ? c.colorSet : null;
    // A multicolour card never falls back to the single stored colour: that one came from the photo.
    const multiCard = isMultiTitle([c.sourceTitle, ...(c.listingTitles || []), c.name]);
    const found = own || (ids.length ? ids : !multiCard && c.color && ((state.data && state.data.filamentColours) || {})[c.color] ? [c.color] : []);
    // Number the colours the way the name reads them: "Rose Dark Blue Green" → 1 rose, 2 dark blue, 3 green.
    const table = (state.data && state.data.filamentColours) || {};
    const words = titleWords(name);
    const at = (id) => Math.min(...[id, table[id] && table[id].name, ...((table[id] && table[id].aliases) || [])].filter(Boolean)
      .map((a) => words.indexOf(titleWords(a))).map((i) => (i < 0 ? 1e9 : i)));
    const set = [...found].sort((x, y) => at(x) - at(y));
    const hexes = edit.colorHexes || (edit.colorName == null && (c.colorHexes || (c.colorHex ? [c.colorHex] : []))) || (edit.colorHex ? [edit.colorHex] : []);
    const titles = [c.sourceTitle, ...(c.listingTitles || []), c.name, name].join(" ");
    const fx = edit.colorEffect != null ? edit.colorEffect : c.colorEffect != null ? c.colorEffect : MARBLE_RE.test(titles) ? "marble" : GALAXY_RE.test(titles) ? "galaxy" : "";
    const rainbow = !set.length && !!(c.multicolor || /rainbow|gradi|renkli|dual|tri colou?r|multicolou?r/i.test(titles));
    return { set, hexes: edit.colorHex && !edit.colorHexes ? [edit.colorHex] : hexes, fx, rainbow };
  }
  function colourFill(st) {
    const table = (state.data && state.data.filamentColours) || {};
    if (st.set.length > 1) return st.set.map((id, i) => st.hexes[i] || (table[id] && table[id].hex));
    if (st.hexes[0]) return st.hexes[0];
    if (st.set.length === 1) return table[st.set[0]] ? table[st.set[0]].hex : "";
    return st.rainbow ? "rainbow" : "";
  }
  function rowColour(row) {
    const list = (v) => String(v || "").split(",").filter((x, i, all) => x || i < all.length - 1);
    return { set: String(row.dataset.set || "").split(",").filter(Boolean), hexes: list(row.dataset.hexes), fx: row.dataset.fx || "", rainbow: row.dataset.rainbow === "1", slot: Number(row.dataset.slot) || 0 };
  }
  function colourRowAttrs(st) {
    return `data-set="${esc(st.set.join(","))}" data-hexes="${esc(st.hexes.join(","))}" data-fx="${esc(st.fx)}" data-rainbow="${st.rainbow ? "1" : ""}" data-slot="0"`;
  }
  // Redraw the dot, the eyedropper's colour number and the minus button from the row's state.
  function paintColourRow(row, st) {
    row.dataset.set = st.set.join(",");
    row.dataset.hexes = st.hexes.join(",");
    row.dataset.fx = st.fx;
    row.dataset.slot = String(st.slot || 0);
    row.querySelector(".colour-dot").outerHTML = colourDot(colourFill(st), st.fx);
    const droppers = row.querySelector(".droppers");
    if (droppers) droppers.innerHTML = dropperButtons(st);
    const note = row.closest(".colour-field") && row.closest(".colour-field").querySelector(".colour-tone");
    if (note) note.outerHTML = toneNote(autoTone(st));
    const minus = row.querySelector("[data-colour-minus]");
    if (minus) minus.hidden = st.set.length < 2;
    const plus = row.querySelector("[data-colour-plus]");
    if (plus) plus.hidden = st.set.length >= 6;
  }
  // Same voting as the worker's colourFromPixels (lib/image-match.cjs): each pixel votes for its nearest
  // named colour; a winner needs 30 useful pixels and 38% of the vote. Pass 1 ignores white/grey/dark
  // pixels (usually background); pass 2 only drops near-white so black, white and grey spools still read.
  // The returned hex is the average of the winning pixels, which is what the dot shows.
  // "Which named colour does this look like?" — measured the way eyes see it (CIE Lab, ΔE 2000), not as
  // raw RGB distance, which called a deep purple "dark grey" and teal "slate grey".
  function hexLab(rgb) {
    const [r, g, b] = rgb.map((v) => { v /= 255; return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92; });
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function deltaE(p, q) {
    const [L1, a1, b1] = p, [L2, a2, b2] = q, rad = Math.PI / 180;
    const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
    const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
    const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
    const C1 = Math.hypot(a1p, b1), C2 = Math.hypot(a2p, b2);
    const hue = (x, y) => { const d = Math.atan2(y, x) / rad; return d < 0 ? d + 360 : d; };
    const h1 = hue(a1p, b1), h2 = hue(a2p, b2);
    let dh = h2 - h1;
    if (C1 * C2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * rad);
    const Lm = (L1 + L2) / 2, Cp = (C1 + C2) / 2;
    let hm = h1 + h2;
    if (C1 * C2 !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2 : (h1 + h2) / 2;
    const T = 1 - 0.17 * Math.cos((hm - 30) * rad) + 0.24 * Math.cos(2 * hm * rad) + 0.32 * Math.cos((3 * hm + 6) * rad) - 0.2 * Math.cos((4 * hm - 63) * rad);
    const SL = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2), SC = 1 + 0.045 * Cp, SH = 1 + 0.015 * Cp * T;
    const RT = -2 * Math.sqrt(Cp ** 7 / (Cp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
    const dL = (L2 - L1) / SL, dC = (C2 - C1) / SC, dHs = dH / SH;
    return Math.sqrt(dL * dL + dC * dC + dHs * dHs + RT * dC * dHs);
  }
  // "Transparent …" and "Clear" describe see-through plastic, not a hue, so they are never a look-alike.
  function namedLabs(table) {
    return Object.entries(table || {}).filter(([id]) => !/^(?:transparent|clear|translucent)/.test(id)).map(([id, c]) => ({ id, name: c.name, rgb: [1, 3, 5].map((i) => parseInt(String(c.hex).slice(i, i + 2), 16)) }))
      .filter((r) => r.rgb.every(Number.isFinite)).map((r) => ({ ...r, lab: hexLab(r.rgb) }));
  }
  function nearestNamed(rgb, named) {
    const lab = hexLab(rgb);
    let best = null;
    for (const r of named) {
      const d = deltaE(lab, r.lab);
      if (!best || d < best.d) best = { id: r.id, name: r.name, d };
    }
    return best;
  }

  function colourFromPixels(data, table) {
    const named = namedLabs(table);
    // Photos repeat colours: remember the answer per (slightly rounded) pixel colour.
    const seen = new Map();
    const vote = (chromaticOnly) => {
      const votes = new Map();
      let useful = 0;
      for (let i = 0; i + 3 < data.length; i += 4) {
        const rgb = [data[i], data[i + 1], data[i + 2]];
        const hi = Math.max(...rgb), lo = Math.min(...rgb);
        if (data[i + 3] < 200 || lo > 235) continue;
        if (chromaticOnly && (hi > 245 || hi - lo < 35 || hi < 35)) continue;
        const key = (rgb[0] >> 2) << 12 | (rgb[1] >> 2) << 6 | (rgb[2] >> 2);
        let best = seen.get(key);
        if (best === undefined) { best = nearestNamed(rgb, named); seen.set(key, best); }
        // ΔE over 30: not close to any named colour, so this pixel does not vote.
        if (!best || best.d > 30) continue;
        useful += 1;
        const v = votes.get(best.id) || { n: 0, sum: [0, 0, 0] };
        v.n += 1;
        v.sum = v.sum.map((x, k) => x + rgb[k]);
        votes.set(best.id, v);
      }
      const top = [...votes].sort((a, b) => b[1].n - a[1].n)[0];
      if (!top || useful < 30 || top[1].n / useful < 0.38) return null;
      return { color: top[0], confidence: top[1].n / useful, hex: "#" + top[1].sum.map((x) => Math.round(x / top[1].n).toString(16).padStart(2, "0")).join("") };
    };
    return vote(true) || vote(false);
  }
  // The colour NAME always comes from the listing ("Desert Tan"). The eyedropper / Image only record a
  // tone: the nearest named colour (beige) plus the exact pixel colour for the dot. Search uses the tone
  // quietly, so "bambu lab pla beige" shows Desert Tan right after the real Beige.
  function toneName(id) {
    return String(id || "").split("+").filter(Boolean).map((one) => {
      const row = ((state.data && state.data.filamentColours) || {})[one];
      return row ? row.name : one;
    }).join(" + ");
  }
  function toneNote(id) {
    return `<small class="colour-tone muted">${id ? "Looks " + esc(toneName(id)) + " (for search)" : ""}</small>`;
  }
  // The internal colour is always a plain everyday name, whatever the maker calls it ("Desert Tan" →
  // beige, "Indigo Purple" → purple). Decided by how the colour looks (CIE LCh): dull colours are
  // black / gray / white by lightness, pale warm ones beige, dark warm ones brown, the rest by hue.
  function basicColour(hex) {
    const rgb = [1, 3, 5].map((i) => parseInt(String(hex || "").slice(i, i + 2), 16));
    if (!rgb.every(Number.isFinite)) return "";
    const [L, a, b] = hexLab(rgb);
    const C = Math.hypot(a, b);
    let h = Math.atan2(b, a) * 180 / Math.PI;
    if (h < 0) h += 360;
    // Warm off-whites (a "Beige" spool photographed pale) are beige, not grey; the very lightest are white.
    if (L >= 75 && L <= 92 && C >= 4 && C < 32 && h >= 40 && h < 110) return "beige";
    if (C < 8) return L < 20 ? "black" : L > 82 ? "white" : "gray";
    if (L < 18 && C < 25) return "black";
    if (L > 85 && C < 15) return "white";
    if (L >= 68 && C < 32 && h >= 50 && h < 110) return "beige";
    if (L < 58 && C <= 45 && h >= 20 && h < 90) return "brown";
    if (C < 15) return L < 20 ? "black" : L > 85 ? "white" : "gray";
    if (h < 25 || h >= 345) return "pink";
    if (h < 50) return "red";
    if (h < 70) return "orange";
    if (h < 105) return "yellow";
    if (h < 185) return "green";
    if (h < 225) return "cyan";
    if (h < 300) return "blue";
    return "purple";
  }
  // Every colour of the spool, in order, as plain names: "blue", "white+cyan+blue".
  function autoTone(st) {
    const table = (state.data && state.data.filamentColours) || {};
    const hexes = st.set.length ? st.set.map((id, i) => st.hexes[i] || (table[id] && table[id].hex)) : st.hexes.slice(0, 1);
    return [...new Set(hexes.map(basicColour).filter(Boolean))].join("+");
  }
  // One eyedropper per colour: button N always sets colour N (with a swatch of what it holds now).
  const DROPPER_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M20.7 5.6l-2.3-2.3a1 1 0 0 0-1.4 0l-3.1 3.1-1.9-1.9-1.4 1.4 1.4 1.4L4 15.3V20h4.7l8-8 1.4 1.4 1.4-1.4-1.9-1.9 3.1-3.1a1 1 0 0 0 0-1.4zM7.9 18H6v-1.9l7.9-7.9 1.9 1.9L7.9 18z"/></svg>';
  function dropperButtons(st) {
    const table = (state.data && state.data.filamentColours) || {};
    const n = Math.max(1, st.set.length);
    return Array.from({ length: n }, (_, i) => {
      const hex = st.hexes[i] || (table[st.set[i]] && table[st.set[i]].hex) || "";
      const label = n > 1 ? `colour ${i + 1} (${toneName(st.set[i]) || "not set"})` : "the colour";
      return `<button type="button" class="btn-sm ghost colour-dropper" data-colour-dropper data-slot="${i}" title="Eyedropper: pick ${esc(label)}" aria-label="Pick ${esc(label)} with the eyedropper">${n > 1 ? `<span class="dropper-swatch" style="--dot:${esc(hex || "transparent")}"></span><span class="dropper-slot">${i + 1}</span>` : ""}${DROPPER_SVG}</button>`;
    }).join("");
  }

  function setColourTone(card, id, hex, slotIndex) {
    const url = card.dataset.uncertainUrl;
    const input = card.querySelector('[data-uncertain-field="color"]');
    // No colour name in the listing at all: then the tone is the best name we have.
    if (!input.value.trim() && id) {
      input.value = toneName(id);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const row = card.querySelector(".colour-row");
    const st = rowColour(row);
    const slot = st.set.length > 1 ? Math.min(Math.max(Number(slotIndex) || 0, 0), st.set.length - 1) : 0;
    st.hexes[slot] = hex;
    // Multi-colour: each click fills the next colour (1 → 2 → 3 → back to 1). The tone follows colour 1.
    st.slot = slot;
    state.uncertainEdit.set(url, { ...state.uncertainEdit.get(url), colorHex: st.hexes[0] || "", colorHexes: st.hexes, colorTone: autoTone(st) });
    paintColourRow(row, st);

    scheduleAutosave(card);
  }

  function nearestColour(hex) {
    const rgb = [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16));
    if (!rgb.every(Number.isFinite)) return null;
    return nearestNamed(rgb, namedLabs((state.data && state.data.filamentColours) || {}));
  }
  async function colourFromImage(src) {
    let url = src;
    if (new URL(src, location.href).origin !== location.origin) {
      url = (await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "imageData", url: new URL(src, location.href).href }) })).dataUrl;
    }
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, 64, 64);
    return colourFromPixels(ctx.getImageData(0, 0, 64, 64).data, state.data && state.data.filamentColours);
  }

  // RFID is a plain on/off button beside the spool material; its value is "yes" or "" like any other field.
  function rfidToggle(attrs, on) {
    return `<button type="button" class="rfid-toggle" data-rfid-toggle ${attrs} value="${on ? "yes" : ""}" aria-pressed="${on ? "true" : "false"}">RFID</button>`;
  }
  // linked: undefined = no chain (baseline cards), true / false = the group chain on Uncertain cards.
  function spoolRow(attr, spoolMaterial, rfid, linked) {
    const chain = linked == null ? "" : `<button type="button" class="btn-sm ghost spool-chain" data-spool-chain aria-pressed="${linked ? "true" : "false"}" title="${linked ? "Linked: one spool type and RFID for this brand, sub-brand, polymer and variant. Click to break." : "Unlinked: each card has its own spool type. Click to link again."}" aria-label="${linked ? "Break spool link" : "Link spool type"}">${linked ? CHAIN : CHAIN_BROKEN}</button>`;
    return `<div class="spool-row">${spoolMaterialSelect(attr("spoolMaterial"), spoolMaterial)}${chain}${rfidToggle(attr("rfid"), rfid)}</div>`;
  }
  const CHAIN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M10.6 13.4a1 1 0 0 0 1.4 0l4-4a3 3 0 1 0-4.2-4.2l-1.2 1.2 1.4 1.4 1.2-1.2a1 1 0 0 1 1.4 1.4l-4 4a1 1 0 0 0 0 1.4zm2.8-2.8a1 1 0 0 0-1.4 0l-4 4a3 3 0 1 0 4.2 4.2l1.2-1.2-1.4-1.4-1.2 1.2a1 1 0 0 1-1.4-1.4l4-4a1 1 0 0 0 0-1.4z"/></svg>';
  const CHAIN_BROKEN = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15.8 5.2a1 1 0 0 1 1.4 1.4l-2 2 1.4 1.4 2-2a3 3 0 1 0-4.2-4.2l-2 2 1.4 1.4 2-2zM8.2 18.8a1 1 0 0 1-1.4-1.4l2-2-1.4-1.4-2 2a3 3 0 1 0 4.2 4.2l2-2-1.4-1.4-2 2zM4 6.5 5.5 5l3 3L7 9.5zm12.5 9.5L18 14.5l3 3-1.5 1.5z"/></svg>';
  function spoolGroupKey(brand, subBrand, polymer, variant) {
    return [brand, splitTags(subBrand)[0] || "", polymer, splitTags(variant).map(adminFold).sort().join("+")].map(adminFold).join("|");
  }
  function spoolGroup(key) {
    return ((state.data && state.data.desk && state.data.desk.filamentGroups) || {})[key] || {};
  }
  function cardGroupKey(card) {
    const v = (k) => tagFieldValue(card.querySelector(`[data-uncertain-field="${k}"]`)) || "";
    return spoolGroupKey(v("brand"), v("subBrand"), v("polymer"), v("variant"));
  }
  async function setSpoolGroup(key, patch) {
    const res = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "setFilamentGroup", key, ...patch }) });
    if (res.desk && state.data) state.data.desk = res.desk;
  }

  // Autosave: any change on a card saves that card a moment later, without reloading the page.
  // The Save buttons stay. Baseline image uploads still wait for Save (they are files, not fields).
  // Undo / redo per Uncertain card. Each autosave is one step; the card as it was before you first touched
  // it is step 0. Undo restores a step and saves it, so the server follows.
  const cardHistory = new Map();
  function cardSnapshot(card) {
    const snap = uncertainFields(card);
    const edit = state.uncertainEdit.get(card.dataset.uncertainUrl) || {};
    snap.colorTone = edit.colorTone != null ? edit.colorTone : "";
    return JSON.parse(JSON.stringify(snap));
  }
  function startCardHistory(card) {
    const url = card && card.dataset && card.dataset.uncertainUrl;
    if (url && !cardHistory.has(url)) cardHistory.set(url, { steps: [cardSnapshot(card)], at: 0 });
  }
  function recordCardHistory(card) {
    const url = card.dataset.uncertainUrl;
    startCardHistory(card);
    const h = cardHistory.get(url);
    const snap = cardSnapshot(card);
    if (JSON.stringify(snap) === JSON.stringify(h.steps[h.at])) return;
    h.steps = [...h.steps.slice(0, h.at + 1), snap].slice(-50);
    h.at = h.steps.length - 1;
    paintHistoryButtons(card);
  }
  function cardHistoryCan(url, dir) {
    const h = cardHistory.get(url);
    return !!h && h.at + dir >= 0 && h.at + dir < h.steps.length;
  }
  function paintHistoryButtons(card) {
    const url = card.dataset.uncertainUrl;
    const undo = card.querySelector("[data-card-undo]");
    const redo = card.querySelector("[data-card-redo]");
    if (undo) undo.disabled = !cardHistoryCan(url, -1);
    if (redo) redo.disabled = !cardHistoryCan(url, 1);
  }
  function stepCardHistory(card, dir) {
    const url = card.dataset.uncertainUrl;
    if (!cardHistoryCan(url, dir)) return;
    const h = cardHistory.get(url);
    h.at += dir;
    const snap = h.steps[h.at];
    // The snapshot IS the card: write it back as your edits, redraw, then save it.
    state.uncertainEdit.set(url, { ...snap, colorName: snap.colorName != null ? snap.colorName : snap.color });
    painted.delete("#tab-uncertain");
    render();
    const fresh = $$(".uncertain-card").find((el) => el.dataset.uncertainUrl === url);
    if (fresh) { fresh.dataset.historyStep = "1"; scheduleAutosave(fresh); }
  }

  const autosaveTimers = new Map();
  function scheduleAutosave(el) {
    const card = el && el.closest && el.closest(".uncertain-card, .baseline-card");
    if (!card || typeof setTimeout !== "function") return;
    const key = card.dataset.uncertainUrl || card.dataset.baselineId;
    if (!key || card.classList.contains("is-removed") || card.classList.contains("is-held")) return;
    clearTimeout((autosaveTimers.get(key) || {}).timer);
    autosaveTimers.set(key, { card, timer: setTimeout(() => {
      autosaveTimers.delete(key);
      if (card.dataset.uncertainUrl && !card.dataset.historyStep) recordCardHistory(card);
      delete card.dataset.historyStep;
      autosave(card).catch(() => { /* kept in unsavedEdits and retried */ });
    }, 900) });
  }
  // A pending autosave of a card that is about to be saved by hand: the hand save sends the same fields.
  function cancelAutosave(key) {
    const t = autosaveTimers.get(key);
    if (t && typeof clearTimeout === "function") clearTimeout(t.timer);
    autosaveTimers.delete(key);
  }
  // The request a card's autosave sends; also used to flush on page close.
  function saveBodyFor(card) {
    if (card.dataset.uncertainUrl) return { action: "updateUncertainCard", jobId: card.dataset.uncertainJob, url: card.dataset.uncertainUrl, patch: uncertainFields(card) };
    const patch = {};
    for (const input of card.querySelectorAll("[data-baseline-field]")) patch[input.dataset.baselineField] = tagFieldValue(input);
    return { action: "updateBaselineItem", id: card.dataset.baselineId, patch };
  }
  // An edit is never dropped: a failed save (server restarting, offline) stays here and is retried every
  // few seconds until it goes through; a newer edit of the same card replaces it.
  const unsavedEdits = new Map();
  function sendSave(key, body) {
    unsavedEdits.set(key, body);
    return api("/api/admin", { method: "POST", body: JSON.stringify(body) }).then((res) => {
      if (unsavedEdits.get(key) === body) unsavedEdits.delete(key);
      if (unsavedEdits.size === 0) document.body && document.body.classList.remove("has-unsaved");
      return res;
    }, (err) => {
      if (unsavedEdits.get(key) === body) {
        document.body && document.body.classList.add("has-unsaved");
        toast("Not saved yet (" + err.message + "). Retrying…");
        setTimeout(() => { if (unsavedEdits.get(key) === body) sendSave(key, body).catch(() => {}); }, 4000);
      }
      throw err;
    });
  }
  async function autosave(card) {
    const body = saveBodyFor(card);
    if (body.url) {
      const { url, jobId, patch } = body;
      await sendSave(url, body);
      const now = new Date().toISOString();
      const job = ((state.data && state.data.jobs) || []).find((j) => j.id === jobId);
      if (job) job.cards = { ...(job.cards || {}), [url]: { ...((job.cards || {})[url] || { url }), ...patch, url, handEdited: true, savedAt: now } };
      knownCache = null;
      state.uncertainSaved.add(url);
      card.classList.add("is-saved");
      return;
    }
    const res = await sendSave("baseline:" + body.id, body);
    if (res.baseline && state.data) state.data.baseline = res.baseline;
    state.baselineEdit.delete(body.id);
    knownCache = null;
    showBaselineDirtyCount();
  }
  // Closing or reloading the page: send what is still waiting, and warn if an earlier save never got through.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("beforeunload", (e) => {
      for (const [key, { card, timer }] of autosaveTimers) {
        clearTimeout(timer);
        unsavedEdits.set(key, saveBodyFor(card));
      }
      autosaveTimers.clear();
      for (const body of unsavedEdits.values()) {
        try { fetch("/api/admin", { method: "POST", keepalive: true, credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); } catch (_) { /* best effort */ }
      }
      if (unsavedEdits.size && document.body && document.body.classList.contains("has-unsaved")) { e.preventDefault(); e.returnValue = ""; }
    });
  }

  function spoolMaterialSelect(attrs, value) {
    return `<label>Spool material<select ${attrs}><option value="">Not set</option><option value="cardboard" ${value === "cardboard" ? "selected" : ""}>Cardboard</option><option value="plastic" ${value === "plastic" ? "selected" : ""}>Plastic</option></select></label>`;
  }

  function uncertainFields(card) {
    const out = {};
    for (const k of ["name", "brand", "subBrand", "polymer", "variant", "color", "packaging", "spoolMaterial", "rfid", "weight", "diameter"]) out[k] = tagFieldValue(card.querySelector(`[data-uncertain-field="${k}"]`));
    const packSel = card.querySelector && card.querySelector('[data-uncertain-field="bundle"]');
    if (packSel) {
      const count = Math.round(Number((card.querySelector('[data-uncertain-field="packCount"]') || {}).value) || 0);
      out.packCount = count >= 2 && count <= 50 ? count : 0;
      out.bundle = packSel.value === "yes" || out.packCount >= 2;
    }
    if (out.color != null) {
      const row = card.querySelector && card.querySelector(".colour-row");
      const st = row && row.dataset ? rowColour(row) : { set: coloursIn(out.color), hexes: [], fx: "" };
      out.colorName = out.color;
      out.colorSet = st.set;
      out.color = st.set.length > 1 ? st.set.join("+") : st.set[0] || colourId(out.color) || out.color;
      if (row && row.dataset) {
        out.colorHexes = st.hexes;
        out.colorEffect = st.fx;
        if (st.hexes[0]) out.colorHex = st.hexes[0];
      }
    }
    if (out.weight != null) out.weight = gramsOf(out.weight) ? gramsOf(out.weight) + " g" : out.weight.trim();
    if (card.dataset && card.dataset.kind) out.kind = card.dataset.kind;
    const chain = card.querySelector && card.querySelector("[data-place-chain]");
    const placeSel = card.querySelector && card.querySelector("[data-review-place]");
    if (chain && chain.getAttribute && placeSel) {
      out.placeLinked = chain.getAttribute("aria-pressed") === "true";
      out.place = placeSel.value || "create";
    }
    if (card.dataset && card.dataset.groupLinked) out.groupLinked = card.dataset.groupLinked === "true";
    const edit = card.dataset && state.uncertainEdit.get(card.dataset.uncertainUrl);
    if (edit && edit.colorHex) out.colorHex = edit.colorHex;
    const toneRow = card.querySelector && card.querySelector(".colour-row");
    if (toneRow && toneRow.dataset) out.colorTone = autoTone(rowColour(toneRow));
    return out;
  }

  // What you already confirmed: baseline rows plus every card you pressed Save on, in any run —
  // including ones published since, so a confirmation keeps helping later runs.
  // Cached per data load — every Uncertain card reads it while rendering.
  let knownCache = null;
  function knownRows(filament) {
    const d = state.data || {};
    const items = (d.baseline && d.baseline.items) || [];
    if (!knownCache || knownCache.data !== d || knownCache.jobs !== d.jobs || knownCache.items !== items) {
      const saved = [];
      for (const job of d.jobs || []) {
        for (const raw of Object.values(job.cards || {})) {
          const c = (raw && raw.card) || raw;
          if (!c || !c.handEdited) continue;
          const filamentCard = (c.kind || job.kind) === "filament" || !!c.polymer;
          saved.push({ ...c, category: filamentCard ? "filaments" : "printers" });
        }
      }
      knownCache = { data: d, jobs: d.jobs, items, rows: [...items, ...saved], profiles: null };
    }
    return knownCache.rows.filter((x) => (x.category === "filaments") === filament);
  }

  // One entry per distinct brand/sub-brand/polymer/variant combo (colour SKUs collapse), words pre-folded.
  // Later rows win, so a card you saved beats a baseline row with the same words.
  function filamentProfiles() {
    knownRows(true);
    if (!knownCache.profiles) {
      const byKey = new Map();
      for (const p of knownRows(true)) {
        if (!p.brand) continue;
        const prof = { row: p, brand: titleWords(p.brand), subs: splitTags(p.subBrand).map(titleWords), polymer: titleWords(p.polymer), variants: splitTags(p.variant).map(titleWords) };
        byKey.set([prof.brand, ...prof.subs, prof.polymer, ...prof.variants].join("|"), prof);
      }
      knownCache.profiles = [...byKey.values()];
    }
    return knownCache.profiles;
  }

  // Title help for filament cards. A confirmed model whose brand, sub-brand, polymer and variant words all
  // appear in this title is the answer (most specific wins), so saving one colour pre-fills its siblings.
  // Otherwise known words are picked one field at a time. Nothing is saved until you press Save.
  function titleWords(s) { return " " + adminFold(s).replace(/[^\p{L}\p{N}+]+/gu, " ").trim() + " "; }
  function titleGuess(c) {
    const words = titleWords(c.name);
    const inTitle = (w) => w.trim() !== "" && words.includes(w);
    const has = (t) => inTitle(titleWords(t));
    // Baseline rows store polymer / variant as codes (pla, plus-high-speed) that titles never spell out;
    // the scraper already turned this title into the same codes, so a code match counts too.
    const cardPolymer = titleWords(c.polymer);
    const cardVariants = splitTags(c.variant).map(titleWords);
    const profiles = filamentProfiles();
    let best = null, score = 0;
    for (const p of profiles) {
      const terms = 1 + p.subs.length + (p.polymer.trim() ? 1 : 0) + p.variants.length;
      if (terms < score || !inTitle(p.brand) || !p.subs.every(inTitle)) continue;
      if (p.polymer.trim() && !inTitle(p.polymer) && p.polymer !== cardPolymer) continue;
      if (!p.variants.every((v) => inTitle(v) || cardVariants.includes(v))) continue;
      best = p.row; score = terms;
    }
    const rows = profiles.map((p) => p.row);
    if (best) return { from: [best.brand, best.subBrand, best.polymer, best.variant].filter(Boolean).join(" · "), brand: best.brand, subBrand: best.subBrand, polymer: best.polymer, variant: best.variant, spoolMaterial: best.spoolMaterial, rfid: best.rfid };
    const found = (key, pool) => [...new Set(pool.flatMap((p) => splitTags(p[key])))].filter(has).sort((a, b) => b.length - a.length);
    const brand = found("brand", rows)[0] || "";
    const same = rows.filter((p) => adminFold(p.brand) === adminFold(brand));
    // A harvested brand the title never mentions is a shop mislabel (Bambu Lab on RhinoLab spools): replace it.
    return { from: "", brandWrong: !!brand && !has(c.brand), brand, subBrand: found("subBrand", same)[0] || "", polymer: found("polymer", rows)[0] || "", variant: found("variant", rows).join(", ") };
  }

  // Filament brand / polymer / sub-brand / variant suggestions come from knownRows, scoped to the focused
  // card: sub-brands and polymers by brand, variants by brand + sub-brand + polymer.
  // Filled on focus into the shared dl-* datalists in index.html, so they are never stale.
  function fillFilamentSuggestions(listId, card) {
    const key = listId.slice(3);
    const on = (k) => {
      const el = card && card.querySelector(`[data-baseline-field="${k}"],[data-uncertain-field="${k}"]`);
      return el ? adminFold(el.value) : "";
    };
    const brand = on("brand"), sub = on("subBrand"), polymer = on("polymer");
    const filament = !!(card && card.querySelector("[data-baseline-field=\"polymer\"],[data-uncertain-field=\"polymer\"]"));
    const rows = knownRows(filament);
    const scoped = rows.filter((x) => (key === "brand" || !brand || adminFold(x.brand) === brand)
      && (key !== "variant" || ((!polymer || adminFold(x.polymer) === polymer)
        && (!sub || splitTags(x.subBrand).some((s) => adminFold(s) === sub)))));
    // ponytail: nothing in scope (new brand/series) → offer every baseline value rather than an empty list.
    const values = new Map();
    for (const x of scoped.length ? scoped : rows) for (const v of splitTags(x[key])) if (!values.has(adminFold(v))) values.set(adminFold(v), v);
    document.getElementById(listId).innerHTML = [...values.values()].sort().map((v) => `<option value="${esc(v)}">`).join("");
  }

  // The shop listings published under this model (and its colour / weight rows), as editable cards.
  function baselineOffersPanel(it) {
    const ids = new Set([it.id, ...(((state.data && state.data.baseline && state.data.baseline.items) || []).filter((x) => x.parentId === it.id).map((x) => x.id))]);
    const n = allProducts().filter((p) => ids.has(p.baselineId) || ids.has(p.id)).reduce((sum, p) => sum + (p.offers || []).length, 0);
    if (!n) return "";
    const key = "bl-offers:" + it.id;
    return `<details class="offer-src-box" ${detailAttrs(key)}>
      <summary>${n} shop offer${n === 1 ? "" : "s"} — edit each listing</summary>
      <div class="offer-cards" data-lazy-offers="baseline:${esc(it.id)}">${isOpen(key) ? offerCardsFor("baseline:" + it.id) : ""}</div>
    </details>`;
  }

  function baselineCard(it, cats, allItems, childrenByParent) {
    const edit = state.baselineEdit.get(it.id) || {};
    const name = edit.name != null ? edit.name : (it.name || "");
    const brand = edit.brand != null ? edit.brand : (it.brand || "");
    const field = (key) => edit[key] != null ? edit[key] : (it[key] || "");
    const list = cats && cats.length ? cats : [{ id: "printers", name: "3D Printers" }];
    const pending = state.pendingImages.get(it.id);
    const printerFields = (it.category || "printers") === "filaments" ? "" : `<div class="baseline-specs">
      <span class="baseline-spec-label">Build volume (mm)</span>
      <input aria-label="Build volume X" type="number" min="1" step="1" data-baseline-field="buildVolumeX" data-baseline-id="${esc(it.id)}" value="${esc(field("buildVolumeX"))}" placeholder="X">
      <input aria-label="Build volume Y" type="number" min="1" step="1" data-baseline-field="buildVolumeY" data-baseline-id="${esc(it.id)}" value="${esc(field("buildVolumeY"))}" placeholder="Y">
      <input aria-label="Build volume Z" type="number" min="1" step="1" data-baseline-field="buildVolumeZ" data-baseline-id="${esc(it.id)}" value="${esc(field("buildVolumeZ"))}" placeholder="Z">
      <label>Tool system<input list="baseline-tool-systems" data-baseline-field="toolSystem" data-baseline-id="${esc(it.id)}" value="${esc(field("toolSystem"))}" placeholder="Single head, IDEX…"></label>
      <label>Motion type<input list="baseline-motion-types" data-baseline-field="motionType" data-baseline-id="${esc(it.id)}" value="${esc(field("motionType"))}" placeholder="CoreXY, Cartesian…"></label>
    </div>`;
    const isFilament = (it.category || "printers") === "filaments";
    const [variant1 = "", ...variantMore] = splitTags(field("variant"));
    const [sub1 = "", ...subMore] = splitTags(field("subBrand"));
    const subBrandLabel = `<label class="muted">Sub-brand / Series (optional)<input aria-label="Sub-brand / Series" data-baseline-field="subBrand" data-baseline-id="${esc(it.id)}" list="dl-subBrand" value="${esc(sub1)}" placeholder="Ender, CR, PolyLite…"></label>`;
    const filamentFields = !isFilament ? "" : `<div class="baseline-specs">
      <label>Polymer<input list="dl-polymer" data-baseline-field="polymer" data-baseline-id="${esc(it.id)}" value="${esc(field("polymer"))}" placeholder="PLA, PETG, ABS…"></label>
      ${tagField(`<label>Material variant<input list="dl-variant" data-baseline-field="variant" data-baseline-id="${esc(it.id)}" value="${esc(variant1)}" placeholder="Plus, Silk, High-Speed…"></label>`, variantMore, "dl-variant")}
      <label>Diameter<select data-baseline-field="diameter" data-baseline-id="${esc(it.id)}"><option value="1.75 mm" ${(field("diameter") || "1.75 mm") === "1.75 mm" ? "selected" : ""}>1.75 mm</option><option value="2.85 mm" ${field("diameter") === "2.85 mm" ? "selected" : ""}>2.85 mm</option></select></label>
      <label>Packaging<input list="baseline-filament-packaging" data-baseline-field="packaging" data-baseline-id="${esc(it.id)}" value="${esc(field("packaging"))}" placeholder="Spool, spoolless, refill…"></label>
      ${spoolRow((k) => `data-baseline-field="${k}" data-baseline-id="${esc(it.id)}"`, field("spoolMaterial"), !!field("rfid"))}
      <label>Material<input list="baseline-filament-reinforcement" data-baseline-field="reinforcement" data-baseline-id="${esc(it.id)}" value="${esc(field("reinforcement"))}" placeholder="Plain polymer, CF, GF…"></label>
    </div>`;
    const rows = allItems || [];
    const ids = new Set(rows.map((row) => row.id).filter(Boolean));
    const children = childrenByParent && childrenByParent.has(it.id)
      ? childrenByParent.get(it.id)
      : rows.filter((row) => (row.parentId === it.id && ids.has(row.parentId))
        || (row.id !== it.id && adminFold(row.name).startsWith(adminFold(it.name) + " ")));
    const colourHex = { black: "#111827", white: "#f8fafc", beige: "#d6c3a5", gray: "#9ca3af", grey: "#9ca3af", red: "#ef4444", orange: "#f97316", yellow: "#facc15", green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899", brown: "#92400e", gold: "#eab308", silver: "#cbd5e1", bronze: "#b45309", transparent: "#e5e7eb" };
    const childGroups = [...new Set(children.map((row) => row.weight || "Unspecified weight"))].map((weight) => {
      const rows = children.filter((row) => (row.weight || "Unspecified weight") === weight);
      const colours = [...new Map(rows.map((row) => {
        const name = row.color || "Unspecified colour";
        return [name, `<span class="baseline-colour"><i style="--swatch:${esc(colourHex[adminFold(name)] || "#94a3b8")}" aria-hidden="true"></i>${esc(name)}</span>`];
      })).values()];
      return `<div class="baseline-sku-group"><strong>${esc(weightLabel(weight))}</strong><details class="baseline-colour-menu"><summary>${colours.length} colour${colours.length === 1 ? "" : "s"}</summary><div class="baseline-colours">${colours.join("") || '<span class="muted">No colour recorded</span>'}</div></details></div>`;
    }).join("");
    const childSummary = children.length ? `<div class="baseline-skus"><span class="baseline-spec-label">Colours and weights (${children.length} SKUs)</span>${childGroups}</div>` : "";
    const removed = state.baselineRemoved.has(it.id);
    return `<div class="product-card baseline-card${removed ? " is-removed" : ""}" data-baseline-id="${esc(it.id)}">
      <div class="catalog-thumb">${pending ? `<img src="${esc(pending.preview)}" alt="Uploaded thumbnail preview">` : it.image ? productImg(it.image) : '<div class="catalog-thumb-empty"></div>'}</div>
      <label class="catalog-image-upload">Upload thumbnail<input type="file" accept="image/jpeg,image/png,image/webp" data-baseline-image="${esc(it.id)}"></label>
      <label class="muted">Product line<textarea aria-label="Model name" data-baseline-field="name" data-baseline-id="${esc(it.id)}" rows="3">${esc(name)}</textarea></label>
      <label class="muted">Brand<input aria-label="Brand" ${isFilament ? "list=\"dl-brand\"" : ""} data-baseline-field="brand" data-baseline-id="${esc(it.id)}" value="${esc(brand)}" placeholder="Brand"></label>
      ${tagField(subBrandLabel, subMore, "dl-subBrand")}
      ${printerFields}
      ${filamentFields}
      ${childSummary}
      ${baselineOffersPanel(it)}
      <label class="muted" style="font-size:12px">Change category
        <select data-baseline-move="${esc(it.id)}">${list.map((c) => `<option value="${esc(c.id)}" ${(it.category || "printers") === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      </label>
      <div class="actions">
        <button class="btn-sm" type="button" data-baseline-save="${esc(it.id)}" ${removed ? "disabled" : ""}>Save</button>
        <button class="btn-sm danger" type="button" data-baseline-del="${esc(it.id)}" ${removed ? "disabled" : ""}>Remove</button>
      </div>
    </div>`;
  }

  // A listing the run held out as another category (a colour module on a printer page). Bulk publishing
  // skips it: it is not a product of this shelf. Discard it, add the category, or publish it on its own.
  function isHeldOut(ev) {
    return !!(ev && (ev.mismatch || (ev.card && ev.card.mismatch) || ev.error === "category_mismatch"));
  }

  function uncertainRows(d) {
    const all = collectUncertain(d);
    const shop = state.uncertainShop || "";
    const visible = shop ? all.filter((x) => x.shopHost === shop) : all;
    const live = visible.filter((x) => !state.uncertainHeld.has(x.card && x.card.url) && !state.uncertainPublished.has(x.card && x.card.url));
    const rows = live.slice();
    const spots = [...state.uncertainHeld.values(), ...state.uncertainPublished.values()].sort((a, b) => a.index - b.index);
    for (const spot of spots) {
      if (shop && spot.ev.shopHost && spot.ev.shopHost !== shop) continue;
      const at = Math.max(0, Math.min(spot.index, rows.length));
      rows.splice(at, 0, spot.ev);
    }
    return { all, rows, live };
  }

  // One listing seen under two URLs of the SAME shop (category paths, ?variant links). The same product at
  // two shops is not a duplicate: that is two prices. Filaments must also agree on colour, weight, packaging.
  function uncertainDupeKey(ev) {
    const c = withEarlierSave(ev.card || {});
    const base = [ev.shopHost || hostOf(c.url), adminFold(listingName(c))];
    // Some older cards never recorded kind; a polymer or the word "filament" is enough to know.
    const filament = c.kind === "filament" || !!c.polymer || /filament/i.test(c.name || "");
    // The colour may only be in the URL ("…-matte-yellow"). A filament with no colour anywhere is not
    // provably the same spool, so it never pairs.
    // Both the name's and the URL's colour: "Filamix PLA Matte - Green" at …-mint-green is not plain green.
    const urlColour = colourId(String(c.url || "").replace(/[-_/]+/g, " "));
    const colour = [adminFold(colourNameOf(c)), urlColour].filter(Boolean).join("/") || (filament ? c.url : "");
    return (filament ? [...base, colour, gramsOf(weightOf(c)) || 1000, c.packaging || "spool"] : [...base, colour]).join("|");
  }
  function findUncertainDupes(d) {
    const groups = new Map();
    for (const ev of uncertainRows(d).live) {
      const url = ev.card && ev.card.url;
      if (!url) continue;
      const key = uncertainDupeKey(ev);
      groups.set(key, [...(groups.get(key) || []), url]);
    }
    return [...groups.values()].filter((g) => g.length > 1);
  }
  function uncertainDupesHtml(all) {
    if (!state.uncertainDupes) return "";
    if (!state.uncertainDupes.length) return '<p class="muted">No duplicate cards found.</p>';
    const byUrl = new Map(all.map((ev) => [ev.card && ev.card.url, ev]));
    for (const spot of state.uncertainHeld.values()) if (spot.ev && spot.ev.card) byUrl.set(spot.ev.card.url, spot.ev);
    return `<div class="baseline-duplicates uncertain-duplicates"><strong>Duplicate groups (${state.uncertainDupes.length})</strong><p class="muted">Same listing from the same shop. Delete the extras: the last card of a group always stays.</p>${state.uncertainDupes.map((group) => {
      const live = group.filter((u) => !state.uncertainHeld.has(u));
      return `<div class="baseline-duplicate-group uncertain-dupe-group">${group.map((u) => byUrl.get(u)).filter(Boolean).map((ev) => uncertainCard(ev, live.length === 1 && live[0] === ev.card.url)).join("")}</div>`;
    }).join("")}</div>`;
  }

  function uncertainHtml(d) {
    const { all, rows: allRows, live } = uncertainRows(d);
    const inDupes = new Set((state.uncertainDupes || []).flat());
    const rows = allRows.filter((ev) => !inDupes.has(ev.card && ev.card.url));
    const shops = [...new Set(all.map((x) => x.shopHost).filter(Boolean))].sort();
    const shop = state.uncertainShop || "";
    return `<div class="panel">
      <h2>Uncertain</h2>
      <p class="muted">Shop cards Magellan could not place, plus what Laya did with them. Edit a card, pick where it goes, then force-publish — even if Laya is still unsure.</p>
      <div class="form-row" style="flex-wrap:wrap;gap:8px">
        <label class="muted" style="font-size:12px">Shop
          <select id="uncertain-shop"><option value="">all shops</option>${shops.map((s) => `<option value="${esc(s)}" ${shop === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        </label>
        <button type="button" class="btn-sm ok" id="uncertain-publish-all" ${live.filter((ev) => !isHeldOut(ev)).length ? "" : "disabled"} title="Held-out listings (another category) are left for you to decide one by one">Force publish all (${live.filter((ev) => !isHeldOut(ev)).length})</button>
        ${live.filter((ev) => !(Number(ev.card && ev.card.price) > 0)).length ? `<button type="button" class="btn-sm" id="uncertain-fetch-prices">Fetch missing prices (${live.filter((ev) => !(Number(ev.card && ev.card.price) > 0)).length})</button>` : ""}
        <button type="button" class="btn-sm" id="uncertain-find-dupes">${state.uncertainDupes ? "Refresh duplicates" : "Find duplicates"}</button>
        ${state.uncertainDupes ? '<button type="button" class="btn-sm ghost" id="uncertain-clear-dupes">Close duplicates</button>' : ""}
      </div>
      ${uncertainDupesHtml(all)}
      <p class="muted">${rows.length} shown · ${all.length} uncertain</p>
      <div class="catalog-results">${optionGroupsHtml(rows, (ev) => uncertainCard(ev), "uncertain") || '<div class="empty">No unmatched cards. Run a shop, then Ask Laya on the review board.</div>'}</div>
    </div>`;
  }

  // A re-run is a new run, so a card you already saved comes back unsaved. Carry that save forward:
  // your identity fields win, the new run keeps its price, image and stock.
  // 1.75 mm unless a listing / you say 2.85 mm (still sold in Turkey) or 3 mm.
  function diameterValue(v) {
    const s = String(v || "").replace(",", ".");
    return /2\.?85/.test(s) ? "2.85 mm" : /\b3\.?0{1,2}\b/.test(s) && /mm/.test(s) ? "3.0 mm" : "1.75 mm";
  }
  const SAVED_KEYS = ["name", "brand", "subBrand", "polymer", "variant", "color", "colorName", "colorHex", "colorHexes", "colorSet", "colorEffect", "colorTone", "weight", "diameter", "packaging", "spoolMaterial", "rfid", "packCount", "bundle", "place", "placeLinked", "groupLinked"];
  // What a card really is. A shop can file spools under another category (the run then marks them
  // category_mismatch), and "Ender" is also a printer name, so a stored kind of "printer" is not enough:
  // a name that says filament or a polymer is a filament.
  function cardKind(c) {
    if (!c) return "printer";
    if (c.kind === "filament" || c.polymer) return "filament";
    return /\bfilament|\bfilaman|\b(?:pla\+?|petg|abs|asa|tpu|pctg|nylon|pa6?|pa12|pc)\b/i.test([c.name, c.sourceTitle].join(" ")) ? "filament" : (c.kind || "printer");
  }

  function withEarlierSave(c) {
    if (c && c.url && c.kind !== cardKind(c)) c = { ...c, kind: cardKind(c) };
    if (!c || !c.url) return c;
    knownRows(true);
    // The same listing can sit in several runs, each with its own save: the newest one wins, so an edit
    // made on Shop Runs shows on Uncertain and the other way round.
    const saved = knownCache.rows.filter((r) => r.handEdited && r.url === c.url)
      .reduce((best, r) => (!best || String(r.savedAt || "") >= String(best.savedAt || "") ? r : best), null);
    if (!saved || (c.handEdited && String(c.savedAt || "") >= String(saved.savedAt || ""))) return c;
    const out = { ...c, handEdited: true };
    for (const k of SAVED_KEYS) if (saved[k] != null) out[k] = saved[k];
    return out;
  }

  // review: Shop Runs extras on the same card (select / flag, worker match line, compare line, mismatch actions).
  // A listing the run gathered but could not read (no price, no brand): say why on the card itself.
  function unreadReason(ev, c) {
    if (!ev || ev.mismatch || (c && c.mismatch) || ev.error === "category_mismatch") return "";
    const err = String(ev.error || "");
    if (!err || Number(c && c.price) > 0) return "";
    if (err === "out_of_stock") return "sold out at the shop (its product page says out of stock), so it is left out";
    if (/Not in the replay archive/.test(err)) return "the page was not saved (replayed run)";
    return err.slice(0, 160);
  }

  function uncertainCard(ev, keepLast, review) {
    const c = withEarlierSave(ev.card || {});
    const url = c.url || "";
    const id = encodeURIComponent(url);
    const edit = state.uncertainEdit.get(url) || {};
    const isFilament = c.kind === "filament";
    // Your typing beats a saved card, which beats a confirmed-model match, which beats the harvest;
    // per-word guesses only fill blanks.
    const guess = isFilament && !c.handEdited ? titleGuess(c) : null;
    const pick = (k) => edit[k] != null ? edit[k]
      : guess && guess[k] && (guess.from || !c[k] || (k === "brand" && guess.brandWrong)) ? guess[k] : (c[k] || "");
    const name = edit.name != null ? edit.name : listingName(c);
    const brand = pick("brand");
    const polymer = pick("polymer");
    const variant = pick("variant");
    const color = edit.colorName != null ? edit.colorName : colourNameOf(c);
    const colourState = cardColour(c, edit, color);
    const packaging = edit.packaging != null ? edit.packaging : (c.packaging || "spool");
    const found = weightOf(c);
    const weightAssumed = edit.weight == null && (c.weightAssumed || !found);
    const weight = edit.weight != null ? edit.weight : (found || "1000 g");
    const diameter = diameterValue(edit.diameter != null ? edit.diameter : c.diameter);
    // A pack: your setting, else what the run read from the title.
    const packCountRaw = edit.packCount != null ? edit.packCount : c.packCount;
    const packState = { count: Number(packCountRaw) >= 2 ? Math.round(Number(packCountRaw)) : 0, bundle: edit.bundle != null ? edit.bundle === true : c.bundle === true || Number(c.packCount) >= 2 };
    // Spool material follows its model group while the chain is linked.
    const group = spoolGroup(spoolGroupKey(brand, pick("subBrand"), polymer, variant));
    const spoolLinked = group.spoolLinked !== false;
    const spoolMaterial = spoolLinked && group.spoolMaterial ? group.spoolMaterial : pick("spoolMaterial");
    // RFID: your click, else a saved card, else a matched model or the word "RFID" in the title.
    const ownRfid = edit.rfid != null ? !!edit.rfid : c.handEdited ? !!c.rfid : !!(guess && guess.rfid) || !!c.rfid || /\brfid\b/i.test(c.name || "");
    // Linked: the group's RFID (set from any card of the group) wins, like spool material.
    const rfid = isFilament && spoolLinked && group.rfid != null ? !!group.rfid : ownRfid;
    const subBrand = pick("subBrand");
    const [variant1 = "", ...variantMore] = splitTags(variant);
    const [sub1 = "", ...subMore] = splitTags(subBrand);
    const subBrandLabel = `<label class="muted">Sub-brand / Series (optional)<input aria-label="Sub-brand / Series" data-uncertain-field="subBrand" data-uncertain-url="${esc(url)}" list="dl-subBrand" value="${esc(sub1)}" placeholder="Ender, CR, PolyLite…"></label>`;
    const laya = layaOf(ev);
    // category_mismatch: the shop filed the listing under another category, so the run held it back
    // unread. Say that in words; once a price was fetched from the page it is not a problem any more.
    const magellan = ev.error === "category_mismatch"
      ? (Number(c.price) > 0 ? "Held out of the run (the shop filed it under another category). Price read from its page." : "Held out of the run: the shop filed it under another category, so its price was not read.")
      : ev.error ? "Harvest blocked: " + ev.error : magellanUnsure(ev)
      ? ((ev.decision && ev.decision.action) === "held" || (ev.decision && ev.decision.action) === "hold"
        ? "Magellan: held" + (ev.decision.reason ? " — " + ev.decision.reason : "")
        : "Magellan: unmatched")
      : "Magellan: " + ((ev.decision && ev.decision.action) || "placed");
    const place = uncertainPlace(ev, { kind: c.kind, name, brand, subBrand, polymer, variant, diameter, bundle: packState.bundle, packCount: packState.count });
    const held = state.uncertainHeld.has(url);
    const saved = state.uncertainSaved.has(url);
    const published = state.uncertainPublished.has(url) || ev.published === true;
    const og = ev.optionGroup || null;
    const thumbSrc = (og && og.pic) || c.image;
    const reviewClass = review ? " review-card" + (review.isSel ? " is-selected" : "") + (review.isFlag ? " flagged" : "") + (review.mismatch ? " is-mismatch" : "") : "";
    return `<div class="product-card baseline-card uncertain-card${reviewClass}${held ? " is-held" : ""}${saved ? " is-saved" : ""}${published ? " is-published" : ""}" data-uncertain-url="${esc(url)}" data-uncertain-job="${esc(ev.jobId || "")}" data-kind="${esc(c.kind || "")}"${og ? ` data-group-linked="${og.linked ? "true" : "false"}"` : ""}${ev.catalogProductId ? ` data-catalog-product="${esc(ev.catalogProductId)}"` : ""}>
      ${review ? `<div class="review-top">
        <label><input type="checkbox" data-review-select="${esc(id)}" ${review.isSel ? "checked" : ""}> Select</label>
        <label><input type="checkbox" data-review-flag="${esc(id)}" ${review.isFlag ? "checked" : ""}> Flag</label>
      </div>` : ""}
      ${held ? '<div class="uncertain-hold" aria-hidden="true">Removed</div>' : ""}
      ${published ? '<div class="uncertain-check" aria-label="Published" title="Published to the catalog. You can still edit it and Save &amp; publish again.">✓</div>' : ""}
      ${keepLast === true ? '<span class="uncertain-kept badge">Kept</span>' : `<button class="uncertain-trash" type="button" data-uncertain-delete="${esc(url)}" aria-label="Delete this card" title="Delete this card">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z"/></svg>
      </button>`}
      <div class="card-history">
        <button class="btn-sm ghost" type="button" data-card-undo title="Undo the last change on this card"${cardHistoryCan(url, -1) ? "" : " disabled"}>↶ Undo</button>
        <button class="btn-sm ghost" type="button" data-card-redo title="Redo"${cardHistoryCan(url, 1) ? "" : " disabled"}>↷ Redo</button>
      </div>
      ${unreadReason(ev, c) ? `<p class="card-unread${ev.error === "out_of_stock" ? " is-soldout" : ""}" role="note">${ev.error === "out_of_stock" ? "" : "Not read: "}${esc(unreadReason(ev, c).replace(/^./, (x) => ev.error === "out_of_stock" ? x.toUpperCase() : x))}</p>` : ""}
      <div class="catalog-thumb${og ? " opt-thumb" : ""}">${thumbSrc ? productImg(thumbSrc) : '<div class="catalog-thumb-empty"></div>'}${og ? `<span class="thumb-colour" title="${og.sharedPhoto ? "The shop shows one photo for every colour" : "This colour's own picture"}">${colourDot(colourFill(colourState), colourState.fx)}${esc(color || "colour")}${og.sharedPhoto ? ' <small>· same photo for all colours</small>' : ""}</span>` : ""}</div>
      <div class="meta"><span class="badge">${esc(ev.shopName || ev.shopHost || "shop")}</span></div>
      ${og ? groupLinkButton(og.linked, og.size) : ""}
      <label class="muted">Product line<textarea aria-label="Listing name" data-uncertain-field="name" data-uncertain-url="${esc(url)}" rows="3">${esc(name)}</textarea></label>
      ${tagField(subBrandLabel, subMore, "dl-subBrand")}
      ${isFilament ? `<div class="filament-identity-fields">
        <label>Brand<input list="dl-brand" data-uncertain-field="brand" data-uncertain-url="${esc(url)}" value="${esc(brand)}" placeholder="Brand"></label>
        <label>Polymer<input list="dl-polymer" data-uncertain-field="polymer" data-uncertain-url="${esc(url)}" value="${esc(polymer)}" placeholder="PLA, PETG, ABS…"></label>
        ${tagField(`<label>Material variant<input list="dl-variant" data-uncertain-field="variant" data-uncertain-url="${esc(url)}" value="${esc(variant1)}" placeholder="Plus, Silk, High-Speed…"></label>`, variantMore, "dl-variant")}
        <label class="colour-field">Colour<span class="colour-row" ${colourRowAttrs(colourState)}>${colourDot(colourFill(colourState), colourState.fx)}<input data-uncertain-field="color" data-uncertain-url="${esc(url)}" value="${esc(color)}" placeholder="Detected colour"><button type="button" class="btn-sm ghost" data-colour-from-image title="Read the colour from the product image"${c.image ? "" : " disabled"}>Image</button><button type="button" class="btn-sm ghost colour-minus" data-colour-minus title="One colour fewer: the name only sounds like two or three colours" aria-label="Remove a colour"${colourState.set.length > 1 ? "" : " hidden"}>−</button><button type="button" class="btn-sm ghost colour-plus" data-colour-plus title="One colour more (dual, tri colour…)" aria-label="Add a colour"${colourState.set.length >= 6 ? " hidden" : ""}>+</button><span class="droppers">${dropperButtons(colourState)}</span></span>${toneNote(autoTone(colourState))}</label>
        <label>Weight<input data-uncertain-field="weight" data-uncertain-url="${esc(url)}" value="${esc(weightLabel(weight))}" placeholder="1 kg, 250 g…">${weightAssumed ? '<small class="muted weight-assumed">Assumed: the listing gives no weight</small>' : ""}</label>
        <label>Diameter<select data-uncertain-field="diameter" data-uncertain-url="${esc(url)}">${["1.75 mm", "2.85 mm"].map((d) => `<option value="${d}" ${diameter === d ? "selected" : ""}>${d}</option>`).join("")}${diameter === "3.0 mm" ? '<option value="3.0 mm" selected>3.0 mm</option>' : ""}</select></label>
        <label>Pack<select data-uncertain-field="bundle" data-uncertain-url="${esc(url)}" title="A bundle or multi-pack (4'lü set, 10 adet, 4 colours in one box) is its own product, never merged with a single spool"><option value="" ${packState.bundle ? "" : "selected"}>Single spool</option><option value="yes" ${packState.bundle ? "selected" : ""}>Bundle / multi-pack</option></select></label>
        <label>Spools in pack<input type="number" min="2" max="50" step="1" inputmode="numeric" data-uncertain-field="packCount" data-uncertain-url="${esc(url)}" value="${packState.count >= 2 ? packState.count : ""}" placeholder="${packState.bundle ? "how many?" : "—"}"></label>
        <label>Packaging<select data-uncertain-field="packaging" data-uncertain-url="${esc(url)}"><option value="spool" ${packaging === "spool" ? "selected" : ""}>With spool</option><option value="refill" ${packaging === "refill" ? "selected" : ""}>Refill / Makarasız</option></select></label>
        ${spoolRow((k) => `data-uncertain-field="${k}" data-uncertain-url="${esc(url)}"`, spoolMaterial, rfid, spoolLinked)}
      </div>
      ${guess && guess.from ? `<p class="muted uncertain-guess">Matches ${esc(guess.from)}. Check, then Save.</p>` : ""}` : `<label class="muted">Brand<input data-uncertain-field="brand" data-uncertain-url="${esc(url)}" value="${esc(brand)}" placeholder="Brand"></label>`}
      <p class="muted">${esc(review ? review.where : magellan)}</p>
      ${Number(c.price) > 0 ? `<p class="muted">Shop price: ${esc(c.price)} TL</p>` : `<p class="error">No shop price was harvested. <button type="button" class="btn-sm" data-refetch-price="${esc(url)}" data-refetch-job="${esc(ev.jobId || "")}">Get price</button></p>`}
      <p class="muted">${esc(layaLabel(laya))}${laya && laya.confidence != null ? " · " + Number(laya.confidence).toFixed(2) : ""}</p>
      ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">open ↗</a>` : ""}
      <div class="review-place-label">Goes to
        <div class="place-combo">
          <input type="search" data-review-place-q="${esc(id)}" placeholder="Type to search baseline…" autocomplete="off" aria-label="Search baseline for where ${esc(c.name || "this listing")} goes">
          <button type="button" class="ghost place-arrow" data-place-open="${esc(id)}" aria-label="Show baseline matches">▾</button>
          ${placeChain(place.linked)}
        </div>
        <div class="place-hits" hidden></div>
        <select data-review-place="${esc(id)}" aria-label="Where ${esc(c.name || "this listing")} goes">${placeOptionsHtml(ev, place, "")}</select>
        ${place.auto ? `<small class="muted place-auto">Auto: matched baseline ${esc(place.name)}</small>` : ""}
      </div>
      ${review ? `<button type="button" class="btn-sm ghost" data-restore-place="${esc(id)}" title="Back to the automatic match">Restore default</button><p class="review-compare">${esc(review.mismatch ? review.where : compareText(ev, place))}</p>${review.mismatchActions}` : ""}
      <div class="actions">
        <button class="btn-sm" type="button" data-uncertain-save="${esc(url)}" data-uncertain-job="${esc(ev.jobId || "")}">Save</button>
        <button class="btn-sm primary" type="button" data-uncertain-baseline="${esc(url)}" data-uncertain-job="${esc(ev.jobId || "")}">Add to baseline</button>
        <button class="btn-sm ok" type="button" data-uncertain-publish="${esc(url)}"${og && og.linked ? ` title="Saves and publishes all ${og.size} linked colours"` : ""}>Save &amp; publish${og && og.linked ? " all" : ""}</button>
      </div>
    </div>`;
  }

  function catalogHtml(d) {
    const products = filteredProducts();
    const baselineModels = (d.baseline && d.baseline.items) || [];
    const baselineLabel = (x) => x.name + (x.brand ? " — " + x.brand : "");
    const savedAt = d.catalog && d.catalog.savedAt ? new Date(d.catalog.savedAt).toLocaleString() : "never";
    const changed = catalogUpdateCount();
    return `
      ${stockPanelHtml(d)}
      <div class="panel">
        <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:space-between;align-items:center">
          <h2 style="margin:0">Saved catalog</h2>
          <span class="muted">Last saved: ${esc(savedAt)}</span>
          <button class="btn-sm primary" type="button" id="update-catalog" ${changed ? "" : "disabled"} title="Writes the catalog back so the storefront picks it up. Select all enables this even without field edits.">Update catalog${changed ? ` (${changed})` : ""}</button>
          <button class="btn-sm ghost" type="button" id="select-all-catalog">Select all</button>
          <button class="btn-sm ghost" type="button" id="find-duplicates">Find duplicate groups</button>
          ${state.catalogUndo ? `<button class="btn-sm ghost" type="button" id="undo-merge">Undo last merge</button>` : ""}
          <button class="btn-sm danger" type="button" id="delete-selected-catalog" ${state.catalogSelected.size ? "" : "disabled"}>Delete selected (${state.catalogSelected.size})</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0">
          <label class="muted" style="font-size:12px">Shop
            <select id="catalog-shop"><option value="">all shops</option>${[...new Set(allProducts().flatMap((p) => (p.offers || []).map((o) => o.store)).filter(Boolean))].sort().map((x) => `<option value="${esc(x)}" ${state.catalogShop === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
          </label>
          <label class="muted" style="font-size:12px">Category
            <select id="catalog-shelf">${[["", "all"], ["product", "3D printers"], ["filament", "Filaments"]].map(([v, l]) => `<option value="${v}" ${state.catalogShelf === v ? "selected" : ""}>${l} (${allProducts().filter((p) => !v || p.shelf === v).length})</option>`).join("")}</select>
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
          <button class="btn-sm ghost" type="button" id="catalog-refresh">Reload catalog</button>
        </div>
        <datalist id="catalog-targets">${baselineModels.map((x) => `<option value="${esc(baselineLabel(x))}"></option>`).join("")}</datalist>
        ${dupesPanelHtml()}
        <div class="catalog-results" id="catalog-results">${products.map(productCard).join("") || '<div class="empty">No products found.</div>'}</div>
        <button class="ghost" id="catalog-more" style="margin-top:20px" ${products.length < state.catalogLimit ? "hidden" : ""}>Show more products</button>
      </div>
    `;
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
    const pendingImage = state.pendingImages.get(p.id);
    const common = (k) => esc(edit[k] ?? p[k] ?? "");
    const on = state.catalogSelected.has(p.id);
    return `<div class="product-card${on ? " is-selected" : ""}" data-product-id="${esc(p.id)}">
      <label class="muted" style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600"><input type="checkbox" data-catalog-select="${esc(p.id)}" ${on ? "checked" : ""}> Select</label>
      <div class="catalog-thumb">${pendingImage ? `<img src="${esc(pendingImage.preview)}" alt="Uploaded thumbnail preview">` : p.image ? productImg(p.image) : '<div class="catalog-thumb-empty"></div>'}</div>
      <label class="catalog-image-upload">Upload thumbnail<input type="file" accept="image/jpeg,image/png,image/webp" data-product-image="${esc(p.id)}"></label>
      <div class="name">${esc(p.name || p.title || p.id)}</div>
      <div class="meta">
        ${p.axes ? `<span class="axis-badge${p.axes.combo ? " is-combo" : " is-bare"}">${esc(p.axes.label || (p.axes.combo ? "Combo" : "Bare"))}</span>` : ""}
        ${p.offShelf ? `<span class="axis-badge is-offshelf" title="The storefront shows printers and filament only. Delete this row, or rename it if the name is wrong.">Not on the site: ${esc(p.offShelf)}</span>` : ""}
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
  // Every published offer as the same card as Uncertain / Shop Runs. "Goes to" moves it (Save & publish),
  // the trash can deletes it from the catalog, Add to baseline makes it a model of its own.
  function offersPanel(p) {
    const offers = p.offers || [];
    if (!offers.length) return "";
    const key = "offers:" + p.id;
    return `<details class="offer-src-box" ${detailAttrs(key)}>
      <summary>${offers.length} offer${offers.length === 1 ? "" : "s"} — edit each listing</summary>
      <div class="offer-cards" data-lazy-offers="product:${esc(p.id)}">${isOpen(key) ? offerCardsFor("product:" + p.id) : ""}</div>
    </details>`;
  }
  // Offers of one catalog row ("product:<id>") or of every catalog row of a baseline model ("baseline:<id>").
  function offerCardsFor(key) {
    const [kind, ...rest] = String(key || "").split(":");
    const id = rest.join(":");
    const rows = allProducts();
    const baselineIds = kind === "baseline"
      ? new Set([id, ...(((state.data && state.data.baseline && state.data.baseline.items) || []).filter((it) => it.parentId === id).map((it) => it.id))])
      : null;
    const products = kind === "product" ? rows.filter((p) => p.id === id) : rows.filter((p) => baselineIds.has(p.baselineId) || baselineIds.has(p.id));
    const html = products.flatMap((p) => (p.offers || []).map((o) => uncertainCard(offerEvent(p, o)))).join("");
    return html || '<p class="muted">No shop offers yet.</p>';
  }
  // The card for a published offer: the listing's card from its run when there is one, else built from
  // the offer; the price is the catalog's, and Goes to starts on the row it sits on.
  let offerIndexCache = null;
  const offerEventsByUrl = new Map();
  function offerEvent(p, o) {
    const built = offerEventInner(p, o);
    offerEventsByUrl.set(o.url, built);
    return built;
  }
  function offerEventInner(p, o) {
    const d = state.data || {};
    if (!offerIndexCache || offerIndexCache.data !== d || offerIndexCache.jobs !== d.jobs) {
      const byUrl = new Map();
      for (const job of d.jobs || []) for (const ev of collectCards(job, d)) if (ev.card && ev.card.url && !byUrl.has(ev.card.url)) byUrl.set(ev.card.url, { ...ev, jobId: job.id });
      offerIndexCache = { data: d, jobs: d.jobs, byUrl };
    }
    const found = offerIndexCache.byUrl.get(o.url);
    const base = found ? found.card : { url: o.url, name: o.sourceTitle || p.name, sourceTitle: o.sourceTitle, brand: p.brand, subBrand: p.subBrand, kind: p.kind || (p.shelf === "filament" ? "filament" : "printer"), polymer: p.polymer, variant: p.variant };
    const current = p.baselineId ? "merge:baseline:" + p.baselineId : "create";
    const card = {
      ...base,
      price: o.price, image: o.image || base.image || p.image,
      colorName: base.colorName || o.colorName, colorHex: base.colorHex || o.colorHex, colorHexes: base.colorHexes || o.colorHexes,
      colorEffect: base.colorEffect != null ? base.colorEffect : o.colorEffect, weight: base.weight || o.weight,
      place: base.handEdited && base.place ? base.place : current,
      placeLinked: base.handEdited && base.placeLinked != null ? base.placeLinked : false
    };
    return { ...(found || {}), card, jobId: found ? found.jobId : "", catalogProductId: p.id, shopName: o.store, decision: (found && found.decision) || { action: "merge", candidateId: p.baselineId ? "baseline:" + p.baselineId : p.id } };
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
            <ul class="shop-cats">${mine.map((c) => `<li><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.url || "")}</small>${c.page2Url ? `<br><small class="muted">page 2: ${esc(c.page2Url)}</small>` : '<br><small class="muted">Add the second listing page so the scraper can count n, n+1, …</small>'}</span><button class="btn-sm danger" type="button" data-delete-shop-cat="${esc(c.id || c.url)}" data-shop="${esc(s.id)}">Delete</button></li>`).join("") || '<li class="muted">No categories on this shop yet.</li>'}</ul>
            <form class="form-row add-shop-cat" data-add-shop-cat="${esc(s.id)}">
              <div class="field"><label>Category name</label><input name="name" type="text" required placeholder="Filament"></div>
              <div class="field" style="flex:2"><label>Category URL</label><input name="url" type="url" required placeholder="https://this-shop.com/filament"></div>
              <div class="field" style="flex:2"><label>Second page URL</label><input name="page2" type="url" placeholder="https://this-shop.com/filament?page=2"></div>
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
      return '<p class="muted">Local worker offline. Start <code>node worker/online-worker.cjs</code> on this PC.' + err + ' If the browser asks to allow local network / loopback access, choose Allow.</p>';
    }
    if (c && c.error) return '<p><span class="badge complete">worker online</span></p><p class="error">' + esc(c.error) + '</p><p class="muted">Check the local .venv-laya installation and trained head.</p>';
    if (!model) return '<p><span class="badge complete">worker online</span></p><p class="muted">Worker reached. Click Check Laya.</p>';
    const where = c && c.modelUrl ? ' at ' + esc(c.modelUrl) : '';
    return '<p><span class="badge complete">Laya ready</span></p><h3>' + esc(model) + '</h3><p class="muted">Loaded' + where + ' and trained from the approved baseline.</p>';
  }

  function aiHtml(d) {
    const desk = d.desk || {};
    return '<div class="panel"><h2>Local matcher</h2><p class="muted">The PC worker starts Laya with the decision head trained from your approved baseline.</p><input id="ai-url" type="hidden" value=""><button type="button" class="ghost" id="ai-detect">Check Laya</button><label class="muted" style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" id="auto-llm-match" ' + (desk.autoLlmMatch === true ? "checked" : "") + '> Auto Laya match (extreme uncertainty only)</label><p class="muted">Magellan runs first. Laya only scores its closed candidate list and cannot override hard model/configuration conflicts. It is never used for stock, VAT, price, or titles.</p></div><div class="panel"><h2>Connection status</h2><div id="ai-status" role="status">' + aiStatusHtml(d) + '</div></div>';
  }

  function jobsHtml(d) {
    const jobs = d.jobs || [];
    const live = jobs.filter((j) => ["queued", "running"].includes(j.status)).length;
    return `<div class="panel"><h2>Jobs</h2>${live ? `<p><button class="btn-sm danger" type="button" id="abort-all">Abort all (${live})</button></p>` : ""}${jobs.length ? `<div class="tape" style="max-height:none">${jobs.map((j) => `
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
      const pageBtn = e.target.closest("[data-pager-page]");
      if (pageBtn) {
        const key = pageBtn.closest("[data-pager]").dataset.pager;
        state.pager[key] = { page: Number(pageBtn.dataset.pagerPage) || 1 };
        repaintPager(key);
        return;
      }
      if (e.target.closest("#add-shop-row")) {
        const rows = rememberRunRows();
        state.runRows = [...rows, { shop: "", cat: runCategoryFromRows(rows), url: "" }];
        painted.delete("#tab-runs");
        paint("#tab-runs", runsHtml(state.data));
        return;
      }
      if (e.target.closest("#add-all-shops")) {
        const rows = rememberRunRows();
        const next = rowsWithRemainingShops(state.data, rows);
        if (!next.added) { toast("All shops are already listed."); return; }
        state.runRows = next.rows;
        painted.delete("#tab-runs");
        paint("#tab-runs", runsHtml(state.data));
        toast("Added " + next.added + " shop" + (next.added === 1 ? "" : "s") + (next.cat ? " as " + next.cat : "") + ". Change any row’s category from its dropdown.");
        return;
      }
      if (e.target.closest("[data-move-run]")) {
        const btn = e.target.closest("[data-move-run]");
        const row = btn.closest(".run-row");
        const rows = rememberRunRows();
        const from = Number(row && row.dataset.runIndex);
        const to = from + (btn.dataset.moveRun === "up" ? -1 : 1);
        if (from >= 0 && to >= 0 && to < rows.length) [rows[from], rows[to]] = [rows[to], rows[from]];
        state.runRows = rows;
        painted.delete("#tab-runs");
        paint("#tab-runs", runsHtml(state.data));
        return;
      }
      if (e.target.closest(".remove-shop-row")) {
        const row = e.target.closest(".run-row");
        const rows = rememberRunRows();
        const index = Number(row && row.dataset.runIndex);
        if (rows.length > 1 && index >= 0) rows.splice(index, 1);
        state.runRows = rows;
        painted.delete("#tab-runs");
        paint("#tab-runs", runsHtml(state.data));
        return;
      }
      if (e.target.closest("#run-all")) {
        const rows = collectRunRows(false);
        if (!rows.length) { toast("Pick a shop and its category URL first."); return; }
        const problem = rows.map(runRowProblem).find(Boolean);
        if (problem) { toast(problem); return; }
        const order = rows.map((r, i) => (i + 1) + ". " + (r.shop.name || r.shop.id) + " — " + (r.cat || r.url)).join("\n");
        if (!confirm("Run these shops from top to bottom?\n\n" + order)) return;
        const btn = e.target.closest("#run-all");
        const original = btn.textContent;
        const maxProducts = Math.max(0, Math.floor(Number(($("#shop-max") || {}).value) || 0)); // empty = no limit
        const llmValue = $("#run-llm") ? $("#run-llm").checked : undefined;
        const batchId = "batch-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
        state.runAllActive = true;
        state.runAllStop = false;
        painted.delete("#tab-runs");
        paint("#tab-runs", runsHtml(state.data));
        const startBtn = $("#run-all") || btn;
        startBtn.disabled = true;
        let stopped = false;
        try {
          for (let i = 0; i < rows.length; i += 1) {
            if (state.runAllStop) { stopped = true; break; }
            const r = rows[i];
            const who = r.shop.name || r.shop.id;
            const liveBtn = $("#run-all") || btn;
            liveBtn.textContent = "Running " + (i + 1) + "/" + rows.length + " — " + who;
            try {
              if (state.runAllStop) { stopped = true; break; }
              const created = await action({ action: "createJob", type: "shop", url: r.url, kind: kindForCategory(r.cat), maxProducts, autoLlmMatch: llmValue, batchId });
              if (state.runAllStop) {
                stopped = true;
                if (created && created.job) try { await action({ action: "abortJob", id: created.job.id }); } catch (_) { /* already stopping */ }
                break;
              }
              try { await notifyWorker(created.job); } catch (kickErr) { console.warn(kickErr); }
              await waitForRunJob(created.job.id);
              if (state.runAllStop) { stopped = true; break; }
            } catch (err) { toast(who + ": " + err.message); }
          }
          toast(stopped || state.runAllStop ? "Run all aborted." : "Run all finished — " + rows.length + " shop(s).");
        } finally {
          state.runAllActive = false;
          state.runAllStop = false;
          const liveBtn = $("#run-all");
          if (liveBtn) { liveBtn.disabled = false; liveBtn.textContent = original; }
          else { btn.disabled = false; btn.textContent = original; }
        }
        return;
      }
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
        showCatalogDirtyCount();
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
        showCatalogDirtyCount();
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
      if (e.target.closest("#find-baseline-duplicates")) {
        const all = ((state.data && state.data.baseline && state.data.baseline.items) || []);
        const ids = new Set(all.map((it) => it.id).filter(Boolean));
        const selectedCategory = state.baselineCategory || "";
        const items = all.filter((it) => !(it.parentId && ids.has(it.parentId)) && it.entityType !== "sku"
          && (!selectedCategory || (it.category || "printers") === selectedCategory));
        const groups = new Map();
        for (const it of items) {
          const key = adminFold([it.category, it.brand, it.name, it.polymer, it.variant, it.diameter].join("|"));
          if (!key) continue;
          const list = groups.get(key) || [];
          list.push(it);
          groups.set(key, list);
        }
        state.baselineDupes = [...groups.values()].filter((group) => group.length > 1);
        toast(state.baselineDupes.length ? state.baselineDupes.length + " duplicate baseline group" + (state.baselineDupes.length === 1 ? "" : "s") + " found in " + (selectedCategory || "all categories") + "." : "No duplicate baseline cards found in " + (selectedCategory || "all categories") + ".");
        render();
        return;
      }
      if (e.target.closest("#save-all-baseline")) {
        const btn = e.target.closest("#save-all-baseline");
        const ids = baselinePendingIds();
        if (!ids.length) { toast("No baseline changes to save."); return; }
        btn.disabled = true;
        btn.textContent = "Saving " + ids.length + "…";
        const changes = ids.map((id) => {
          const image = state.pendingImages.get(id);
          return { id, patch: state.baselineEdit.get(id) || {}, imageUpload: image ? { type: image.type, data: image.data } : null };
        });
        try {
          const res = await action({ action: "updateBaselineItems", changes });
          for (const id of ids) { state.baselineEdit.delete(id); state.pendingImages.delete(id); }
          if (res.baseline) state.data.baseline = res.baseline;
          painted.delete("#tab-baseline");
          render();
          toast("Saved " + ids.length + " baseline card" + (ids.length === 1 ? "" : "s") + ".");
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          showBaselineDirtyCount();
        }
        return;
      }
      if (e.target.closest("[data-merge-cluster]")) {
        const clusterKey = e.target.closest("[data-merge-cluster]").dataset.mergeCluster;
        const cluster = (state.dupes && state.dupes.clusters || []).find((c) => c.key === clusterKey);
        const ids = cluster ? cluster.rows.map((r) => r.id) : [];
        const keeperId = cluster ? cluster.keeperId : "";
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
      if (e.target.closest("[data-group-link]")) {
        const btn = e.target.closest("[data-group-link]");
        const card = btn.closest(".uncertain-card");
        const group = card && card.closest(".option-group");
        if (!card || !group) return;
        const url = card.dataset.uncertainUrl;
        const link = card.dataset.groupLinked !== "true";
        card.dataset.groupLinked = link ? "true" : "false";
        state.uncertainEdit.set(url, { ...state.uncertainEdit.get(url), groupLinked: link });
        const size = group.querySelectorAll(":scope > .opt-member").length;
        btn.closest(".group-link").outerHTML = groupLinkButton(link, size);
        if (link) {
          // Linked again: it takes the settings of the colours it joins.
          const from = linkedMembers(card).find((o) => o !== card);
          if (from) {
            for (const k of GROUP_FIELDS) copyGroupField(from, card, k);
            const f = uncertainFields(card);
            const cur = { ...state.uncertainEdit.get(url) };
            for (const k of GROUP_FIELDS) if (f[k] !== undefined) cur[k] = f[k];
            const fromChain = from.querySelector("[data-place-chain]");
            const fromSel = from.querySelector("[data-review-place]");
            if (fromChain && fromChain.getAttribute("aria-pressed") === "false" && fromSel) {
              const place = parsePlace(fromSel.value);
              state.uncertainEdit.set(url, cur);
              applyPlace(card, url, place);
              unlinkPlace(card, place);
            } else {
              cur.placeLinked = true;
              state.uncertainEdit.set(url, cur);
              const chain = card.querySelector("[data-place-chain]");
              if (chain) chain.outerHTML = placeChain(true);
              refreshAutoPlace(card);
            }
          }
        }
        scheduleAutosave(card);
        toast(link ? "Linked: this colour follows the others again." : "Unlinked: this colour keeps its own settings.");
        return;
      }
      if (e.target.closest("[data-opt-dot]")) {
        const dot = e.target.closest("[data-opt-dot]");
        showOption(dot.closest(".option-group"), Number(dot.dataset.optDot) || 0);
        return;
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
        // Held-out listings (another category) are not selected in bulk: Discard them or add the category.
        if (!String(state.reviewQuery || "").trim()) {
          // Every card of the run, not just the page on screen.
          for (const ev of collectCards(reviewJob(state.data || { jobs: [] }), state.data)) {
            const url = ev.card && ev.card.url;
            if (url && !ev.published && !ev.mismatch && !editedCard(ev).mismatch) state.reviewSelected.add(url);
          }
          syncReviewMarks();
          updateReviewToolbar();
          return;
        }
        $$("[data-review-select]").filter((el) => { const card = el.closest(".review-card") || {}; return !card.hidden && !(card.classList && (card.classList.contains("is-mismatch") || card.classList.contains("is-published"))); }).forEach((el) => {
          el.checked = true;
          state.reviewSelected.add(decodeURIComponent(el.dataset.reviewSelect));
          el.closest(".review-card")?.classList.add("is-selected");
        });
        updateReviewToolbar();
        return;
      }
      if (e.target.closest("#flag-all")) {
        if (!String(state.reviewQuery || "").trim()) {
          for (const ev of collectCards(reviewJob(state.data || { jobs: [] }), state.data)) {
            const url = ev.card && ev.card.url;
            if (url && !ev.published) state.reviewFlags.add(url);
          }
          syncReviewMarks();
          updateReviewToolbar();
          return;
        }
        $$("[data-review-flag]").filter((el) => !(el.closest(".review-card") || {}).hidden).forEach((el) => {
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
        // Find the card first: applyPlace empties the list this button sits in.
        const pickedCard = btn.closest(".uncertain-card");
        applyPlace(placeCard(btn), url, place);
        unlinkPlace(pickedCard, place);
        syncGroupPlace(pickedCard, place);
        return;
      }
      if (e.target.closest("[data-place-rename]")) {
        const btn = e.target.closest("[data-place-rename]");
        const next = prompt("New name for this baseline model:", btn.dataset.placeName);
        if (!next || !next.trim() || next.trim() === btn.dataset.placeName) return;
        try {
          const wrap = placeCard(btn);
          const url = decodeURIComponent(btn.dataset.placeUrl);
          const q = ((wrap && wrap.querySelector("[data-review-place-q]")) || {}).value || "";
          const res = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "updateBaselineItem", id: btn.dataset.placeRename, patch: { name: next.trim() } }) });
          if (res.baseline && state.data) state.data.baseline = res.baseline;
          knownCache = null;
          painted.delete("#tab-baseline");
          fillPlaceHits(wrap, url, q, { openAll: true });
          toast("Baseline model renamed.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-place-del]")) {
        const btn = e.target.closest("[data-place-del]");
        const id = btn.dataset.placeDel;
        if (!confirm(`Delete the baseline model "${btn.dataset.placeName}"? Its colour/weight rows go with it. This cannot be undone here.`)) return;
        try {
          const wrap = placeCard(btn);
          const url = decodeURIComponent(btn.dataset.placeUrl);
          const q = ((wrap && wrap.querySelector("[data-review-place-q]")) || {}).value || "";
          // No page reload: the open list refreshes in place so you can keep cleaning.
          const res = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "deleteBaselineItem", id }) });
          if (res.baseline && state.data) state.data.baseline = res.baseline;
          knownCache = null;
          painted.delete("#tab-baseline");
          fillPlaceHits(wrap, url, q, { openAll: true });
          toast("Baseline model deleted.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-place-chain]")) {
        const btn = e.target.closest("[data-place-chain]");
        const card = btn.closest(".uncertain-card");
        const url = card.dataset.uncertainUrl;
        const linked = btn.getAttribute("aria-pressed") === "true";
        const urls = linkedMembers(card).map((el) => el.dataset.uncertainUrl);
        for (const u of urls) {
          state.uncertainEdit.set(u, { ...state.uncertainEdit.get(u), placeLinked: !linked });
          if (!linked) state.reviewPlace.delete(u);
        }
        painted.delete("#tab-uncertain");
        render();
        for (const u of urls) {
          const fresh = $$(".uncertain-card").find((el) => el.dataset.uncertainUrl === u);
          if (fresh) scheduleAutosave(fresh);
        }
        toast(linked ? "Goes to unlinked: choose the baseline by hand." : "Goes to linked: it follows the automatic match again.");
        return;
      }
      if (e.target.closest("[data-place-open]")) {
        const btn = e.target.closest("[data-place-open]");
        const wrap = placeCard(btn);
        const url = decodeURIComponent(btn.dataset.placeOpen);
        const box = wrap && wrap.querySelector(".place-hits");
        const q = ((wrap && wrap.querySelector("[data-review-place-q]")) || {}).value || "";
        if (box && !box.hidden && !String(q).trim()) { box.hidden = true; box.innerHTML = ""; return; }
        fillPlaceHits(wrap, url, q, { openAll: true });
        const search = wrap && wrap.querySelector("[data-review-place-q]");
        if (search) search.focus();
        return;
      }
      if (e.target.closest("[data-restore-place]") && e.target.closest(".uncertain-card [data-restore-place]")) {
        const card = e.target.closest(".uncertain-card");
        const url = card.dataset.uncertainUrl;
        state.reviewPlace.delete(url);
        state.uncertainEdit.set(url, { ...state.uncertainEdit.get(url), placeLinked: true });
        painted.delete("#tab-runs");
        painted.delete("#tab-uncertain");
        render();
        const fresh = $$(".uncertain-card").find((el) => el.dataset.uncertainUrl === url);
        if (fresh) scheduleAutosave(fresh);
        return;
      }
      if (e.target.closest("[data-restore-place]")) {
        const url = decodeURIComponent(e.target.closest("[data-restore-place]").dataset.restorePlace);
        state.reviewPlace.delete(url);
        const ev = cardEvent(url);
        const place = baselinePlace(workerPlace(ev));
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
      if (e.target.closest("#delete-all-review")) {
        if (!confirm("Delete every gathered listing from every shop run on the board? No selection needed. Live catalog is not touched.")) return;
        try {
          const res = await action({ action: "deleteAllReview" });
          state.reviewFlags.clear();
          state.reviewSelected.clear();
          toast("Deleted " + (res.deleted || 0) + " listings from all shop runs.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#update-catalog")) {
        const btn = e.target.closest("#update-catalog");
        const edited = [...new Set([...state.editing.keys(), ...state.pendingImages.keys()])];
        if (!edited.length && !state.catalogSelected.size) return;
        btn.disabled = true;
        btn.textContent = "Updating…";
        try {
          if (edited.length) {
            const items = edited.map((id) => {
              const image = state.pendingImages.get(id);
              return { id, patch: state.editing.get(id) || {}, imageUpload: image ? { type: image.type, data: image.data } : null };
            });
            await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "updateProducts", items }) });
            state.editing.clear();
            state.pendingImages.clear();
          }
          await action({ action: "republishCatalog" });
          state.catalogSelected.clear();
          await loadData();
          toast("Catalog written. The storefront should show it after a refresh.");
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          showCatalogDirtyCount();
        }
        return;
      }
      if (e.target.closest("#catalog-refresh")) {
        const btn = e.target.closest("#catalog-refresh");
        btn.disabled = true;
        try {
          await loadData();
          render();
          toast("Reloaded from the live catalog. Unsaved changes were kept.");
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
        if (!confirm("Create a new catalog product and baseline model from this offer's scraped title?")) return;
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
        const baseline = ((state.data && state.data.baseline && state.data.baseline.items) || []);
        const label = (x) => (x.name + (x.brand ? " — " + x.brand : "")).toLowerCase();
        const target = baseline.find((x) => label(x) === want)
          || baseline.find((x) => String(x.name || "").toLowerCase() === want);
        if (!target) {
          toast("Pick a model from the baseline list.");
          return;
        }
        btn.disabled = true;
        try {
          await action({ action: "retargetOffer", url, from, to: "baseline:" + target.id });
          toast("Moved onto " + (target.name || target.id) + ".");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
        }
        return;
      }
      if (e.target.closest("[data-offer-delete]")) {
        const btn = e.target.closest("[data-offer-delete]");
        const url = btn.dataset.offerDelete;
        const from = btn.dataset.offerFrom;
        if (!confirm("Delete this " + (btn.dataset.offerStore || "shop") + " listing from the catalog card?")) return;
        btn.disabled = true;
        try {
          const res = await action({ action: "deleteOffer", url, from });
          toast(res.removedProduct ? "Listing deleted; the empty product card was removed." : "Listing deleted.");
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
          const live = await pingWorker();
          if (!live.ok) throw new Error("PC worker is offline");
          const res = await workerFetch("/stock-refresh", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ site: location.origin, limit: all ? 60 : 25, staleHours: all ? 0 : 6 }),
            signal: AbortSignal.timeout(300000)
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || "Stock refresh failed");
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
      if (e.target.closest("#laya-unmatched") || e.target.closest("#laya-selected")) {
        // Second opinion after the fact: never runs during a run, never publishes by itself.
        // It only fills in "where this card goes"; you still press Publish selected.
        const onlySelected = !!e.target.closest("#laya-selected");
        const job = reviewJob(state.data || { jobs: [] });
        const targets = collectCards(job, state.data).filter((ev) => {
          const url = ev.card && ev.card.url;
          if (!url || ev.error) return false;
          if (onlySelected) return state.reviewSelected.has(url);
          if (ev.published) return false;
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
        btn.textContent = "Asking Laya…";
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
          if (!res.ok) throw new Error(data.error || "Laya pass failed");
          let merged = 0, created = 0, held = 0;
          for (const r of data.results || []) {
            if (r.action === "merge" && r.matchId) { state.reviewPlace.set(r.url, { action: "merge", candidateId: r.matchId }); merged += 1; }
            else if (r.action === "create") { state.reviewPlace.set(r.url, { action: "create", candidateId: "" }); created += 1; }
            else held += 1;
          }
          try { await action({ action: "saveLayaOpinions", results: data.results || [] }); } catch (_) { /* board still has local placements */ }
          painted.delete("#tab-uncertain");
          toast("Laya answered " + data.asked + " of " + targets.length + ": " + merged + " merge, " + created + " new, " + held + " still unsure. Open Uncertain, then force-publish.");
        } catch (err) {
          toast(err.message);
        } finally {
          btn.disabled = false;
          btn.textContent = label;
        }
        return;
      }
      if (e.target.closest("[data-catalog-product] [data-uncertain-delete]")) {
        // An offer card in Catalog / Baseline: delete this listing from the catalog row.
        const card = e.target.closest("[data-catalog-product]");
        const url = card.dataset.uncertainUrl;
        const from = card.dataset.catalogProduct;
        if (!confirm("Delete this listing from the catalog?")) return;
        try {
          const res = await action({ action: "deleteOffer", url, from });
          card.remove();
          toast(res.removedProduct ? "Listing deleted; the empty product was removed." : "Listing deleted from the catalog.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-uncertain-delete]")) {
        const btn = e.target.closest("[data-uncertain-delete]");
        const url = btn.dataset.uncertainDelete;
        const card = btn.closest(".uncertain-card");
        if (!url || !card || card.classList.contains("is-held") || state.uncertainHeld.has(url)) return;
        const dupeGroup = card.closest(".uncertain-dupe-group");
        const others = dupeGroup ? [...dupeGroup.querySelectorAll(".uncertain-card:not(.is-held)")].filter((el) => el !== card) : [];
        if (dupeGroup && !others.length) { toast("That is the last copy, so it stays."); return; }
        if (others.length === 1) {
          const trash = others[0].querySelector("[data-uncertain-delete]");
          if (trash) trash.outerHTML = '<span class="uncertain-kept badge">Kept</span>';
        }
        const grid = card.parentElement;
        const index = grid ? Array.prototype.indexOf.call(grid.children, card) : 0;
        const ev = collectUncertain(state.data).find((x) => x.card && x.card.url === url) || { card: { url }, held: true };
        state.uncertainHeld.set(url, { index, ev: { ...ev, held: true } });
        card.classList.add("is-held");
        if (!card.querySelector(".uncertain-hold")) card.insertAdjacentHTML("afterbegin", '<div class="uncertain-hold" aria-hidden="true">Removed</div>');
        state.uncertainEdit.delete(url);
        action({ action: "deleteFlagged", urls: [url] }).catch((err) => {
          state.uncertainHeld.delete(url);
          card.classList.remove("is-held");
          const cover = card.querySelector(".uncertain-hold");
          if (cover) cover.remove();
          toast(err.message);
        });
        return;
      }
      if (e.target.closest("[data-uncertain-baseline]")) {
        const btn = e.target.closest("[data-uncertain-baseline]");
        const url = btn.dataset.uncertainBaseline;
        const jobId = btn.dataset.uncertainJob;
        const card = btn.closest(".uncertain-card");
        if (!url || !card || state.uncertainHeld.has(url)) return;
        // A pending autosave would save the temporary "this model" option below; the add saves everything.
        clearTimeout((autosaveTimers.get(url) || {}).timer);
        autosaveTimers.delete(url);
        const fields = uncertainFields(card);
        const { name, brand } = fields;
        const grid = card.parentElement;
        const index = grid ? Array.prototype.indexOf.call(grid.children, card) : 0;
        const ev = collectUncertain(state.data).find((x) => x.card && x.card.url === url) || { card: { url, name, brand } };
        state.uncertainPublished.set(url, { index, ev });
        state.uncertainEdit.set(url, { ...(state.uncertainEdit.get(url) || {}), ...fields });
        card.classList.add("is-published");
        if (!card.querySelector(".uncertain-check")) card.insertAdjacentHTML("afterbegin", '<div class="uncertain-check" aria-label="Published">✓</div>');
        const sel = card.querySelector("[data-review-place]");
        if (sel) {
          let opt = sel.querySelector("option[data-self='1']");
          if (!opt) {
            opt = document.createElement("option");
            opt.dataset.self = "1";
            sel.insertBefore(opt, sel.firstChild);
          }
          opt.value = "merge:baseline:self";
          opt.textContent = "Baseline · " + (name || "this model");
          sel.value = opt.value;
        }
        const note = card.querySelector(".uncertain-note");
        if (note) note.remove();
        api("/api/admin", { method: "POST", body: JSON.stringify({ action: "addUncertainToBaseline", jobId, url, ...fields, price: ev.card && ev.card.price }) }).then((res) => {
          const item = res && res.item;
          if (!item) throw new Error("Baseline model was not created");
          if (state.data) {
            const board = state.data.baseline || { items: [], categories: [] };
            if (!(board.items || []).some((i) => i.id === item.id)) board.items = [...(board.items || []), item];
            state.data.baseline = board;
          }
          applyPlace(card, url, { action: "merge", candidateId: "baseline:" + item.id });
          // The card now belongs to the model it just created: linked, so a reload or re-run keeps it there
          // (an older hand pick like "New product" would otherwise win and publish it a second time).
          const place = "merge:baseline:" + item.id;
          state.uncertainEdit.set(url, { ...(state.uncertainEdit.get(url) || {}), place, placeLinked: true });
          // Its linked colours are the same model: they go there too.
          for (const other of linkedMembers(card).filter((o) => o !== card)) {
            const ou = other.dataset.uncertainUrl;
            applyPlace(other, ou, { action: "merge", candidateId: "baseline:" + item.id });
            const chain = other.querySelector("[data-place-chain]");
            if (chain) chain.outerHTML = placeChain(true);
            state.uncertainEdit.set(ou, { ...(state.uncertainEdit.get(ou) || {}), place, placeLinked: true });
            scheduleAutosave(other);
          }
          knownCache = null;
          return api("/api/admin", { method: "POST", body: JSON.stringify({ action: "updateUncertainCard", jobId, url, patch: { place, placeLinked: true } }) });
        }).catch((err) => {
          state.uncertainPublished.delete(url);
          card.classList.remove("is-published");
          const mark = card.querySelector(".uncertain-check");
          if (mark) mark.remove();
          const self = card.querySelector("option[data-self='1']");
          if (self) self.remove();
          let line = card.querySelector(".uncertain-note");
          if (!line) {
            line = document.createElement("p");
            line.className = "uncertain-note";
            card.appendChild(line);
          }
          line.textContent = err.message;
          toast(err.message);
        });
        return;
      }
      if (e.target.closest("[data-uncertain-save]")) {
        const btn = e.target.closest("[data-uncertain-save]");
        const url = btn.dataset.uncertainSave;
        const jobId = btn.dataset.uncertainJob;
        const card = btn.closest(".uncertain-card");
        if (!url || !card || btn.disabled) return;
        const members = linkedMembers(card);
        btn.disabled = true;
        try {
          for (const m of members) {
            const u = m === card ? url : m.dataset.uncertainUrl;
            const patch = uncertainFields(m);
            state.uncertainEdit.set(u, { ...state.uncertainEdit.get(u), ...patch });
            cancelAutosave(u);
            await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "updateUncertainCard", jobId: m === card ? jobId : m.dataset.uncertainJob || jobId, url: u, patch }) });
            state.uncertainSaved.add(u);
            m.classList.add("is-saved");
          }
          await loadData(); // other cards suggest these values
          toast((members.length > 1 ? "Saved all " + members.length + " colours." : "Saved.") + " Not published.");
        } catch (err) { toast(err.message); }
        finally { btn.disabled = false; }
        return;
      }
      if (e.target.closest("[data-refetch-price], #uncertain-fetch-prices")) {
        const btn = e.target.closest("[data-refetch-price], #uncertain-fetch-prices");
        if (btn.disabled) return;
        const items = btn.dataset.refetchPrice
          ? [{ url: btn.dataset.refetchPrice, jobId: btn.dataset.refetchJob }]
          : uncertainRows(state.data).live.filter((ev) => ev.card && ev.card.url && !(Number(ev.card.price) > 0)).map((ev) => ({ url: ev.card.url, jobId: ev.jobId }));
        if (!items.length) return;
        btn.disabled = true;
        const label = btn.textContent;
        let got = 0;
        const failed = [];
        try {
          // Six pages per request keeps each call short; the shop sees a handful at a time, not a burst.
          for (let i = 0; i < items.length; i += 6) {
            btn.textContent = `Reading prices ${Math.min(i + 6, items.length)} / ${items.length}…`;
            const res = await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "refetchUncertainPrices", items: items.slice(i, i + 6) }) });
            for (const r of res.results || []) (r.price ? got++ : failed.push(r));
          }
          await loadData();
          const why = [...new Set(failed.map((r) => r.error))].join("; ");
          toast(`Got ${got} of ${items.length} price${items.length === 1 ? "" : "s"}.` + (failed.length ? ` ${failed.length} not found: ${why}.` : ""));
        } catch (err) { toast(err.message); }
        finally { btn.disabled = false; btn.textContent = label; }
        return;
      }
      if (e.target.closest("#uncertain-find-dupes")) {
        state.uncertainDupes = findUncertainDupes(state.data);
        painted.delete("#tab-uncertain");
        render();
        toast(state.uncertainDupes.length ? state.uncertainDupes.length + " duplicate group" + (state.uncertainDupes.length === 1 ? "" : "s") + " moved to the top." : "No duplicate cards found.");
        return;
      }
      if (e.target.closest("#uncertain-clear-dupes")) {
        state.uncertainDupes = null;
        painted.delete("#tab-uncertain");
        render();
        return;
      }
      if (e.target.closest("[data-uncertain-publish], #uncertain-publish-all")) {
        const btn = e.target.closest("[data-uncertain-publish], #uncertain-publish-all");
        const singleUrl = btn.dataset.uncertainPublish;
        const members = singleUrl ? linkedMembers(btn.closest(".uncertain-card")) : [];
        const urls = singleUrl ? members.map((el) => el.dataset.uncertainUrl) : uncertainRows(state.data).live
          .filter((x) => !isHeldOut(x))
          .map((x) => x.card && x.card.url).filter((u) => u && !state.uncertainHeld.has(u) && !state.uncertainPublished.has(u));
        if (!urls.length || btn.disabled) return;
        if (!singleUrl && !confirm("Force-publish " + urls.length + " listings to the live catalog?")) return;
        const pending = new Map();
        const uncertainByUrl = new Map(collectUncertain(state.data).map((x) => [x.card?.url, x]));
        const drawn = singleUrl ? new Map() : new Map($$(".uncertain-card").map((el) => [el.dataset.uncertainUrl, el]));
        for (const url of urls) {
          const known = uncertainByUrl.get(url) || state.uncertainPublished.get(url)?.ev;
          // A card on another page is drawn off screen, so it is read exactly like one on screen.
          const card = singleUrl ? members.find((el) => el.dataset.uncertainUrl === url) : (drawn.get(url) || (known ? detachedCard(uncertainCard(known), ".uncertain-card") : null));
          if (!card || state.uncertainHeld.has(url)) continue;
          state.uncertainEdit.set(url, { ...state.uncertainEdit.get(url), ...uncertainFields(card) });
          const ev = known;
          pending.set(url, { index: card.parentElement ? Array.prototype.indexOf.call(card.parentElement.children, card) : 0, ev });
        }
        if (!pending.size) return;
        btn.disabled = true;
        try {
          for (const one of members) {
            if (!pending.has(one.dataset.uncertainUrl)) continue;
            cancelAutosave(one.dataset.uncertainUrl);
            await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "updateUncertainCard", jobId: one.dataset.uncertainJob, url: one.dataset.uncertainUrl, patch: uncertainFields(one) }) });
          }
          const result = await forcePublishUrls([...pending.keys()]);
          if (!result.published || !Array.isArray(result.appliedUrls)) throw new Error("No listings were confirmed published. Refresh and try again.");
          for (const url of result.appliedUrls) {
            if (pending.has(url)) state.uncertainPublished.set(url, pending.get(url));
          }
          await loadData();
          const skipped = pending.size - result.appliedUrls.length;
          toast(result.published + " published to Catalog." + (skipped ? " " + skipped + " skipped: missing a valid price." : ""));
        } catch (err) { toast(err.message); }
        finally { btn.disabled = false; }
        return;
      }
      if (e.target.closest("#publish-selected")) {
        const ids = [...state.reviewSelected];
        if (!ids.length) return;
        if (!confirm("Publish baseline matches and send unassigned products to Uncertain?")) return;
        const job = reviewJob(state.data || { jobs: [] });
        const byUrl = new Map();
        collectCards(job, state.data).forEach((ev) => { if (ev.card?.url) byUrl.set(ev.card.url, ev); });
        const chosen = ids.map((url) => {
          const ev = byUrl.get(url) || cardEvent(url);
          const dom = reviewCardDom(job, ev, url);
          const sel = dom && dom.querySelector("[data-review-place]");
          const place = sel ? parsePlace(sel.value) : uncertainPlace(ev);
          const card = { ...editedCard(ev), ...(dom ? uncertainFields(dom) : {}), url, kind: cardKind(ev.card) };
          return { url, action: place.action, candidateId: place.candidateId, card };
        });
        const placements = chosen.filter((it) => it.action === "merge" && String(it.candidateId || "").startsWith("baseline:"));
        const deferred = chosen.filter((it) => !placements.includes(it));
        try {
          const result = await action({ action: "publishSelected", placements, deferred });
          state.reviewSelected.clear();
          // A baseline match without a price from the run (its page failed) is not published: say so.
          const skipped = placements.length - (Array.isArray(result.appliedUrls) ? result.appliedUrls.length : (result.published || 0));
          toast((result.published || 0) + " published to Catalog" + (result.deferred ? " · " + result.deferred + " sent to Uncertain" : "") + (skipped > 0 ? " · " + skipped + " skipped: no price from the shop run" : "") + ".");
        } catch (err) { toast(err.message); }
      }
      if (e.target.matches("[data-review-select]")) {
        const key = decodeURIComponent(e.target.dataset.reviewSelect);
        if (e.target.checked) state.reviewSelected.add(key); else state.reviewSelected.delete(key);
        e.target.closest(".review-card")?.classList.toggle("is-selected", e.target.checked);
        // Linked colours are one product: selected (and published) together.
        for (const other of linkedMembers(e.target.closest(".review-card")).filter((o) => o.dataset.uncertainUrl !== key)) {
          const box = other.querySelector("[data-review-select]");
          if (box) box.checked = e.target.checked;
          other.classList.toggle("is-selected", e.target.checked);
          if (e.target.checked) state.reviewSelected.add(other.dataset.uncertainUrl); else state.reviewSelected.delete(other.dataset.uncertainUrl);
        }
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
        return;
      }
      if (e.target.closest("#abort-all")) {
        state.runAllStop = true;
        try {
          const res = await action({ action: "abortAllJobs" });
          toast("Aborted " + (res.aborted || 0) + " job(s).");
        } catch (err) { toast(err.message); }
        return;
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
        const image = state.pendingImages.get(id);
        try {
          await api("/api/admin", { method: "POST", body: JSON.stringify({ action: "updateProduct", id, patch, imageUpload: image ? { type: image.type, data: image.data } : null }) });
          state.editing.delete(id);
          state.pendingImages.delete(id);
          await loadData();
          toast("Product saved.");
        } catch (err) { toast(err.message); }
      }
      if (e.target.closest("[data-reset-product]")) {
        const id = e.target.closest("[data-reset-product]").dataset.resetProduct;
        state.editing.delete(id);
        state.pendingImages.delete(id);
        render();
      }
      if (e.target.closest("[data-rec-confirm]")) {
        const id = e.target.closest("[data-rec-confirm]").dataset.recConfirm;
        try {
          await action({ action: "confirmBaselineRecommendation", id });
          painted.delete("#tab-baseline");
          render();
          toast("Added to the baseline.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-rec-dismiss]")) {
        const id = e.target.closest("[data-rec-dismiss]").dataset.recDismiss;
        try {
          await action({ action: "dismissBaselineRecommendation", id });
          painted.delete("#tab-baseline");
          render();
          toast("Recommendation dismissed.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-baseline-del]")) {
        const id = e.target.closest("[data-baseline-del]").dataset.baselineDel;
        try {
          const res = await action({ action: "deleteBaselineItem", id });
          if (res.baseline) state.data.baseline = res.baseline;
          state.baselineEdit.delete(id);
          state.baselineRemoved.add(id);
          painted.delete("#tab-baseline");
          render();
          toast("Removed from baseline.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-baseline-save]")) {
        const id = e.target.closest("[data-baseline-save]").dataset.baselineSave;
        const card = e.target.closest(".baseline-card");
        const patch = {};
        for (const input of (card ? card.querySelectorAll("[data-baseline-field]") : [])) patch[input.dataset.baselineField] = tagFieldValue(input);
        try {
          const image = state.pendingImages.get(id);
          const res = await action({ action: "updateBaselineItem", id, patch, imageUpload: image ? { type: image.type, data: image.data } : null });
          if (res.baseline) state.data.baseline = res.baseline;
          state.baselineEdit.delete(id);
          state.pendingImages.delete(id);
          painted.delete("#tab-baseline");
          render();
          toast("Model saved.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("[data-baseline-cat-save]")) {
        const id = e.target.closest("[data-baseline-cat-save]").dataset.baselineCatSave;
        const box = document.querySelector('[data-baseline-cat-name="' + id + '"]');
        const name = ((box || {}).value || "").trim();
        if (!name) { toast("Name the category first."); return; }
        try {
          const res = await action({ action: "renameBaselineCategory", id, name });
          if (res.baseline) state.data.baseline = res.baseline;
          painted.delete("#tab-baseline");
          render();
          toast("Category saved — it is global for every model.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#baseline-add-cat")) {
        const name = (($("#baseline-new-cat") || {}).value || "").trim();
        if (!name) { toast("Name the category first."); return; }
        try {
          const res = await action({ action: "addBaselineCategory", name });
          if (res.baseline) state.data.baseline = res.baseline;
          painted.delete("#tab-baseline");
          render();
          toast("Category added.");
        } catch (err) { toast(err.message); }
        return;
      }
      if (e.target.closest("#baseline-add-item")) {
        const name = (($("#baseline-new-name") || {}).value || "").trim();
        const brand = (($("#baseline-new-brand") || {}).value || "").trim();
        const category = (($("#baseline-new-parent") || {}).value || "printers");
        if (!name) { toast("Name the model first."); return; }
        try {
          const res = await action({ action: "addBaselineItem", name, brand, category });
          if (res.baseline) state.data.baseline = res.baseline;
          painted.delete("#tab-baseline");
          render();
          toast("Model added.");
        } catch (err) { toast(err.message); }
        return;
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
      if (e.target.id === "quick-run" || e.target.id === "run-form") {
        e.preventDefault();
        const isQuick = e.target.id === "quick-run";
        const rows = collectRunRows(isQuick);
        if (!rows.length) { toast("Pick a shop and its category URL."); return; }
        const quickKind = ($("#run-kind") || {}).value || "both";
        const maxProducts = Math.max(0, Math.floor(Number(($("#shop-max") || {}).value) || 0)); // empty = no limit
        const llmValue = $("#run-llm") ? $("#run-llm").checked : undefined;
        const problems = [];
        let queued = 0;
        const batchId = "batch-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
        for (const r of rows) {
          const problem = isQuick ? "" : runRowProblem(r);
          if (problem) { problems.push(problem); continue; }
          try {
            const created = await action({ action: "createJob", type: "shop", url: r.url, kind: isQuick ? quickKind : kindForCategory(r.cat), maxProducts, autoLlmMatch: llmValue, batchId });
            queued += 1;
            try { await notifyWorker(created.job); } catch (kickErr) { console.warn(kickErr); }
          } catch (err) { problems.push(err.message); }
        }
        if (queued > 1) toast(queued + " runs queued, one per shop. Use Run all to do them in order.");
        else if (queued === 1) toast("Run sent to the worker.");
        if (problems.length) toast(problems[0] + (problems.length > 1 ? " (+" + (problems.length - 1) + " more)" : ""));
      }
      if (e.target.matches(".add-shop-cat") || e.target.closest(".add-shop-cat") === e.target) {
        e.preventDefault();
        const form = e.target.closest(".add-shop-cat") || e.target;
        const shopId = form.dataset.addShopCat;
        const name = (form.querySelector('[name="name"]') || {}).value.trim();
        const raw = (form.querySelector('[name="url"]') || {}).value.trim();
        const raw2 = ((form.querySelector('[name="page2"]') || {}).value || "").trim();
        if (!name || !raw) return;
        try {
          const u = new URL(raw);
          if (u.protocol !== "https:") { toast("Category URL must be HTTPS."); return; }
          let page2 = "";
          if (raw2) {
            const u2 = new URL(raw2);
            if (u2.protocol !== "https:") { toast("Second page URL must be HTTPS."); return; }
            if (urlHostOf(u2.href) !== urlHostOf(u.href)) { toast("Second page URL must be the same shop."); return; }
            if (u2.href === u.href) { toast("Second page URL must be a different page (usually page 2)."); return; }
            page2 = u2.href;
          }
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
            sameName.page2Url = page2;
          } else {
            const cat = { id: "cat-" + Date.now().toString(36), name, url: u.href, page2Url: page2 };
            shop.categories.push(cat);
            shop.categoryIds = [...new Set([...(shop.categoryIds || []), cat.id])];
          }
          await action({ action: "saveDesk", desk });
          toast(name + " saved for " + (shop.name || shop.id) + (page2 ? ". Scraper will step page 2, 3, 4… and stop on heavy Tükendi." : ". Add the second page URL so paging is known.") + ".");
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

    document.addEventListener("change", async (e) => {
      if (e.target.id === "hide-published") {
        state.hidePublished = e.target.checked;
        try { localStorage.setItem("admin.hidePublished", state.hidePublished ? "1" : "0"); } catch (_) { /* storage blocked: kept for this visit */ }
        state.pager.runs = { page: 1 };
        repaintRuns();
        return;
      }
      if (e.target.matches("[data-pager-size]")) {
        const key = e.target.closest("[data-pager]").dataset.pager;
        state.pageSize = Number(e.target.value) || 0;
        try { localStorage.setItem("admin.pageSize", String(state.pageSize)); } catch (_) { /* storage blocked: kept for this visit */ }
        for (const k of Object.keys(state.pager)) state.pager[k] = { page: 1 };
        repaintPager(key);
        return;
      }
      if (e.target.matches("[data-product-image], [data-baseline-image]")) {
        const id = e.target.dataset.productImage || e.target.dataset.baselineImage;
        try {
          const image = await prepareThumbnail(e.target.files && e.target.files[0]);
          state.pendingImages.set(id, image);
          const box = e.target.closest(".product-card").querySelector(".catalog-thumb");
          box.innerHTML = `<img src="${esc(image.preview)}" alt="Uploaded thumbnail preview">`;
          if (e.target.dataset.productImage) showCatalogDirtyCount();
          if (e.target.dataset.baselineImage) showBaselineDirtyCount();
          toast(e.target.dataset.baselineImage ? "Thumbnail ready. Press Save on this model." : "Thumbnail ready. Press Update catalog or Save to publish it.");
        } catch (err) { toast(err.message); e.target.value = ""; }
        return;
      }
      if (e.target.id === "auto-llm-match") {
        const on = e.target.checked === true;
        action({ action: "saveMatchSettings", autoLlmMatch: on }).then((saved) => {
          if (saved && saved.desk && state.data) state.data.desk = { ...state.data.desk, ...saved.desk };
          toast(on ? "Auto AI match on: one AI ask, extreme gray only." : "Auto AI match off: Magellan only, no AI server needed.");
        }).catch((err) => toast(err.message));
        return;
      }
      if (e.target.classList.contains("run-shop")) {
        const row = e.target.closest(".run-row");
        const cat = row.querySelector(".run-cat");
        const url = row.querySelector(".run-url");
        const keep = cat.value;
        cat.innerHTML = nameOptionsHtml(categoryNames(state.data), keep);
        if (keep) cat.value = keep;
        url.value = categoryUrlForShop(shopById(state.data, e.target.value), cat.value) || "";
        rememberRunRows();
        return;
      }
      if (e.target.classList.contains("run-cat")) {
        const row = e.target.closest(".run-row");
        const shopId = row.querySelector(".run-shop").value;
        const urlBox = row.querySelector(".run-url");
        const shop = shopById(state.data, shopId);
        const url = categoryUrlForShop(shop, e.target.value);
        urlBox.value = url || "";
        rememberRunRows();
        if (e.target.value && shopId && !url) toast("Add " + e.target.value + "’s URL on this shop. Names are shared; URLs are unique.");
        return;
      }
      if (e.target.classList.contains("run-url")) {
        rememberRunRows();
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
      if (e.target.dataset.baselineMove) {
        const id = e.target.dataset.baselineMove;
        const category = e.target.value;
        action({ action: "updateBaselineItem", id, patch: { category } }).then((res) => {
          if (res.baseline) state.data.baseline = res.baseline;
          painted.delete("#tab-baseline");
          render();
          toast("Category changed.");
        }).catch((err) => toast(err.message));
        return;
      }
      if (e.target.id === "baseline-category") {
        state.baselineCategory = e.target.value;
        painted.delete("#tab-baseline");
        paint("#tab-baseline", baselineHtml(state.data));
        return;
      }
      if (e.target.dataset.reviewPlace == null) return;
      const url = decodeURIComponent(e.target.dataset.reviewPlace);
      const raw = e.target.value || "create";
      const place = raw.startsWith("merge:")
        ? { action: "merge", candidateId: raw.slice(6) }
        : { action: "create", candidateId: "" };
      state.reviewPlace.set(url, place);
      const ev = cardEvent(url);
      const line = e.target.closest(".review-card")?.querySelector(".review-compare");
      if (line) line.textContent = compareText(ev, place);
      unlinkPlace(e.target.closest(".uncertain-card"), place);
      syncGroupPlace(e.target.closest(".uncertain-card"), place);
    });

    document.addEventListener("input", (e) => {
      if (e.target.tagName === "TEXTAREA") fitTextareas(e.target);
      const placeQ = e.target.getAttribute && e.target.getAttribute("data-review-place-q");
      if (placeQ != null) {
        fillPlaceHits(placeCard(e.target) || e.target.closest(".review-place-label"), decodeURIComponent(placeQ), e.target.value);
        return;
      }
      if (e.target.dataset.baselineField && e.target.dataset.baselineId) {
        const cur = state.baselineEdit.get(e.target.dataset.baselineId) || {};
        cur[e.target.dataset.baselineField] = tagFieldValue(e.target);
        state.baselineEdit.set(e.target.dataset.baselineId, cur);
        showBaselineDirtyCount();
        scheduleAutosave(e.target);
        return;
      }
      if (e.target.dataset.uncertainField && e.target.dataset.uncertainUrl) {
        const cur = state.uncertainEdit.get(e.target.dataset.uncertainUrl) || {};
        if (e.target.dataset.uncertainField === "color") {
          if (e.isTrusted) {
            delete cur.colorHex;
            const row = e.target.closest(".colour-row");
            if (row) {
              const st = rowColour(row);
              paintColourRow(row, { ...st, set: coloursIn(e.target.value), hexes: [], slot: 0 });
              delete cur.colorSet;
              delete cur.colorHexes;
            }
          }
          cur.colorName = e.target.value;
          cur.color = colourId(e.target.value) || e.target.value;
          state.uncertainEdit.set(e.target.dataset.uncertainUrl, cur);
          scheduleAutosave(e.target);
          return;
        }
        cur[e.target.dataset.uncertainField] = tagFieldValue(e.target);
        // Pack: a number of spools and a yes/no, whichever of the two you touched.
        if (["bundle", "packCount"].includes(e.target.dataset.uncertainField)) {
          const packCard = e.target.closest(".uncertain-card");
          const f = packCard ? uncertainFields(packCard) : {};
          cur.packCount = f.packCount || 0;
          cur.bundle = f.bundle === true;
          if (e.target.dataset.uncertainField === "packCount" && cur.packCount >= 2 && packCard) {
            const sel = packCard.querySelector('[data-uncertain-field="bundle"]');
            if (sel) sel.value = "yes";
          }
        }
        state.uncertainEdit.set(e.target.dataset.uncertainUrl, cur);
        if (["brand", "subBrand", "polymer", "variant", "name", "diameter", "bundle", "packCount"].includes(e.target.dataset.uncertainField)) refreshAutoPlace(e.target.closest(".uncertain-card"));
        // A linked group shares one spool type: change it once, every card of the group follows.
        if (e.target.dataset.uncertainField === "spoolMaterial") {
          const card = e.target.closest(".uncertain-card");
          const key = card && cardGroupKey(card);
          if (key && spoolGroup(key).spoolLinked !== false) {
            const value = e.target.value;
            setSpoolGroup(key, { spoolMaterial: value }).catch((err) => toast(err.message));
            for (const other of $$(".uncertain-card")) {
              if (other === card || cardGroupKey(other) !== key) continue;
              const sel = other.querySelector('[data-uncertain-field="spoolMaterial"]');
              if (sel) sel.value = value;
            }
          }
        }
        scheduleAutosave(e.target);
        const field = e.target.dataset.uncertainField;
        if (GROUP_FIELDS.includes(field)) syncGroupFields(e.target.closest(".uncertain-card"), ["bundle", "packCount"].includes(field) ? ["bundle", "packCount"] : [field]);
        return;
      }
      if (e.target.id === "review-job-select") {
        state.reviewJobId = e.target.value;
        state.reviewSelected.clear();
        state.reviewPlace.clear();
        state.pager.runs = { page: 1 };
        render();
        toast(state.reviewJobId ? "Showing run " + state.reviewJobId + " — collected cards are visible again." : "Showing the newest run with cards.");
        return;
      }
      if (e.target.id === "uncertain-shop") {
        state.uncertainShop = e.target.value;
        state.pager.uncertain = { page: 1 };
        painted.delete("#tab-uncertain");
        paint("#tab-uncertain", uncertainHtml(state.data));
        return;
      }
      if (e.target.id === "catalog-shelf") {
        state.catalogShelf = e.target.value;
        state.catalogLimit = 40;
        painted.delete("#tab-catalog");
        render();
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
      if (e.target.id === "baseline-q") {
        state.baselineQuery = e.target.value;
        painted.delete("#tab-baseline");
        paint("#tab-baseline", baselineHtml(state.data));
        const q = $("#baseline-q");
        if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
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
      if (!e.target.dataset.field) return;
      const edit = state.editing.get(id) || { ...original };
      edit[e.target.dataset.field] = e.target.type === "number" ? Number(e.target.value) : e.target.value;
      state.editing.set(id, edit);
      showCatalogDirtyCount();
    });

    for (const type of ["pointerdown", "focusin"]) {
      document.addEventListener(type, (e) => {
        const card = e.target.closest && e.target.closest(".uncertain-card");
        if (card && !e.target.closest("[data-card-undo], [data-card-redo]")) startCardHistory(card);
      }, true);
    }

    document.addEventListener("dblclick", (e) => {
      const dot = e.target.closest && e.target.closest(".uncertain-card .colour-dot");
      if (!dot) return;
      document.querySelectorAll(".fx-menu").forEach((m) => m.remove());
      const fx = dot.closest(".colour-row").dataset.fx || "";
      const option = (value, label) => `<button type="button" class="btn-sm ghost" data-colour-fx="${value}" aria-pressed="${fx === value}">${label}</button>`;
      dot.closest(".colour-field").insertAdjacentHTML("beforeend", `<span class="fx-menu" role="menu">${option("", "Plain")}${option("marble", "Marble")}${option("galaxy", "Galaxy")}</span>`);
    });

    // Opening a card's Goes-to dropdown loads the complete, current list for that card's category.
    const fillFullSelect = (e) => {
      const sel = e.target.closest && e.target.closest("select[data-review-place]");
      if (!sel || sel.dataset.full === "1") return;
      const ev = cardEvent(decodeURIComponent(sel.dataset.reviewPlace));
      const place = parsePlace(sel.value);
      sel.innerHTML = placeOptionsHtml(ev, place, "", true);
      sel.value = placeValue(place);
      sel.dataset.full = "1";
    };
    document.addEventListener("pointerdown", fillFullSelect, true);
    document.addEventListener("focusin", fillFullSelect, true);
    document.addEventListener("focusin", (e) => {
      const list = e.target.getAttribute && e.target.getAttribute("list");
      if (!list || !list.startsWith("dl-")) return;
      fillFilamentSuggestions(list, e.target.closest(".baseline-card"));
      // Browsers hide an empty datalist entirely, so say why there is no menu yet.
      if (!document.getElementById(list).options.length) e.target.placeholder = "None saved yet: type one, then Save";
    });

    // Shop Runs search: type to filter; "/" jumps to the box; Escape clears it.
    document.addEventListener("input", (e) => {
      if (e.target.id !== "review-search") return;
      clearTimeout(reviewSearchTimer);
      reviewSearchTimer = setTimeout(() => setReviewQuery(e.target.value), 120);
    });
    document.addEventListener("keydown", (e) => {
      if (e.target.id === "review-search" && e.key === "Escape") { e.target.value = ""; setReviewQuery(""); return; }
      if (e.key === "/" && state.tab === "runs" && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || "")) && document.getElementById("review-search")) { e.preventDefault(); document.getElementById("review-search").focus(); }
    });
    document.addEventListener("click", (e) => {
      const set = e.target.closest && e.target.closest("[data-review-search-set]");
      const tok = e.target.closest && e.target.closest("[data-review-search-token]");
      if (!set && !tok) return;
      e.preventDefault();
      const box = document.getElementById("review-search");
      let next = state.reviewQuery || "";
      if (set) next = set.dataset.reviewSearchSet;
      else {
        const token = tok.dataset.reviewSearchToken;
        const parts = next.split(/\s+(?=(?:[^"]*"[^"]*")*[^"]*$)/).filter(Boolean);
        next = (parts.includes(token) ? parts.filter((p) => p !== token) : [...parts, token]).join(" ");
      }
      if (box) box.value = next;
      setReviewQuery(next);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.classList.contains("tag-new")) { e.preventDefault(); addTagsFrom(e.target.closest(".tag-row")); }
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-tag-add]")) { addTagsFrom(e.target.closest(".tag-row")); return; }
      if (e.target.closest("[data-spool-chain]")) {
        const btn = e.target.closest("[data-spool-chain]");
        const card = btn.closest(".uncertain-card");
        const key = card && cardGroupKey(card);
        if (!key) return;
        const linked = btn.getAttribute("aria-pressed") === "true";
        const spool = card.querySelector('[data-uncertain-field="spoolMaterial"]');
        // Breaking keeps today's value as the group default; each card can then be changed on its own.
        const rfidBtn = card.querySelector('[data-uncertain-field="rfid"]');
        const rfidOn = !!(rfidBtn && rfidBtn.getAttribute("aria-pressed") === "true");
        setSpoolGroup(key, linked ? { spoolLinked: false, spoolMaterial: spool ? spool.value : "", rfid: rfidOn } : { spoolLinked: true, spoolMaterial: spool ? spool.value : "", rfid: rfidOn })
          .then(() => {
            for (const other of $$(".uncertain-card")) {
              if (cardGroupKey(other) !== key) continue;
              const b = other.querySelector("[data-spool-chain]");
              if (b) b.outerHTML = spoolRow(() => "", "", false, !linked).match(/<button type="button" class="btn-sm ghost spool-chain"[\s\S]*?<\/button>/)[0];
              if (!linked && spool) { const s = other.querySelector('[data-uncertain-field="spoolMaterial"]'); if (s) s.value = spool.value; }
              if (!linked) { const r = other.querySelector('[data-uncertain-field="rfid"]'); if (r) { r.setAttribute("aria-pressed", rfidOn ? "true" : "false"); r.value = rfidOn ? "yes" : ""; } }
            }
            toast(linked ? "Spool link broken for this group: edit each card on its own." : "Spool linked: this group shares one spool type again.");
          }).catch((err) => toast(err.message));
        return;
      }
      if (e.target.closest("[data-rfid-toggle]")) {
        const btn = e.target.closest("[data-rfid-toggle]");
        const on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", on ? "true" : "false");
        btn.value = on ? "yes" : "";
        btn.dispatchEvent(new Event("input", { bubbles: true }));
        // Linked group: one RFID for every card of the same brand / sub-brand / polymer / variant.
        const card = btn.closest(".uncertain-card");
        const key = card && cardGroupKey(card);
        if (key && spoolGroup(key).spoolLinked !== false) {
          setSpoolGroup(key, { rfid: on }).catch((err) => toast(err.message));
          for (const other of $$(".uncertain-card")) {
            if (other === card || cardGroupKey(other) !== key) continue;
            const r = other.querySelector('[data-uncertain-field="rfid"]');
            if (r) { r.setAttribute("aria-pressed", on ? "true" : "false"); r.value = on ? "yes" : ""; }
          }
        }
        return;
      }
      if (e.target.closest("[data-card-undo], [data-card-redo]")) {
        const card = e.target.closest(".uncertain-card");
        if (card) stepCardHistory(card, e.target.closest("[data-card-undo]") ? -1 : 1);
        return;
      }
      if (e.target.closest("[data-colour-plus]")) {
        const card = e.target.closest(".uncertain-card");
        const row = card.querySelector(".colour-row");
        const st = rowColour(row);
        if (st.set.length >= 6) return;
        // Put back the next colour the name mentions; if the name has none left, add a slot for the eyedropper.
        const fromName = cardColour({}, {}, card.querySelector('[data-uncertain-field="color"]').value).set.filter((id) => !st.set.includes(id));
        st.set.push(fromName[0] || st.set[st.set.length - 1] || colourId(card.querySelector('[data-uncertain-field="color"]').value) || "white");
        st.slot = st.set.length - 1;
        state.uncertainEdit.set(card.dataset.uncertainUrl, { ...state.uncertainEdit.get(card.dataset.uncertainUrl), colorSet: st.set, colorHexes: st.hexes });
        paintColourRow(row, st);
        scheduleAutosave(card);
        return;
      }
      if (e.target.closest("[data-colour-minus]")) {
        const card = e.target.closest(".uncertain-card");
        const row = card.querySelector(".colour-row");
        const st = rowColour(row);
        if (st.set.length < 2) return;
        st.set.pop();
        st.hexes = st.hexes.slice(0, st.set.length);
        st.slot = 0;
        state.uncertainEdit.set(card.dataset.uncertainUrl, { ...state.uncertainEdit.get(card.dataset.uncertainUrl), colorSet: st.set, colorHexes: st.hexes });
        paintColourRow(row, st);
        scheduleAutosave(card);
        return;
      }
      if (e.target.closest("[data-colour-fx]")) {
        const btn = e.target.closest("[data-colour-fx]");
        const card = btn.closest(".uncertain-card");
        const row = card.querySelector(".colour-row");
        const st = rowColour(row);
        st.fx = btn.dataset.colourFx;
        state.uncertainEdit.set(card.dataset.uncertainUrl, { ...state.uncertainEdit.get(card.dataset.uncertainUrl), colorEffect: st.fx });
        paintColourRow(row, st);
        btn.closest(".fx-menu").remove();
        scheduleAutosave(card);
        return;
      }
      if (!e.target.closest(".fx-menu")) document.querySelectorAll(".fx-menu").forEach((m) => m.remove());
      if (e.target.closest("[data-colour-dropper]")) {
        const card = e.target.closest(".uncertain-card");
        const slot = Number(e.target.closest("[data-colour-dropper]").dataset.slot) || 0;
        // ponytail: native EyeDropper (Chrome/Edge); other browsers get a toast, add <input type=color> if needed.
        if (!window.EyeDropper) { toast("This browser has no eyedropper. Use Chrome or Edge, or type the colour."); return; }
        new window.EyeDropper().open().then(({ sRGBHex }) => {
          const hex = String(sRGBHex).toLowerCase();
          const near = nearestColour(hex);
          setColourTone(card, near && near.id, hex, slot);
          toast("Picked " + hex + (near ? ": looks " + near.name : "") + ". The listing colour name stays. Not saved yet.");
        }).catch(() => { /* Esc cancels the picker */ });
        return;
      }
      if (e.target.closest("[data-colour-from-image]")) {
        const btn = e.target.closest("[data-colour-from-image]");
        const card = btn.closest(".uncertain-card");
        const img = card && card.querySelector(".catalog-thumb img");
        if (!img || btn.disabled) return;
        btn.disabled = true;
        colourFromImage(img.currentSrc || img.src).then((found) => {
          if (!found) { toast("No clear colour in this image. Type it instead."); return; }
          setColourTone(card, found.color, found.hex, 0);
          toast("Image looks " + toneName(found.color) + " (" + Math.round(found.confidence * 100) + "% of pixels). The listing colour name stays. Not saved yet.");
        }).catch((err) => toast("Could not read the image: " + err.message))
          .finally(() => { btn.disabled = false; });
        return;
      }
      if (e.target.closest("[data-tag-remove]")) {
        const field = e.target.closest(".tag-field").querySelector("[data-baseline-field],[data-uncertain-field]");
        e.target.closest(".tag-chip").remove();
        field.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
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
