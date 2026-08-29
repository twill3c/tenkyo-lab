"""Python 参照実装の単体試験。

**期待値は vitest 側と同一のものを、独立に書き写した。**
同じ仕様から二つの実装が同じ答えを出すことを、まず小さな例で確かめる
(大きな照合 G-04 は scripts/compare-impl.mjs が行う)。
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import tenkyo as T  # noqa: E402

DOCS = [
    ("a", "根抵当権の共有者は、他の共有者の同意を得てその権利を譲り渡すことができる。"),
    ("b", "統括安全衛生責任者は、元方安全衛生管理者の指揮をしなければならない。"),
    ("c", "使用者は、労働者に、休憩時間を与えなければならない。"),
    ("d", "根抵当権の元本の確定前においては、根抵当権者は、これを譲り渡すことができる。"),
]


# --- 分かち書き(tests/oracle.test.mjs T-309/T-310 と同じ期待値) ---


def test_p310_bigrams_do_not_cross_symbols():
    assert T.bigrams("あい、うえ") == ["あい", "うえ"]
    assert "いう" not in T.bigrams("あい、うえ")
    assert T.bigrams("あいうえ") == ["あい", "いう", "うえ"]
    assert T.bigrams("あ、いう") == ["あ", "いう"]


def test_p309_substantive_length():
    # 実測 17(記号 3 文字を除いた残り)
    assert T.substantive_length("）若しくは（において準用する場合を含む。") == 17
    assert T.substantive_length("あいうえお") == 5


# --- BM25(tests/bm25.test.mjs T-401〜T-409 と同じ期待値) ---


def test_p401_index_not_empty():
    ix = T.BM25Index(DOCS)
    assert ix.N == 4
    assert len(ix.postings) > 0
    assert ix.avgdl > 0


def test_p402_positive_control_self_retrieval():
    ix = T.BM25Index(DOCS)
    for did, text in DOCS:
        hits = T.bm25_search(ix, text, top_k=4)
        assert hits[0]["id"] == did, f"{did} が 1 位でない"


def test_p403_negative_control_no_shared_bigram():
    ix = T.BM25Index(DOCS)
    assert T.bm25_search(ix, "Lorem ipsum dolor", top_k=4) == []
    assert T.bm25_search(ix, "", top_k=4) == []


def test_p404_topically_close_docs_rank_high():
    ix = T.BM25Index(DOCS)
    hits = T.bm25_search(ix, "根抵当権を譲り渡すこと", top_k=4)
    assert sorted(h["id"] for h in hits[:2]) == ["a", "d"]


def test_p405_idf_ordering():
    ix = T.BM25Index(DOCS)
    assert ix.idf("者は") < ix.idf("根抵")
    assert ix.idf("統括") > ix.idf("根抵")


def test_p406_unknown_term_idf_is_finite_and_largest():
    ix = T.BM25Index(DOCS)
    assert math.isfinite(ix.idf("ゑひ"))
    assert ix.idf("ゑひ") > ix.idf("者は")


def test_p407_length_normalization():
    two = [
        ("short", "特別清算の手続"),
        ("long", "特別清算の手続その他これに準ずる一切の手続に関する詳細な定めであって、必要な事項を含むもの"),
    ]
    ix2 = T.BM25Index(two)
    assert T.bm25_search(ix2, "特別清算", top_k=2)[0]["id"] == "short"


def test_p408_exclude():
    ix = T.BM25Index(DOCS)
    hits = T.bm25_search(ix, DOCS[0][1], top_k=4, exclude={"a"})
    assert "a" not in [h["id"] for h in hits]
    assert len(hits) > 0


def test_p409_duplicate_text_ties_break_by_id():
    dup = [
        ("z-dup", "第八十二条第三項の規定は、前項の請求についてこれを準用する。"),
        ("a-dup", "第八十二条第三項の規定は、前項の請求についてこれを準用する。"),
        ("other", "全く別の内容を定める条文である。"),
    ]
    ixd = T.BM25Index(dup)
    hits = T.bm25_search(ixd, dup[0][1], top_k=3)
    assert hits[0]["score"] == hits[1]["score"]
    assert hits[0]["id"] == "a-dup"


# --- 密検索(tests/dense.test.mjs T-601〜T-605 と同じ期待値) ---

DIMS = 3
VECS = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.6000000238418579, 0.800000011920929, 0.0]
IDS = ["a", "b", "c"]


def test_p601_dot():
    assert abs(T.dot(VECS, DIMS, 2, [1, 0, 0]) - 0.6) < 1e-6
    assert abs(T.dot(VECS, DIMS, 2, [0, 1, 0]) - 0.8) < 1e-6


def test_p602_positive_control():
    hits = T.dense_search(VECS, DIMS, IDS, [1, 0, 0], top_k=3)
    assert hits[0]["id"] == "a"
    assert abs(hits[0]["score"] - 1) < 1e-6
    assert [h["id"] for h in hits] == ["a", "c", "b"]


def test_p603_negative_control_orthogonal():
    hits = T.dense_search(VECS, DIMS, IDS, [0, 0, 1], top_k=3)
    for h in hits:
        assert abs(h["score"]) < 1e-6
    assert [h["id"] for h in hits] == ["a", "b", "c"]


def test_p604_exclude():
    hits = T.dense_search(VECS, DIMS, IDS, [1, 0, 0], top_k=3, exclude={"a"})
    assert [h["id"] for h in hits] == ["c", "b"]


# --- 指標(tests/metrics.test.mjs T-501〜T-512 と同じ期待値) ---

RANKED = ["a", "b", "c", "d", "e"]


def test_p501_recall():
    assert T.recall_at_k(RANKED, {"a", "e"}, 3) == 0.5
    assert T.recall_at_k(RANKED, {"a", "b"}, 3) == 1
    assert T.recall_at_k(RANKED, {"z"}, 3) == 0


def test_p502_hit():
    assert T.hit_at_k(RANKED, {"a", "e"}, 3) == 1
    assert T.hit_at_k(RANKED, {"e"}, 3) == 0
    assert T.hit_at_k(RANKED, {"e"}, 5) == 1


def test_p505_reciprocal_rank():
    assert T.reciprocal_rank(RANKED, {"a"}) == 1
    assert T.reciprocal_rank(RANKED, {"c"}) == 1 / 3
    assert T.reciprocal_rank(RANKED, {"c", "e"}) == 1 / 3
    assert T.reciprocal_rank(RANKED, {"z"}) == 0


def test_p506_ndcg_ideal_is_one():
    assert abs(T.ndcg_at_k(RANKED, {"a", "b"}, 5) - 1) < 1e-12
    assert abs(T.ndcg_at_k(RANKED, {"a"}, 5) - 1) < 1e-12


def test_p507_ndcg_hand_computed():
    assert abs(T.ndcg_at_k(RANKED, {"b"}, 5) - 1 / math.log2(3)) < 1e-12


def test_p509_rrf():
    dense = [{"id": "x"}, {"id": "y"}, {"id": "z"}]
    sparse = [{"id": "z"}, {"id": "x"}, {"id": "w"}]
    fused = T.rrf_fuse([dense, sparse])
    assert fused[0]["id"] == "x"
    assert fused[1]["id"] == "z"


def test_p510_rrf_one_side_empty():
    dense = [{"id": "x"}, {"id": "y"}]
    assert [f["id"] for f in T.rrf_fuse([dense, []])] == ["x", "y"]


def test_p512_rrf_tie_breaks_by_id():
    a = [{"id": "b"}, {"id": "a"}]
    b = [{"id": "a"}, {"id": "b"}]
    assert [f["id"] for f in T.rrf_fuse([a, b])] == ["a", "b"]
