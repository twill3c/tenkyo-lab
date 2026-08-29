import { describe, it, expect } from "vitest";
import { recallAtK, hitAtK, reciprocalRank, ndcgAtK, rrfFuse } from "../src/lib/metrics.mjs";

// 期待値の出所: すべて手計算。導出をコメントに残す(TEST_SPEC)。
// 指標はデータ量に依存しないので合成フィクスチャで確かめてよい(HC-057)。

const ranked = ["a", "b", "c", "d", "e"];

describe("Recall / Hit", () => {
  it("T-501 Recall@k は正解のうち上位 k に入った割合", () => {
    // 正解 {a, e} のうち上位 3 に入るのは a のみ → 1/2
    expect(recallAtK(ranked, new Set(["a", "e"]), 3)).toBe(0.5);
    // 正解 {a, b} は両方とも上位 3 → 2/2
    expect(recallAtK(ranked, new Set(["a", "b"]), 3)).toBe(1);
    // 陰性対照: 1 つも入らなければ 0
    expect(recallAtK(ranked, new Set(["z"]), 3)).toBe(0);
  });

  it("T-502 Hit@k は正解が 1 つでも入れば 1", () => {
    expect(hitAtK(ranked, new Set(["a", "e"]), 3)).toBe(1);
    expect(hitAtK(ranked, new Set(["e"]), 3)).toBe(0);
    expect(hitAtK(ranked, new Set(["e"]), 5)).toBe(1);
  });

  it("T-503 陰性対照: 検索結果が空なら Recall も Hit も 0(例外にしない)", () => {
    expect(recallAtK([], new Set(["a"]), 10)).toBe(0);
    expect(hitAtK([], new Set(["a"]), 10)).toBe(0);
  });

  it("T-504 正解が空なら 0 を返す(0 除算にしない)", () => {
    expect(recallAtK(ranked, new Set(), 3)).toBe(0);
  });
});

describe("MRR / nDCG", () => {
  it("T-505 逆順位は最初に当たった正解の順位の逆数", () => {
    expect(reciprocalRank(ranked, new Set(["a"]))).toBe(1);
    expect(reciprocalRank(ranked, new Set(["c"]))).toBe(1 / 3);
    // 複数正解なら最も上のもの
    expect(reciprocalRank(ranked, new Set(["c", "e"]))).toBe(1 / 3);
    expect(reciprocalRank(ranked, new Set(["z"]))).toBe(0);
  });

  it("T-506 nDCG@k は理想順位で 1 になる", () => {
    // 正解 {a, b} が 1 位・2 位 = 理想配置
    expect(ndcgAtK(ranked, new Set(["a", "b"]), 5)).toBeCloseTo(1, 12);
    // 正解 {a} が 1 位 = 理想配置
    expect(ndcgAtK(ranked, new Set(["a"]), 5)).toBeCloseTo(1, 12);
  });

  it("T-507 nDCG@k の手計算と一致する", () => {
    // 正解 {b}。DCG = 1/log2(2+1) = 1/1.584962500721156
    // IDCG = 1/log2(1+1) = 1
    const want = 1 / Math.log2(3);
    expect(ndcgAtK(ranked, new Set(["b"]), 5)).toBeCloseTo(want, 12);
  });

  it("T-508 陰性対照: 正解が 1 つも無ければ nDCG は 0", () => {
    expect(ndcgAtK(ranked, new Set(["z"]), 5)).toBe(0);
  });
});

describe("RRF(順位融合)", () => {
  it("T-509 両方の上位にあるものが最上位に来る", () => {
    const dense = [{ id: "x" }, { id: "y" }, { id: "z" }];
    const sparse = [{ id: "z" }, { id: "x" }, { id: "w" }];
    // x: 1/(60+1) + 1/(60+2) = 0.016393 + 0.016129 = 0.032522
    // z: 1/(60+3) + 1/(60+1) = 0.015873 + 0.016393 = 0.032266
    const fused = rrfFuse([dense, sparse], { k: 60 });
    expect(fused[0].id).toBe("x");
    expect(fused[1].id).toBe("z");
  });

  it("T-510 陰性対照: 片方が空でも、もう片方の順位をそのまま保つ", () => {
    const dense = [{ id: "x" }, { id: "y" }];
    const fused = rrfFuse([dense, []], { k: 60 });
    expect(fused.map((f) => f.id)).toEqual(["x", "y"]);
  });

  it("T-511 陰性対照: 両方空なら空", () => {
    expect(rrfFuse([[], []], { k: 60 })).toEqual([]);
  });

  it("T-512 同点は id で決める(実行ごとに順位が揺れない)", () => {
    const a = [{ id: "b" }, { id: "a" }];
    const b = [{ id: "a" }, { id: "b" }];
    expect(rrfFuse([a, b], { k: 60 }).map((f) => f.id)).toEqual(["a", "b"]);
  });
});
