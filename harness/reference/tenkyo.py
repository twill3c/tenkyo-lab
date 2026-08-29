"""検索の Python 参照実装(G-04 二実装照合の相手)。

src/lib/{tokenize,bm25,dense,metrics}.mjs と**同じ仕様**を、独立に書き下したもの。
速さは要らない。TS 側が正しいかを確かめるためだけに存在する。

HC-054 の規律に従う:
  - **numpy の dot を使わない。** BLAS は加算順を勝手に変え、最終桁が JS と食い違う。
    float32 を float64 に広げて**先頭から順に**足す。JS の Float32Array 読み出しと同じ演算になる
  - 丸めの向きを言語の既定に任せない。ここでは丸めを一切使わない
  - `log` は超越関数で処理系ごとに 1 ULP 違いうる。揃えられないので、
    食い違ったときは「順位が入れ替わったか」と「スコアの下位ビットだけか」を分けて報告する
"""

from __future__ import annotations

import math
import re
import struct
from collections import defaultdict

K1 = 1.2
B = 0.75
RRF_K = 60

# src/lib/tokenize.mjs の SYMBOLS と同じ文字集合
SYMBOLS = re.compile(r"[、。・「」『』（）()［］\[\]〔〕，．：；:;？?！!／/\s]+")


def segments(s: str) -> list[str]:
    return [x for x in SYMBOLS.split(str(s)) if len(x) > 0]


def substantive_length(s: str) -> int:
    return sum(len(seg) for seg in segments(s))


def bigrams(s: str) -> list[str]:
    """重複を畳んだバイグラム。挿入順を保つ(JS の Set と同じ)。"""
    out: dict[str, None] = {}
    for seg in segments(s):
        if len(seg) == 1:
            out[seg] = None
            continue
        for i in range(len(seg) - 1):
            out[seg[i : i + 2]] = None
    return list(out)


def bigram_counts(s: str) -> dict[str, int]:
    m: dict[str, int] = {}
    for seg in segments(s):
        if len(seg) == 1:
            m[seg] = m.get(seg, 0) + 1
            continue
        for i in range(len(seg) - 1):
            g = seg[i : i + 2]
            m[g] = m.get(g, 0) + 1
    return m


def token_length(s: str) -> int:
    n = 0
    for seg in segments(s):
        n += 1 if len(seg) == 1 else len(seg) - 1
    return n


class BM25Index:
    def __init__(self, docs: list[tuple[str, str]]):
        self.ids = [d[0] for d in docs]
        self.dl = [0] * len(docs)
        self.postings: dict[str, list[int]] = defaultdict(list)
        for i, (_id, text) in enumerate(docs):
            counts = bigram_counts(text)
            self.dl[i] = token_length(text)
            for term, tf in counts.items():
                self.postings[term].extend((i, tf))
        self.N = len(docs)
        self.avgdl = (sum(self.dl) / self.N) if self.N > 0 else 0.0

    def df(self, term: str) -> int:
        p = self.postings.get(term)
        return len(p) // 2 if p else 0

    def idf(self, term: str) -> float:
        d = self.df(term)
        return math.log(1 + (self.N - d + 0.5) / (d + 0.5))


def bm25_search(ix: BM25Index, query: str, top_k: int = 10, exclude: set[str] | None = None):
    scores: dict[int, float] = {}
    for term, qtf in bigram_counts(query).items():
        p = ix.postings.get(term)
        if not p:
            continue
        w = ix.idf(term)
        for j in range(0, len(p), 2):
            d = p[j]
            tf = p[j + 1]
            norm = tf * (K1 + 1) / (tf + K1 * (1 - B + (B * ix.dl[d]) / ix.avgdl))
            scores[d] = scores.get(d, 0.0) + w * norm * min(qtf, 1)
    out = []
    for d, s in scores.items():
        if s <= 0:
            continue
        cid = ix.ids[d]
        if exclude and cid in exclude:
            continue
        out.append({"id": cid, "idx": d, "score": s})
    out.sort(key=lambda x: (-x["score"], x["id"]))
    return out[:top_k]


def read_f32(path: str) -> list[float]:
    """float32 の生バイト列を float64 の list として読む(JS の Float32Array 読み出しと同じ値)。"""
    with open(path, "rb") as f:
        raw = f.read()
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}f", raw))


def dot(vecs: list[float], dims: int, i: int, q) -> float:
    """**先頭から順に**足す。numpy の dot は加算順が違うので使わない(HC-054)。"""
    base = i * dims
    s = 0.0
    for d in range(dims):
        s += vecs[base + d] * q[d]
    return s


def dense_search(vecs, dims, ids, q, top_k: int = 10, exclude: set[str] | None = None):
    out = []
    for i, cid in enumerate(ids):
        if exclude and cid in exclude:
            continue
        out.append({"id": cid, "idx": i, "score": dot(vecs, dims, i, q)})
    out.sort(key=lambda x: (-x["score"], x["id"]))
    return out[:top_k]


def rrf_fuse(rankings, k: int = RRF_K, top_k: int | None = None):
    acc: dict[str, float] = {}
    for ranking in rankings:
        for i, r in enumerate(ranking):
            rid = r["id"] if isinstance(r, dict) else r
            acc[rid] = acc.get(rid, 0.0) + 1 / (k + i + 1)
    out = [{"id": rid, "score": s} for rid, s in acc.items()]
    out.sort(key=lambda x: (-x["score"], x["id"]))
    return out[:top_k] if top_k is not None else out


# ------------------------------------------------------------------ 指標


def recall_at_k(ranked, gold: set[str], k: int) -> float:
    if len(gold) == 0:
        return 0.0
    top = [r["id"] if isinstance(r, dict) else r for r in ranked][:k]
    return sum(1 for x in top if x in gold) / len(gold)


def hit_at_k(ranked, gold: set[str], k: int) -> float:
    if len(gold) == 0:
        return 0.0
    top = [r["id"] if isinstance(r, dict) else r for r in ranked][:k]
    return 1.0 if any(x in gold for x in top) else 0.0


def reciprocal_rank(ranked, gold: set[str]) -> float:
    ids = [r["id"] if isinstance(r, dict) else r for r in ranked]
    for i, x in enumerate(ids):
        if x in gold:
            return 1 / (i + 1)
    return 0.0


def ndcg_at_k(ranked, gold: set[str], k: int) -> float:
    if len(gold) == 0:
        return 0.0
    top = [r["id"] if isinstance(r, dict) else r for r in ranked][:k]
    dcg = sum(1 / math.log2(i + 2) for i, x in enumerate(top) if x in gold)
    idcg = sum(1 / math.log2(i + 2) for i in range(min(len(gold), k)))
    return 0.0 if idcg == 0 else dcg / idcg
