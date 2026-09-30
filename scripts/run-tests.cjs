#!/usr/bin/env node
"use strict";

// Every scripts/*.test.cjs, one after another. They are plain Node scripts: a failing file exits non-zero.
// Works the same in PowerShell, cmd and bash.
//
//   npm test                  # all of them
//   npm test -- filament      # only files whose name contains "filament"
//
// The *-browser tests drive Chromium: `npx playwright install chromium` once if they cannot find it.

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const filter = process.argv.slice(2).join(" ").trim().toLowerCase();
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.cjs") && (!filter || f.toLowerCase().includes(filter))).sort();
const failed = [];
const started = Date.now();
for (const file of files) {
  const t0 = Date.now();
  const res = spawnSync(process.execPath, [path.join(dir, file)], { cwd: path.join(dir, ".."), encoding: "utf8", timeout: 5 * 60000 });
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status === 0) {
    console.log("PASS " + file + " (" + seconds + " s)");
  } else {
    failed.push(file);
    const out = (String(res.stdout || "") + String(res.stderr || "")).trim().split(/\r?\n/).slice(-12).join("\n    ");
    console.log("FAIL " + file + " (" + seconds + " s" + (res.error ? ", " + res.error.message : "") + ")\n    " + out);
  }
}
console.log("\n" + (files.length - failed.length) + "/" + files.length + " passed in " + Math.round((Date.now() - started) / 1000) + " s" + (failed.length ? " — failed: " + failed.join(", ") : ""));
process.exitCode = failed.length ? 1 : 0;
