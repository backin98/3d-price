import os, time, json, traceback, inspect, sys
# Windows consoles default to cp1252 and this script prints Turkish titles ("Yazıcı" has U+0131).
# Without this, printing the title raises UnicodeEncodeError and kills the run - which is exactly
# what happened on the first attempt, after the model had already answered.
for _stream in ("stdout", "stderr"):
    try: getattr(sys, _stream).reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass
os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
out = []
def log(*a):
    line = " ".join(str(x) for x in a)
    try: print(line, flush=True)
    except Exception: print(line.encode("ascii","replace").decode("ascii"), flush=True)
    out.append(line)
    try: open("docs/laya-smoke.txt","w",encoding="utf-8").write("\n".join(out)+"\n")
    except Exception: pass

from laya import Router
log("laya Router.__init__:", str(inspect.signature(Router.__init__)))
log("laya Router.predict :", str(inspect.signature(Router.predict)))
log("")

t = time.time()
try:
    r = Router()
    log("Router() built in %.1fs" % (time.time()-t))
except Exception as e:
    log("Router() FAILED:", type(e).__name__, str(e)[:400])
    traceback.print_exc(); raise SystemExit(1)

# One state per title, one typed question, so the raw shape is visible.
QUESTIONS = {
  "is_printer": {"type": "noul",
                 "instructions": "Is this listing an actual 3D printer, rather than an accessory, spare part, filament, nozzle, enclosure or a standalone laser module?"},
  "same_as_h2c_combo_laser": {"type": "choice",
                 "instructions": "Is this listing the same product and configuration as 'Bambu Lab H2C Combo Laser 10 Watt'?",
                 "criteria": {"same": "identical product and configuration",
                              "different": "a different product or configuration"}},
}
TITLES = [
  "Bambu Lab H2C 10 Watt Combo 3D Yazıcı",
  "Bambu Lab H2C Combo Laser 10 Watt 3D Yazıcı",
  "Bambu Lab A1 tarzı nozzle uyumlu yedek parça",
]
for title in TITLES:
    for ckpt in ["multilingual", None]:
        t = time.time()
        try:
            res = r.predict(title, QUESTIONS, model=ckpt) if ckpt else r.predict(title, QUESTIONS)
            log("=== %-28s model=%s  %.2fs" % ("", ckpt, time.time()-t))
            log("    title:", title)
            log("    routing:", json.dumps(res.get("routing"), ensure_ascii=False)[:200])
            log("    raw:", json.dumps(res, ensure_ascii=False)[:900])
        except Exception as e:
            log("!!! predict failed title=%r model=%s: %s: %s" % (title, ckpt, type(e).__name__, str(e)[:250]))
log("\nsaved -> docs/laya-smoke.txt")
