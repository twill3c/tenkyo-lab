import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
  openEvalPack,
  rankingFor,
  goldOf,
  computeMetrics,
  recallAtK,
  hitAtK,
  reciprocalRank,
  ndcgAtK,
} from "../src/lib/evalpack.mjs";
import * as M from "../src/lib/metrics.mjs";

// 期待値の出所:
//   T-1101〜T-1105  metrics.mjs(文字列 id 版)と同じ値になること。**同じ仕様の二実装**である
//   T-1110〜T-1113  G-16。評価器 scripts/evaluate.mjs が出した値と完全一致すること

describe("番号版の指標が、文字列 id 版(metrics.mjs)と一致する", () => {
  const ranked = [10, 11, 12, 13, 14];
  const rankedStr = ["10", "11", "12", "13", "14"];
  const cases = [
    [[10, 14], 3],
    [[10, 11], 3],
    [[99], 3],
    [[12], 5],
    [[10, 11, 12], 2],
  ];

  it("T-1101 Recall@k", () => {
    for (const [gold, k] of cases) {
      expect(recallAtK(Uint16Array.from(gold), Uint16Array.from(gold), k)).toBe(
        M.recallAtK(gold.map(String), new Set(gold.map(String)), k)
      );
      expect(recallAtK(Uint16Array.from(ranked), Uint16Array.from(gold), k)).toBeCloseTo(
        M.recallAtK(rankedStr, new Set(gold.map(String)), k),
        12
      );
    }
  });

  it("T-1102 Hit@k", () => {
    for (const [gold, k] of cases) {
      expect(hitAtK(Uint16Array.from(ranked), Uint16Array.from(gold), k)).toBe(
        M.hitAtK(rankedStr, new Set(gold.map(String)), k)
      );
    }
  });

  it("T-1103 逆順位", () => {
    for (const [gold] of cases) {
      expect(reciprocalRank(Uint16Array.from(ranked), Uint16Array.from(gold))).toBeCloseTo(
        M.reciprocalRank(rankedStr, new Set(gold.map(String))),
        12
      );
    }
  });

  it("T-1104 nDCG@k", () => {
    for (const [gold, k] of cases) {
      expect(ndcgAtK(Uint16Array.from(ranked), Uint16Array.from(gold), k)).toBeCloseTo(
        M.ndcgAtK(rankedStr, new Set(gold.map(String)), k),
        12
      );
    }
  });

  it("T-1105 陰性対照: 正解が空・結果が空でも 0 を返して落ちない", () => {
    const empty = new Uint16Array(0);
    expect(recallAtK(Uint16Array.from(ranked), empty, 10)).toBe(0);
    expect(hitAtK(empty, Uint16Array.from([1]), 10)).toBe(0);
    expect(reciprocalRank(empty, Uint16Array.from([1]))).toBe(0);
    expect(ndcgAtK(Uint16Array.from(ranked), empty, 10)).toBe(0);
  });
});

// --- G-16 実データ。生成物が無ければスキップ ---
const dir = new URL("../public/tenkyo/eval/", import.meta.url);
const built = existsSync(new URL("rank-dense.bin", dir)) && existsSync(new URL("../../../data/eval-result.json", dir));

describe.skipIf(!built)("G-16 詰めた順位から計算した指標が、評価器と完全一致する", () => {
  const rd = (n) => readFileSync(new URL(n, dir));
  const u16 = (b) => new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  const meta = JSON.parse(rd("eval-meta.json").toString("utf8"));
  const pack = openEvalPack({
    denseRanks: u16(rd("rank-dense.bin")),
    sparseRanks: u16(rd("rank-sparse.bin")),
    rankLen: new Uint8Array(rd("rank-len.bin")),
    goldCounts: new Uint8Array(rd("gold-counts.bin")),
    goldValues: u16(rd("gold-values.bin")),
    exclude: u16(rd("exclude.bin")),
    itemLaw: new Uint8Array(rd("item-law.bin")),
    idOrder: u16(rd("id-order.bin")),
    meta,
  });
  const ref = JSON.parse(readFileSync(new URL("../data/eval-result.json", import.meta.url), "utf8")).results;

  it("T-1110 走査対象が空でない", () => {
    expect(pack.n).toBe(2808);
    expect(pack.pool).toBe(50);
    expect(pack.laws.length).toBeGreaterThan(20);
    // 順位が実際に入っていること(全部 0 なら詰め損なっている)
    expect([...pack.dense.subarray(0, 50)].some((x) => x !== 0)).toBe(true);
  });

  it("T-1111 出題元が順位に混ざっていない(循環の禁止2)", () => {
    let bad = 0;
    for (let i = 0; i < pack.n; i++) {
      const r = rankingFor(pack, i, "dense");
      for (const x of r) if (x === pack.exclude[i]) bad += 1;
    }
    expect(bad).toBe(0);
  });

  it("T-1112 密・疎・融合の Recall@10 が評価器と完全一致する", () => {
    for (const method of ["dense", "sparse", "hybrid"]) {
      const got = computeMetrics(pack, { method, k: 10, rrfK: 60 });
      expect(got.n).toBe(2808);
      expect(got.recall, `${method} Recall@10`).toBeCloseTo(ref[method]["Recall@10"], 12);
    }
  });

  it("T-1113 Recall@1/5/20・Hit@10・MRR・nDCG@10 も一致する", () => {
    for (const method of ["dense", "sparse", "hybrid"]) {
      for (const k of [1, 5, 20]) {
        const got = computeMetrics(pack, { method, k, rrfK: 60 });
        expect(got.recall, `${method} Recall@${k}`).toBeCloseTo(ref[method][`Recall@${k}`], 12);
      }
      const at10 = computeMetrics(pack, { method, k: 10, rrfK: 60 });
      expect(at10.hit, `${method} Hit@10`).toBeCloseTo(ref[method]["Hit@10"], 12);
      expect(at10.mrr, `${method} MRR`).toBeCloseTo(ref[method]["MRR"], 12);
      expect(at10.ndcg, `${method} nDCG@10`).toBeCloseTo(ref[method]["nDCG@10"], 12);
    }
  });

  it("T-1114 RRF の定数を変えると値が動く(つまみが効いていることの確認)", () => {
    const a = computeMetrics(pack, { method: "hybrid", k: 10, rrfK: 10 });
    const b = computeMetrics(pack, { method: "hybrid", k: 10, rrfK: 60 });
    expect(a.recall).not.toBe(b.recall);
    // 掃引の実測(data/hybrid-sweep.json)と一致すること
    const sweep = JSON.parse(readFileSync(new URL("../data/hybrid-sweep.json", import.meta.url), "utf8")).sweep;
    for (const s of sweep) {
      const got = computeMetrics(pack, { method: "hybrid", k: 10, rrfK: s.k });
      expect(got.recall, `k=${s.k}`).toBeCloseTo(s.recall10, 12);
    }
  });

  it("T-1115 陰性対照: 存在しない法令で絞ると 0 件になり、落ちない", () => {
    const got = computeMetrics(pack, { method: "dense", k: 10, lawFilter: 250 });
    expect(got.n).toBe(0);
    expect(got.recall).toBe(0);
  });
});
