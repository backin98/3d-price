"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_CATEGORIES = [
  { id: "printers", name: "3D Printers" },
  { id: "filaments", name: "Filament" }
];

const BACKUP_PRINTERS = path.join(__dirname, "..", "data", "v001-printers.json");

function emptyBoard() {
  return {
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    items: [],
    updatedAt: new Date().toISOString()
  };
}

function loadBackupPrinters() {
  try {
    const data = JSON.parse(fs.readFileSync(BACKUP_PRINTERS, "utf8"));
    return Array.isArray(data.products) ? data.products : [];
  } catch {
    return [];
  }
}

function categoryId(name) {
  const id = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return id || "cat-" + Date.now().toString(36);
}

function foldKey(it) {
  return String(it.brand || "").trim().toLowerCase() + "\n" + String(it.name || "").trim().toLowerCase();
}

function kindOf(it) {
  return it.kind === "filament" || it.category === "filaments" ? "filament" : "printer";
}

function itemForProduct(board, product) {
  const items = (board && board.items) || [];
  const exact = items.find((it) => it.id === product.id);
  if (exact) return exact;
  const folded = items.filter((it) => kindOf(it) === kindOf(product) && foldKey(it) === foldKey(product));
  if (folded.length === 1) return folded[0];
  const { decidePair } = require("./product-match.cjs");
  const matches = items.filter((it) => kindOf(it) === kindOf(product)
    && decidePair({ ...product, kind: kindOf(product) }, { ...it, kind: kindOf(it) }).action === "merge");
  return matches.length === 1 ? matches[0] : null;
}

function applyBaselineImages(catalog, board) {
  for (const product of [...((catalog && catalog.products) || []), ...((catalog && catalog.filaments) || [])]) {
    const item = itemForProduct(board, product);
    if (!item || !item.image) continue;
    product.image = item.image;
    product.imageSource = "baseline";
    product.baselineId = item.id;
  }
  return catalog;
}

function sanitizeItem(it) {
  if (!it || typeof it !== "object") return null;
  const id = String(it.id || "").trim();
  const name = String(it.name || it.title || "").trim();
  if (!id || !name) return null;
  return {
    id,
    category: String(it.category || "printers").trim() || "printers",
    name,
    brand: String(it.brand || "").trim(),
    image: String(it.image || "").trim(),
    addedAt: it.addedAt || new Date().toISOString()
  };
}

function ensureCategories(board) {
  const cats = [];
  const seen = new Set();
  for (const c of [...DEFAULT_CATEGORIES, ...((board && board.categories) || [])]) {
    const id = String(c.id || categoryId(c.name) || "").trim();
    const name = String(c.name || id).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    cats.push({ id, name });
  }
  for (const it of (board && board.items) || []) {
    const id = String(it.category || "printers");
    if (seen.has(id)) continue;
    seen.add(id);
    cats.push({ id, name: id });
  }
  return cats;
}

function sanitizeBoard(board) {
  const next = emptyBoard();
  const items = ((board && board.items) || []).map(sanitizeItem).filter(Boolean);
  next.items = items;
  next.categories = ensureCategories({ ...(board || {}), items });
  next.updatedAt = (board && board.updatedAt) || next.updatedAt;
  return next;
}

function isIdentityStyleBoard(board) {
  const items = board && board.items;
  if (!items || !items.length) return false;
  let n = 0;
  for (const it of items) {
    const id = String(it.identityId || it.id || "");
    const slashId = id.includes("/") && !/^https?:/i.test(id) && !id.startsWith("qwen-") && !id.startsWith("sel-") && !id.startsWith("bl-");
    const noName = !it.name || it.name === id;
    if (slashId && (noName || !(it.brand))) n += 1;
  }
  return n >= Math.max(1, items.length * 0.6);
}

function fromProduct(p, origin) {
  const kind = p.kind === "filament" || origin === "filaments" ? "filaments" : "printers";
  return sanitizeItem({
    id: p.id || p.name,
    category: p.category || kind,
    name: p.name || p.title || p.id,
    brand: p.brand || "",
    image: p.image || ""
  });
}

function fromRunCard(card, job) {
  const kind = (job && job.kind) === "filament" || card.kind === "filament" ? "filaments" : "printers";
  return sanitizeItem({
    id: card.id || card.name,
    category: kind,
    name: card.name,
    brand: card.brand || "",
    image: card.image || ""
  });
}

function upsertItems(board, incoming) {
  const items = [...(board.items || [])];
  const byId = new Map(items.map((i) => [i.id, i]));
  const byFold = new Map(items.map((i) => [foldKey(i), i]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming || []) {
    const it = sanitizeItem(raw);
    if (!it) continue;
    const old = byId.get(it.id) || byFold.get(foldKey(it));
    if (!old) {
      items.push(it);
      byId.set(it.id, it);
      byFold.set(foldKey(it), it);
      added += 1;
      continue;
    }
    if (it.image && !old.image) old.image = it.image;
    if (it.brand && !old.brand) old.brand = it.brand;
    updated += 1;
  }
  board.items = items;
  board.categories = ensureCategories(board);
  board.updatedAt = new Date().toISOString();
  return { added, updated, total: items.length };
}

function addCategory(board, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Category name required");
  const id = categoryId(trimmed);
  board.categories = ensureCategories(board);
  if (board.categories.some((c) => c.id === id || c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That category already exists");
  }
  board.categories.push({ id, name: trimmed });
  board.updatedAt = new Date().toISOString();
  return { id, name: trimmed };
}

function renameCategory(board, id, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("Category name required");
  board.categories = ensureCategories(board);
  const cat = board.categories.find((c) => c.id === id);
  if (!cat) throw new Error("Category not found");
  if (board.categories.some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That category already exists");
  }
  cat.name = trimmed;
  board.updatedAt = new Date().toISOString();
  return cat;
}

function setItemCategory(board, id, category) {
  const item = (board.items || []).find((i) => i.id === id);
  if (!item) throw new Error("Model not found");
  const cats = ensureCategories(board);
  if (!cats.some((c) => c.id === category)) throw new Error("Pick an existing category");
  item.category = category;
  board.categories = cats;
  board.updatedAt = new Date().toISOString();
  return item;
}

function patchItem(board, id, patch) {
  const item = (board.items || []).find((i) => i.id === id);
  if (!item) throw new Error("Model not found");
  if (patch.name != null) {
    const name = String(patch.name).trim();
    if (!name) throw new Error("Name required");
    item.name = name;
  }
  if (patch.brand != null) item.brand = String(patch.brand).trim();
  if (patch.image != null) item.image = String(patch.image).trim();
  if (patch.category != null) setItemCategory(board, id, String(patch.category));
  board.updatedAt = new Date().toISOString();
  return item;
}

function addItem(board, raw) {
  const it = sanitizeItem({
    id: raw.id || "bl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
    category: raw.category,
    name: raw.name,
    brand: raw.brand,
    image: raw.image
  });
  if (!it) throw new Error("Name required");
  const cats = ensureCategories(board);
  if (!cats.some((c) => c.id === it.category)) throw new Error("Pick an existing category");
  if ((board.items || []).some((i) => i.id === it.id || foldKey(i) === foldKey(it))) {
    throw new Error("That model is already on the baseline");
  }
  board.categories = cats;
  board.items = [...(board.items || []), it];
  board.updatedAt = new Date().toISOString();
  return it;
}

module.exports = {
  DEFAULT_CATEGORIES,
  emptyBoard,
  loadBackupPrinters,
  isIdentityStyleBoard,
  sanitizeBoard,
  sanitizeItem,
  fromProduct,
  fromRunCard,
  upsertItems,
  addCategory,
  renameCategory,
  setItemCategory,
  patchItem,
  addItem,
  categoryId,
  itemForProduct,
  applyBaselineImages
};
