#!/usr/bin/env bash
# One command to install, start and supervise the worker.
#   bash scripts/worker-setup.sh
# Detects the OS, installs pm2 if missing, starts the worker under it, saves the process list,
# and wires restart-on-boot where the platform supports it.
set -euo pipefail
cd "$(dirname "$0")/.."

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) OS=windows ;;
  Darwin) OS=mac ;;
  Linux)  OS=linux ;;
  *) OS=unknown ;;
esac
echo "OS: $OS"

if ! command -v node >/dev/null 2>&1; then echo "Node is not installed. Install Node 20+ first."; exit 1; fi
if [ ! -f .env ]; then echo "No .env here. The worker needs INGEST_TOKEN in .env"; exit 1; fi
grep -q '^INGEST_TOKEN=' .env || echo "warning: .env has no INGEST_TOKEN - the worker will not poll"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "Installing pm2 (global)..."
  npm install -g pm2
fi

# startOrReload keeps a single supervised process whether or not it was already running.
pm2 startOrReload worker/online-worker.cjs --name online-worker --restart-delay 5000 --time
pm2 save

if [ "$OS" = "windows" ]; then
  cat <<'MSG'

Started and saved. On Windows pm2 cannot install a boot service from here.
To survive reboots, pick one:
  A) Task Scheduler -> Create Task -> Trigger: "At log on" -> Action: pm2 resurrect
     (use the full path from:  where pm2)
  B) nssm install online-worker  (nssm.cc) -> Application: node.exe
                                       Arguments: worker/online-worker.cjs
MSG
else
  echo "Wiring restart-on-boot (needs sudo the first time)..."
  pm2 startup || echo "pm2 startup needs to be run as root once; copy the command it prints."
fi

echo
echo "worker:  pm2 status / pm2 logs online-worker"
echo "stop:    pm2 stop online-worker"
echo "restart: pm2 restart online-worker"
