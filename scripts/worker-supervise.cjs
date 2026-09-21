#!/usr/bin/env node
"use strict";

// Keep the worker alive without pm2.
//
// pm2 crashes on this machine's Node (26.x): "TypeError: Cannot read properties of undefined
// (reading 'deploy')" inside pm2's own API._startJson, so `pm2 start` never launches anything. This
// supervisor needs no global install and does the one thing that matters: restart the worker when it
// dies, with backoff so a crash loop cannot spin, and one line saying why it died.
//
//   node scripts/worker-supervise.cjs
//
// Worker output is passed through to this terminal AND appended to work/worker.log.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const LOG = path.join(ROOT, "work", "worker.log");
const WORKER = path.join(ROOT, "worker", "online-worker.cjs");

fs.mkdirSync(path.dirname(LOG), { recursive: true });
const log = fs.createWriteStream(LOG, { flags: "a" });
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);
const say = (msg) => { const line = "[" + stamp() + "] " + msg; console.log(line); log.write(line + "\n"); };

let child = null;
let stopping = false;
let delay = 1000;

function start() {
  say("starting worker (pid will follow)");
  child = spawn(process.execPath, [WORKER], { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  say("worker pid " + child.pid);
  child.stdout.on("data", (b) => { process.stdout.write(b); log.write(b); });
  child.stderr.on("data", (b) => { process.stderr.write(b); log.write(b); });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    say("worker exited (code " + code + (signal ? ", signal " + signal : "") + ") - restarting in " + Math.round(delay / 1000) + "s");
    // A worker that dies instantly would otherwise respawn as fast as the OS allows.
    setTimeout(start, delay);
    delay = Math.min(delay * 2, 60000);
  });
}

process.on("SIGINT", () => { stopping = true; say("supervisor stopping"); if (child) child.kill(); process.exit(0); });
process.on("SIGTERM", () => { stopping = true; if (child) child.kill(); process.exit(0); });

start();
