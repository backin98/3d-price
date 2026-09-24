// Set or change the owner password for the local host.
//
// Writes OWNER_PASSWORD_HASH into .dev.vars using the exact `salt:hash` format
// lib/netlify-auth.cjs verifies with: scryptSync(password, salt, 64).toString("hex").
//
// The password is read from stdin so it never lands in shell history or in a
// process argument list.
//
// Usage:  npm run owner-password

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV_FILE = path.join(ROOT, ".dev.vars");

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

// Replace KEY=... in place, preserving comments and every other key.
function upsert(file, key, value) {
  const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split(/\r?\n/) : [];
  const out = [];
  let replaced = false;
  for (const line of lines) {
    const isAssignment = line.includes("=") && !/^\s*#/.test(line);
    if (!isAssignment || line.slice(0, line.indexOf("=")).trim() !== key) {
      out.push(line);
      continue;
    }
    if (!replaced) {
      out.push(`${key}=${value}`);
      replaced = true;
    }
  }
  if (!replaced) out.push(`${key}=${value}`);
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  fs.writeFileSync(file, out.join("\n") + "\n");
}

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: false });
    process.stderr.write(question);
    rl.once("line", (line) => {
      rl.close();
      resolve(line.trim());
    });
  });
}

const password = await prompt("New owner password: ");

if (password.length < 8) {
  console.error("\nPassword must be at least 8 characters. Nothing was written.");
  process.exit(1);
}

upsert(ENV_FILE, "OWNER_PASSWORD_HASH", hashPassword(password));
console.log(`\nOWNER_PASSWORD_HASH updated in ${ENV_FILE}`);
console.log("Restart the server for it to take effect:  npm run local");
