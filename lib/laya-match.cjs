"use strict";

const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");

let child;
let ready;
let buffer = "";
const pending = new Map();

function start() {
  if (child && !child.killed) return ready;
  const root = path.join(__dirname, "..");
  const python = process.env.LAYA_PYTHON || path.join(root, ".venv-laya", "Scripts", "python.exe");
  child = spawn(python, [path.join(root, "scripts", "laya-match.py"), "--serve"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
  ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Laya startup timed out")), 60000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const nl = buffer.indexOf("\n");
        if (nl < 0) break;
        const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) { clearTimeout(timer); resolve(msg); continue; }
        const task = pending.get(msg.id);
        if (task) { pending.delete(msg.id); msg.error ? task.reject(new Error(msg.error)) : task.resolve(msg); }
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => { reject(new Error("Laya stopped (" + code + ")")); child = null; });
  });
  return ready;
}

async function score(name, candidates, { signal } = {}) {
  await start();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Laya match timed out")); }, 30000);
    const done = (fn) => (value) => { clearTimeout(timer); fn(value); };
    pending.set(id, { resolve: done(resolve), reject: done(reject) });
    if (signal) signal.addEventListener("abort", () => { pending.delete(id); reject(signal.reason || new Error("aborted")); }, { once: true });
    child.stdin.write(JSON.stringify({ id, name, candidates }) + "\n");
  });
}

module.exports = { score, health: start };
