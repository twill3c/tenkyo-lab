"""G-04 二実装照合の Python 側。scripts/dump-ranks.mjs と同じ形で吐く。

TS 側の出力は読まない。**同じ入力から独立に計算する**。
読んでしまうと照合ではなく写経になる。
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tenkyo as T  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DIMS = 384
SPARSE_QUERIES = 200
DENSE_QUERIES = 20
TOPK = 20


def sha(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def stride(n: int, want: int) -> list[int]:
    """等間隔。TS 側と同じ問いを見るため乱数を使わない。"""
    step = max(1, n // want)
    out = []
    i = 0
    while i < n and len(out) < want:
        out.append(i)
        i += step
    return out


def main() -> None:
    chunks = json.loads((ROOT / "data/chunks.json").read_text(encoding="utf-8"))["chunks"]
    items = json.loads((ROOT / "data/oracle.json").read_text(encoding="utf-8"))["items"]
    vecs = T.read_f32(str(ROOT / "data/index/vec_f32.bin"))
    qvecs = T.read_f32(str(ROOT / "data/index/query_f32.bin"))
    ids = [c["id"] for c in chunks]

    # --- 層 1: 分かち書き(網羅) ---
    token_hashes = {
        "chunks": [sha("".join(T.bigrams(c["indexText"]))) for c in chunks],
        "queries": [sha("".join(T.bigrams(it["query"]))) for it in items],
        "lengths": sha(",".join(str(T.token_length(c["indexText"])) for c in chunks)),
    }
    print(f"層1 分かち書き: チャンク {len(token_hashes['chunks'])} / クエリ {len(token_hashes['queries'])}")

    # --- 層 2: 疎索引 ---
    ix = T.BM25Index([(c["id"], c["indexText"]) for c in chunks])
    terms = sorted(ix.postings.keys())
    sparse_index = {
        "N": ix.N,
        "avgdl": ix.avgdl,
        "termCount": len(terms),
        "dlSum": sum(ix.dl),
        "termsHash": sha("".join(terms)),
        "dfHash": sha(",".join(str(len(ix.postings[t]) // 2) for t in terms)),
    }
    print(f"層2 疎索引: 語 {len(terms)} / 平均長 {ix.avgdl:.6f}")

    # --- 層 3: 検索順位 ---
    s_idx = stride(len(items), SPARSE_QUERIES)
    d_idx = stride(len(items), DENSE_QUERIES)
    sparse_ranks = []
    for n, i in enumerate(s_idx):
        it = items[i]
        hits = T.bm25_search(ix, it["query"], top_k=TOPK, exclude=set(it["excludeFromResults"]))
        sparse_ranks.append({"item": it["id"], "ids": [h["id"] for h in hits]})
        if n % 50 == 0:
            print(f"  疎 {n}/{len(s_idx)}")

    dense_ranks = []
    hybrid_ranks = []
    for n, i in enumerate(d_idx):
        it = items[i]
        exclude = set(it["excludeFromResults"])
        q = qvecs[i * DIMS : (i + 1) * DIMS]
        d = T.dense_search(vecs, DIMS, ids, q, top_k=TOPK, exclude=exclude)
        s = T.bm25_search(ix, it["query"], top_k=TOPK, exclude=exclude)
        dense_ranks.append(
            {"item": it["id"], "ids": [h["id"] for h in d], "topScore": d[0]["score"] if d else None}
        )
        hybrid_ranks.append({"item": it["id"], "ids": [h["id"] for h in T.rrf_fuse([d, s], top_k=TOPK)]})
        print(f"  密 {n + 1}/{len(d_idx)}")

    out = {
        "impl": "py",
        "tokenHashes": token_hashes,
        "sparseIndex": sparse_index,
        "sparseRanks": sparse_ranks,
        "denseRanks": dense_ranks,
        "hybridRanks": hybrid_ranks,
    }
    (ROOT / "data/ranks-py.json").write_text(json.dumps(out), encoding="utf-8")
    print("Python 側を書き出した → data/ranks-py.json")


if __name__ == "__main__":
    main()
