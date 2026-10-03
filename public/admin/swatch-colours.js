/* Swatch colours from a product photo: the true tone of the filament, and the stops of a gradient.
 *
 * Shared by the admin page (window.SwatchColours) and the tests / evaluation script (require).
 * Input is what a canvas gives: RGBA bytes, width, height. No browser APIs in here.
 *
 *   tone(rgba, w, h)            → { hex, confidence, share, lab } | null     one spool, one colour
 *   gradientStops(rgba, w, h, { max, minDeltaE, avoid })
 *                               → [{ hex, share, x, y }]                     distinct colours, in order along the spool
 *   deltaE(hexA, hexB)          → CIEDE2000 distance (under 2 is invisible, 5 is hard to see, over 15 is another colour)
 *
 * How it reads a photo, in the order a person would:
 *   1. the background is whatever the border of the photo is (white studio paper, a table); it is thrown away;
 *   2. glints (white specular spots) and the deepest shadow are thrown away; the middle of the picture counts more;
 *   3. the rest is grouped into shades (k-means in Lab, the space where distance means "looks different");
 *   4. the filament is the shade a spool is made of: the biggest coloured group; in a photo with no colour at all
 *      (black, white, grey filament) the biggest group away from the border, where the spool flange is;
 *   5. its tone is the middle of that group, so shading and a few bright pixels do not move it.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SwatchColours = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- colour maths --------------------------------------------------------------------------------------------
  const lin = (c) => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const unlin = (c) => { const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
  const fLab = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const gLab = (t) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);

  function rgbToLab(r, g, b) {
    const R = lin(r), G = lin(g), B = lin(b);
    const x = fLab((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const y = fLab(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const z = fLab((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function labToRgb(L, a, b) {
    const fy = (L + 16) / 116, fx = a / 500 + fy, fz = fy - b / 200;
    const x = gLab(fx) * 0.95047, y = gLab(fy), z = gLab(fz) * 1.08883;
    return [unlin(x * 3.2406 + y * -1.5372 + z * -0.4986), unlin(x * -0.9689 + y * 1.8758 + z * 0.0415), unlin(x * 0.0557 + y * -0.2040 + z * 1.0570)];
  }
  const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("");
  const labToHex = (lab) => hex(labToRgb(lab[0], lab[1], lab[2]));
  const hexToLab = (h) => { const n = parseInt(String(h).replace("#", ""), 16); return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255); };
  const chroma = (lab) => Math.hypot(lab[1], lab[2]);

  // CIEDE2000, the standard "how different do these two look".
  function de2000(l1, l2) {
    const rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.hypot(l1[1], l1[2]), C2 = Math.hypot(l2[1], l2[2]);
    const Cb = (C1 + C2) / 2;
    const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
    const a1 = (1 + G) * l1[1], a2 = (1 + G) * l2[1];
    const c1 = Math.hypot(a1, l1[2]), c2 = Math.hypot(a2, l2[2]);
    const h1 = c1 === 0 ? 0 : (Math.atan2(l1[2], a1) * deg + 360) % 360;
    const h2 = c2 === 0 ? 0 : (Math.atan2(l2[2], a2) * deg + 360) % 360;
    const dL = l2[0] - l1[0], dC = c2 - c1;
    let dh = h2 - h1;
    if (c1 * c2 === 0) dh = 0; else if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh * rad) / 2);
    const Lb = (l1[0] + l2[0]) / 2, Cm = (c1 + c2) / 2;
    let hb = h1 + h2;
    if (c1 * c2 !== 0) hb = Math.abs(h1 - h2) > 180 ? (hb + (h1 + h2 < 360 ? 360 : -360)) / 2 : hb / 2;
    const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
    const dTheta = 30 * Math.exp(-Math.pow((hb - 275) / 25, 2));
    const Rc = 2 * Math.sqrt(Math.pow(Cm, 7) / (Math.pow(Cm, 7) + Math.pow(25, 7)));
    const Sl = 1 + (0.015 * Math.pow(Lb - 50, 2)) / Math.sqrt(20 + Math.pow(Lb - 50, 2));
    const Sc = 1 + 0.045 * Cm, Sh = 1 + 0.015 * Cm * T;
    const Rt = -Math.sin(2 * dTheta * rad) * Rc;
    return Math.sqrt(Math.pow(dL / Sl, 2) + Math.pow(dC / Sc, 2) + Math.pow(dH / Sh, 2) + Rt * (dC / Sc) * (dH / Sh));
  }
  const deltaE = (a, b) => de2000(hexToLab(a), hexToLab(b));

  // ---- reading the photo ---------------------------------------------------------------------------------------
  // One entry per usable pixel: Lab, position, weight. Background, transparency, glints and pure shadow are dropped.
  function samples(rgba, w, h) {
    const n = w * h;
    const lab = new Array(n);
    const ok = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (rgba[o + 3] < 128) continue;
      lab[i] = rgbToLab(rgba[o], rgba[o + 1], rgba[o + 2]);
      ok[i] = 1;
    }
    // Background: the middle shade of the border ring (the outer 5% of the photo).
    const ring = Math.max(1, Math.round(Math.min(w, h) * 0.05));
    const edge = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) { const i = y * w + x; if (ok[i]) edge.push(lab[i]); }
    }
    let bg = null;
    if (edge.length) {
      const med = (k) => { const v = edge.map((p) => p[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
      bg = [med(0), med(1), med(2)];
      // A border that is not one flat shade (a busy table) is no background to subtract.
      const spread = edge.filter((p) => de2000(p, bg) < 9).length / edge.length;
      if (spread < 0.55) bg = null;
    }
    // The background is the part of that shade connected to the border: a white spool inside its flange is not paper.
    const isBg = new Uint8Array(n);
    if (bg) {
      const queue = [];
      const seed = (i) => { if (ok[i] && !isBg[i] && de2000(lab[i], bg) < 8) { isBg[i] = 1; queue.push(i); } };
      for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
      for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
      while (queue.length) {
        const i = queue.pop(), x = i % w, y = (i - x) / w;
        if (x > 0) seed(i - 1);
        if (x < w - 1) seed(i + 1);
        if (y > 0) seed(i - w);
        if (y < h - 1) seed(i + w);
      }
    }
    const keep = [];
    let minX = w, maxX = 0, minY = h, maxY = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ok[i] || isBg[i]) continue;
      const p = lab[i];
      if (p[0] < 2) continue;
      keep.push({ lab: p, x, y });
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (!keep.length) return { px: [], bg };
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const rx = Math.max(1, (maxX - minX) / 2), ry = Math.max(1, (maxY - minY) / 2);
    for (const s of keep) { const d = Math.pow((s.x - cx) / rx, 2) + Math.pow((s.y - cy) / ry, 2); s.w = Math.max(0.25, 1 - 0.55 * d); s.edge = d; }
    // Glints: much lighter than the colour around them and almost colourless.
    const ls = keep.map((s) => s.lab[0]).sort((a, b) => a - b);
    const medL = ls[Math.floor(ls.length / 2)];
    const px = keep.filter((s) => !(s.lab[0] > medL + 28 && chroma(s.lab) < 14 && medL < 85));
    return { px: px.length ? px : keep, bg };
  }

  // Deterministic k-means in Lab: starts from the heaviest pixel, then the farthest from those chosen.
  function kmeans(px, k) {
    if (!px.length) return [];
    k = Math.min(k, px.length);
    const step = Math.max(1, Math.floor(px.length / 1500));
    const pool = px.filter((_, i) => i % step === 0);
    const cents = [pool.reduce((a, b) => (b.w > a.w ? b : a)).lab.slice()];
    while (cents.length < k) {
      let far = null, farD = -1;
      for (const s of pool) { const d = Math.min(...cents.map((c) => de2000(c, s.lab))); if (d > farD) { farD = d; far = s; } }
      if (!far || farD < 3) break;
      cents.push(far.lab.slice());
    }
    let assign = new Array(pool.length).fill(0);
    for (let it = 0; it < 14; it++) {
      const sum = cents.map(() => [0, 0, 0, 0]);
      pool.forEach((s, i) => {
        let best = 0, bd = Infinity;
        for (let c = 0; c < cents.length; c++) { const d = (s.lab[0] - cents[c][0]) ** 2 + (s.lab[1] - cents[c][1]) ** 2 + (s.lab[2] - cents[c][2]) ** 2; if (d < bd) { bd = d; best = c; } }
        assign[i] = best;
        const t = sum[best]; t[0] += s.lab[0] * s.w; t[1] += s.lab[1] * s.w; t[2] += s.lab[2] * s.w; t[3] += s.w;
      });
      cents.forEach((c, i) => { const t = sum[i]; if (t[3] > 0) { c[0] = t[0] / t[3]; c[1] = t[1] / t[3]; c[2] = t[2] / t[3]; } });
    }
    // Final assignment of every pixel (not just the pool).
    const groups = cents.map((c) => ({ lab: c, members: [], weight: 0, edge: 0 }));
    for (const s of px) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const d = (s.lab[0] - cents[c][0]) ** 2 + (s.lab[1] - cents[c][1]) ** 2 + (s.lab[2] - cents[c][2]) ** 2; if (d < bd) { bd = d; best = c; } }
      groups[best].members.push(s); groups[best].weight += s.w; groups[best].edge += s.edge * s.w;
    }
    return groups.filter((g) => g.members.length);
  }

  // The middle of a group: the median of its lightness (trimmed) with the matching chroma, so shading does not drag it.
  function middle(group) {
    const m = group.members.slice().sort((a, b) => a.lab[0] - b.lab[0]);
    const lo = Math.floor(m.length * 0.12), hi = Math.max(lo + 1, Math.ceil(m.length * 0.88));
    const core = m.slice(lo, hi);
    const med = (k) => { const v = core.map((s) => s.lab[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
    return [med(0), med(1), med(2)];
  }

  function groupsOf(rgba, w, h, k) {
    const { px } = samples(rgba, w, h);
    if (px.length < 30) return { groups: [], total: 0 };
    const groups = kmeans(px, k);
    const total = groups.reduce((t, g) => t + g.weight, 0);
    groups.forEach((g) => { g.share = g.weight / total; g.edgeness = g.edge / g.weight; g.mid = middle(g); g.chroma = chroma(g.mid); });
    return { groups, total };
  }

  // Merge the two closest groups until every pair looks different (and there are at most `max`): one material seen under
  // light and shadow is one group, not three.
  function mergeLike(groups, minDeltaE, max) {
    let stops = groups.slice();
    for (;;) {
      let bi = -1, bj = -1, bd = Infinity;
      for (let i = 0; i < stops.length; i++) for (let j = i + 1; j < stops.length; j++) {
        const d = de2000(stops[i].mid, stops[j].mid);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
      if (bi < 0 || (bd >= minDeltaE && stops.length <= max)) break;
      const a = stops[bi], b = stops[bj], wt = a.weight + b.weight;
      const mid = [0, 1, 2].map((k) => (a.mid[k] * a.weight + b.mid[k] * b.weight) / wt);
      const members = a.members.concat(b.members);
      const merged = { mid: middle({ members }), members, weight: wt, share: a.share + b.share, edgeness: (a.edgeness * a.weight + b.edgeness * b.weight) / wt };
      merged.chroma = chroma(merged.mid);
      stops = stops.filter((_, i) => i !== bi && i !== bj).concat(merged);
    }
    return stops;
  }

  function tone(rgba, w, h) {
    const all = groupsOf(rgba, w, h, 6).groups;
    const groups = mergeLike(all, 14, Infinity);
    if (!groups.length) return null;
    // Coloured groups first: a spool is made of the colour; the flange and shadows are grey.
    const coloured = groups.filter((g) => g.chroma > 16 && g.share >= 0.08);
    let pick;
    if (coloured.length) {
      const score = (g) => g.share * (1.15 - 0.3 * Math.min(1, g.edgeness)) * (1 + Math.min(g.chroma, 70) / 100);
      pick = coloured.reduce((a, b) => (score(b) > score(a) ? b : a));
    } else {
      // No colour in the photo: black / white / grey filament. The biggest group, preferring the one nearest the middle.
      pick = groups.reduce((a, b) => (b.share * (1.3 - Math.min(1, b.edgeness)) > a.share * (1.3 - Math.min(1, a.edgeness)) ? b : a));
    }
    const rest = groups.filter((g) => g !== pick);
    const nearest = rest.length ? Math.min(...rest.map((g) => de2000(pick.mid, g.mid))) : 50;
    return {
      hex: labToHex(pick.mid),
      lab: pick.mid.map((v) => Math.round(v * 10) / 10),
      share: Math.round(pick.share * 100) / 100,
      confidence: Math.round(Math.max(0, Math.min(1, pick.share * 1.4 * Math.min(1, nearest / 20))) * 100) / 100
    };
  }

  // Merge groups that look alike, keep the ones that matter, order along the photo. Never returns two stops that
  // are closer than minDeltaE, nor one that is close to a colour in `avoid` (the stops already on the card).
  function gradientStops(rgba, w, h, opts = {}) {
    const max = opts.max || 6, minDeltaE = opts.minDeltaE || 14;
    const avoid = (opts.avoid || []).filter(Boolean).map(hexToLab);
    const { groups } = groupsOf(rgba, w, h, max + 3);
    if (!groups.length) return [];
    // A grey group at the border of a coloured photo is the spool flange, not a stop.
    const anyColour = groups.some((g) => g.chroma > 16 && g.share >= 0.08);
    let stops = groups.filter((g) => g.share >= 0.025 && !(anyColour && g.chroma < 10 && g.edgeness > 0.55));
    stops = mergeLike(stops, minDeltaE, max);
    stops = stops.filter((g) => !avoid.some((a) => de2000(a, g.mid) < minDeltaE));
    if (!stops.length) return [];
    stops.sort((a, b) => b.share - a.share);
    stops = stops.slice(0, max);
    const place = stops.map((g) => {
      const t = g.members.reduce((acc, s) => { acc.x += s.x * s.w; acc.y += s.y * s.w; acc.w += s.w; return acc; }, { x: 0, y: 0, w: 0 });
      return { g, x: t.x / t.w / w, y: t.y / t.w / h };
    });
    // Order along the direction the colours spread over the photo; when they sit in the same place (a gradient wound
    // on a spool), order them as a smooth ramp instead: nearest shade next, starting from the darkest.
    const mx = place.reduce((t, p) => t + p.x, 0) / (place.length || 1), my = place.reduce((t, p) => t + p.y, 0) / (place.length || 1);
    let sxx = 0, sxy = 0, syy = 0;
    place.forEach((p) => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; });
    const spread = Math.sqrt(Math.max(sxx, syy) / (place.length || 1));
    let ordered;
    if (place.length > 1 && spread > 0.07) {
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
      ordered = place.slice().sort((a, b) => ((a.x - mx) * ux + (a.y - my) * uy) - ((b.x - mx) * ux + (b.y - my) * uy));
    } else {
      const left = place.slice().sort((a, b) => a.g.mid[0] - b.g.mid[0]);
      ordered = [left.shift()];
      while (left.length) {
        const last = ordered[ordered.length - 1].g.mid;
        left.sort((a, b) => de2000(last, a.g.mid) - de2000(last, b.g.mid));
        ordered.push(left.shift());
      }
    }
    return ordered.map((p) => ({ hex: labToHex(p.g.mid), share: Math.round(p.g.share * 100) / 100, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
  }

  return { tone, gradientStops, deltaE, rgbToLab, labToRgb, hexToLab, labToHex };
});
