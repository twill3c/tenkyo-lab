# -*- coding: utf-8 -*-
"""
模型の語彙表を刈る(kototoi-do scripts/prune_model.py から流用)。

multilingual-e5-small は 112.8 MB のうち 96 MB(82%)が語彙表である。
XLM-R の 250,002 語には世界中の文字が入っているが、このアプリが要るのは日本語と
ごく短い ASCII だけである。使わない行を落とせば、閲覧者に配る量が三分の一になる。

量子化はテンソル全体で 1 つの倍率(per-tensor)なので、行を抜き出すだけでよい。
倍率もゼロ点もそのまま使える。
"""
import argparse, json, re, sys
import numpy as np
import onnx
from onnx import numpy_helper

AP = argparse.ArgumentParser()
AP.add_argument("--src", default="data/model-src")
AP.add_argument("--out", default="public/tenkyo/model")
AP.add_argument("--ascii-max", type=int, default=8, help="残す ASCII トークンの最大長")
A = AP.parse_args()

import os
os.makedirs(os.path.join(A.out, "onnx"), exist_ok=True)

# ---- 1. 残すトークンを選ぶ ----
tk = json.load(open(os.path.join(A.src, "tokenizer.json"), encoding="utf-8"))
vocab = tk["model"]["vocab"]
# かな・漢字だけでは足りない。々〆「」、。〜 は U+3000-303F にあり、
# 全角英数と半角カナは U+FF00-FFEF にある。ここを落とすと日本語の分かち方が変わる。
JP = re.compile(
    "[　-〿぀-ヿ㆐-㆟ㇰ-ㇿ"
    "㐀-䶿一-鿿豈-﫿︰-﹏＀-￯]")
ASCII = re.compile(r"^[\x20-\x7e]+$")

keep = [0, 1, 2, 3]  # <s> <pad> </s> <unk>
for i in range(4, len(vocab)):
    t = vocab[i][0].lstrip("▁")
    if not t:
        keep.append(i)          # ▁ 単体(語頭マーカ)は残す
    elif JP.search(t):
        keep.append(i)
    elif ASCII.match(t) and len(t) <= A.ascii_max:
        keep.append(i)
# 長さで機械的に切ると、e5 が要求する "query: " 接頭辞のトークンまで落ちる。
# 元のトークナイザに実際に聞いて集めた「必ず残す」一覧を足す(scripts/keep-extra.mjs)。
extra_path = "data/keep-extra.json"
if os.path.exists(extra_path):
    extra = json.load(open(extra_path, encoding="utf-8"))["ids"]
    keep.extend(extra)
    print(f"必ず残すトークン {len(extra)} 件を追加")
else:
    sys.exit("data/keep-extra.json が無い — 先に node scripts/keep-extra.mjs を走らせること")

mask_id = len(vocab) - 1        # <mask> は語彙の末尾
if mask_id not in keep:
    keep.append(mask_id)
keep = sorted(set(keep))
old2new = {o: n for n, o in enumerate(keep)}
print(f"語彙 {len(vocab):,} → {len(keep):,}({len(keep)/len(vocab)*100:.1f}%)")

# ---- 2. トークナイザを書き直す ----
tk["model"]["vocab"] = [vocab[i] for i in keep]
tk["model"]["unk_id"] = old2new[3]
for a in tk.get("added_tokens", []):
    if a["id"] not in old2new:
        sys.exit(f"追加トークン {a['content']}(id={a['id']})が刈られている")
    a["id"] = old2new[a["id"]]
# TemplateProcessing が持つ特殊トークン ID も張り替える
pp = tk.get("post_processor") or {}
for st in (pp.get("special_tokens") or {}).values():
    st["ids"] = [old2new[i] for i in st["ids"]]
json.dump(tk, open(os.path.join(A.out, "tokenizer.json"), "w", encoding="utf-8"), ensure_ascii=False)

for f in ("config.json", "tokenizer_config.json"):
    open(os.path.join(A.out, f), "w", encoding="utf-8").write(
        open(os.path.join(A.src, f), encoding="utf-8").read())

# ---- 3. ONNX の語彙表から行を抜き出す ----
m = onnx.load(os.path.join(A.src, "onnx/model_quantized.onnx"))
TGT = "embeddings.word_embeddings.weight_quantized"
for i, init in enumerate(m.graph.initializer):
    if init.name != TGT:
        continue
    W = numpy_helper.to_array(init)
    print(f"語彙表 {W.shape} {W.dtype} → 行を {len(keep):,} 本に絞る")
    W2 = np.ascontiguousarray(W[keep])
    new = numpy_helper.from_array(W2, name=TGT)
    m.graph.initializer[i].CopyFrom(new)
    break
else:
    sys.exit(f"{TGT} が見つからない — 模型の構造が変わっている")

dst = os.path.join(A.out, "onnx/model_quantized.onnx")
onnx.save(m, dst)
mb = lambda p: os.path.getsize(p) / 1048576
print(f"""
  模型      {mb(os.path.join(A.src, 'onnx/model_quantized.onnx')):.1f} MB → {mb(dst):.1f} MB
  語彙      {mb(os.path.join(A.src, 'tokenizer.json')):.1f} MB → {mb(os.path.join(A.out, 'tokenizer.json')):.1f} MB""")
json.dump({"kept": len(keep), "total": len(vocab), "old2new_sample": keep[:8]},
          open(os.path.join(A.out, "prune.json"), "w"), ensure_ascii=False)
