// Snapshot every piece of 3d Price data into one timestamped archive.
//
// Why: the app's state was split across the store (work/local-store), the data/
// mirrors, work/ logs, and files that exist ONLY on disk and are not tracked by
// git (notably "manual data base.txt", the 42-retailer list). The Netlify Blobs
// copy is gone, so the local disk is now the only source of truth.
//
// Usage:  npm run backup
//
// Writes work/backups/3d-price-data-<timestamp>.tar.gz and verifies it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Data-bearing paths. Root config files are included so the archive is
// self-describing; they are small.
const INCLUDE = [
  "work/local-store",
  "data",
  "sources",
  "public",
  "work/match-catalog.json",
  "work/poll.json",
  "work/abort-jobs.json",
  "work/desk-connection.json",
  "work/live-cat.json",
  "manual data base.txt",
  "README.md",
  "netlify.toml",
  "wrangler.jsonc",
  "vercel.json",
  "package.json"
];

// Never archive these: dependencies, VCS, local dev state, or the backups
// themselves (which would nest inside each other).
const EXCLUDE = [
  "node_modules",
  ".git",
  ".wrangler",
  ".venv-laya",
  "work/deploy",
  "work/backups",
  "Thumbs"
];

const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");

// IMPORTANT: pass a RELATIVE archive path to tar. GNU tar parses "C:\..." in a
// -f argument as a remote host spec and fails with "Cannot connect to C:".
const relOut = path.join("work", "backups", `3d-price-data-${stamp}.tar.gz`);
const absOut = path.join(ROOT, relOut);

fs.mkdirSync(path.join(ROOT, "work", "backups"), { recursive: true });

const included = INCLUDE.filter((item) => fs.existsSync(path.join(ROOT, item)));
const args = ["-czf", relOut, ...EXCLUDE.map((e) => `--exclude=${e}`), ...included];

console.log(`archiving ${included.length} paths...`);
execFileSync("tar", args, { cwd: ROOT, stdio: "inherit" });

const size = fs.statSync(absOut).size;
const entries = execFileSync("tar", ["-tzf", relOut], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 })
  .toString()
  .split("\n")
  .filter(Boolean).length;

// Fail loudly rather than leave a silently truncated archive behind.
execFileSync("gzip", ["-t", relOut], { cwd: ROOT });

console.log(`\narchive  : ${relOut}`);
console.log(`size     : ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`entries  : ${entries}`);
console.log("integrity: gzip OK");
