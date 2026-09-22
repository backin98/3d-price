"""Train and serve the catalog matcher backed by Laya's multilingual encoder."""
import argparse, json, os, random, re, sys
from pathlib import Path

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import torch
from laya.agent import Agent

ROOT = Path(__file__).resolve().parents[1]
BASELINE = ROOT / "data" / "laya-baseline.json"
HEAD = ROOT / "data" / "laya-catalog-head.pt"


def load_agent():
    return Agent("convaiinnovations/laya", subfolder="multilingual", device="cpu")


def encode(agent, texts, batch=32):
    rows = []
    for at in range(0, len(texts), batch):
        tok = agent.tok(texts[at:at + batch], padding=True, truncation=True, max_length=96, return_tensors="pt")
        tok = {k: v.to(agent.device) for k, v in tok.items()}
        with torch.inference_mode():
            hidden = agent.model.encoder(**tok).last_hidden_state.float()
            mask = tok["attention_mask"].unsqueeze(-1)
            pooled = (hidden * mask).sum(1) / mask.sum(1).clamp_min(1)
            rows.append(torch.nn.functional.normalize(pooled, dim=1).cpu())
    return torch.cat(rows)


def feature(a, b):
    return torch.cat(((a - b).abs(), a * b), dim=-1)


def variants(name):
    base = " ".join(str(name).split())
    rows = [
        base, base.lower(), base.replace("-", " "),
        base + " 3D Yazıcı", base + " 3D Printer",
        re.sub(r"\b(pro|plus|max|mini|ultra|lite|neo|turbo|se|ke|xl)\s+combo\b", r"\1Combo", base, flags=re.I),
    ]
    if "combo" in base.lower(): rows += [base + " Çok Renkli Baskı Sistemi", base + " Multicolor Printing"]
    return list(dict.fromkeys(rows))


def train():
    random.seed(7); torch.manual_seed(7)
    board = json.loads(BASELINE.read_text(encoding="utf-8"))
    items = [x for x in board["items"] if x.get("name")]
    names = [x["name"] for x in items]
    eval_rows = [json.loads(line) for line in (ROOT / "docs" / "laya-eval.jsonl").read_text(encoding="utf-8").splitlines() if line]
    texts = list(dict.fromkeys([*(v for name in names for v in variants(name)),
                                *(str(r[k]) for r in eval_rows for k in ("a", "b"))]))
    agent = load_agent()
    vectors = dict(zip(texts, encode(agent, texts)))
    pairs = []
    for i, name in enumerate(names):
        vv = variants(name)
        anchor = vv[0]
        for v in vv[1:]: pairs.append((anchor, v, 1.0))
        brand = str(items[i].get("brand") or "").casefold().strip()
        others = [x["name"] for x in items if x["name"] != name and brand and str(x.get("brand") or "").casefold().strip() == brand]
        others += [names[(i + step) % len(names)] for step in (1, 3, 11, 29) if names[(i + step) % len(names)] != name]
        others = list(dict.fromkeys(others))
        for other in others: pairs.append((anchor, variants(other)[0], 0.0))
    pairs.extend((r["a"], r["b"], 1.0 if r["label"] == "same" else 0.0) for r in eval_rows)
    random.shuffle(pairs)
    x = torch.stack([feature(vectors[a], vectors[b]) for a, b, _ in pairs])
    y = torch.tensor([label for _, _, label in pairs]).unsqueeze(1)
    hidden = 128
    head = torch.nn.Sequential(torch.nn.Linear(x.shape[1], hidden), torch.nn.GELU(), torch.nn.Linear(hidden, 1))
    opt = torch.optim.AdamW(head.parameters(), lr=0.003, weight_decay=0.001)
    for _ in range(300):
        opt.zero_grad(); loss = torch.nn.functional.binary_cross_entropy_with_logits(head(x), y); loss.backward(); opt.step()
    with torch.inference_mode():
        pred = (torch.sigmoid(head(x)) >= 0.8).float()
        accuracy = (pred == y).float().mean().item()
        false_merges = int(((pred == 1) & (y == 0)).sum())
        eval_x = torch.stack([feature(vectors[r["a"]], vectors[r["b"]]) for r in eval_rows])
        eval_y = torch.tensor([r["label"] == "same" for r in eval_rows])
        eval_pred = torch.sigmoid(head(eval_x)).squeeze(1) >= 0.8
        eval_accuracy = (eval_pred == eval_y).float().mean().item()
        eval_false_merges = int((eval_pred & ~eval_y).sum())
    torch.save({"state": head.state_dict(), "input": x.shape[1], "hidden": hidden, "threshold": 0.8,
                "baselineItems": len(names), "accuracy": accuracy, "falseMerges": false_merges,
                "evalAccuracy": eval_accuracy, "evalFalseMerges": eval_false_merges}, HEAD)
    print(json.dumps({"saved": str(HEAD), "items": len(names), "pairs": len(pairs),
                      "accuracy": round(accuracy, 4), "falseMerges": false_merges,
                      "evalAccuracy": round(eval_accuracy, 4), "evalFalseMerges": eval_false_merges}))


def serve():
    agent = load_agent()
    saved = torch.load(HEAD, map_location="cpu", weights_only=True)
    head = torch.nn.Sequential(torch.nn.Linear(saved["input"], saved["hidden"]), torch.nn.GELU(), torch.nn.Linear(saved["hidden"], 1))
    head.load_state_dict(saved["state"]); head.eval()
    threshold = float(saved.get("threshold", 0.8))
    print(json.dumps({"ready": True, "model": "laya-multilingual+catalog-head", "items": saved.get("baselineItems", 0)}), flush=True)
    for line in sys.stdin:
        try:
            req = json.loads(line); candidates = req.get("candidates") or []
            texts = [str(req.get("name") or "")] + [str(c.get("name") or "") for c in candidates]
            emb = encode(agent, texts)
            with torch.inference_mode():
                scores = torch.sigmoid(head(torch.stack([feature(emb[0], emb[i + 1]) for i in range(len(candidates))]))).squeeze(1).tolist() if candidates else []
            out = [{"id": c.get("id"), "score": round(float(s), 6)} for c, s in zip(candidates, scores)]
            print(json.dumps({"id": req.get("id"), "matches": out, "threshold": threshold}), flush=True)
        except Exception as exc:
            print(json.dumps({"id": req.get("id") if 'req' in locals() else None, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--train", action="store_true"); parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    if args.train: train()
    elif args.serve: serve()
    else: parser.error("choose --train or --serve")
