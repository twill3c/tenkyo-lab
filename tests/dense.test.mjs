import { describe, it, expect } from "vitest";
import { searchDense, dot } from "../src/lib/dense.mjs";

// 期待値の出所: 手作りの正規化済みベクトル。内積は手計算できる値を選んだ。

const dims = 3;
// a=(1,0,0) b=(0,1,0) c=(0.6,0.8,0) すべて長さ 1
const vecs = Float32Array.from([1, 0, 0, 0, 1, 0, 0.6, 0.8, 0]);
const ids = ["a", "b", "c"];

describe("密検索(正規化済みベクトルの内積)", () => {
  it("T-601 内積は手計算と一致する", () => {
    expect(dot(vecs, dims, 2, [1, 0, 0])).toBeCloseTo(0.6, 6);
    expect(dot(vecs, dims, 2, [0, 1, 0])).toBeCloseTo(0.8, 6);
  });

  it("T-602 陽性対照: 文書そのもののベクトルで問うとその文書が 1 位・スコア 1", () => {
    const hits = searchDense(vecs, dims, ids, [1, 0, 0], { topK: 3 });
    expect(hits[0].id).toBe("a");
    expect(hits[0].score).toBeCloseTo(1, 6);
    // c(0.6) が b(0) より上
    expect(hits.map((h) => h.id)).toEqual(["a", "c", "b"]);
  });

  it("T-603 陰性対照: 直交するベクトルで問うと全件 0 点になる(順位は id で決まる)", () => {
    const hits = searchDense(vecs, dims, ids, [0, 0, 1], { topK: 3 });
    for (const h of hits) expect(h.score).toBeCloseTo(0, 6);
    expect(hits.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("T-604 除外指定した文書は結果に現れない(循環の禁止2)", () => {
    const hits = searchDense(vecs, dims, ids, [1, 0, 0], { topK: 3, exclude: new Set(["a"]) });
    expect(hits.map((h) => h.id)).toEqual(["c", "b"]);
  });

  it("T-605 topK を超えて返さない", () => {
    expect(searchDense(vecs, dims, ids, [1, 0, 0], { topK: 2 })).toHaveLength(2);
  });

  it("T-606 上位 k の選抜(ヒープ)は、全件ソートの結果と完全に一致する", () => {
    // 全件ソートは遅すぎて本番では使えないが、**正しさの基準としては使える**。
    // 速い実装を入れたら、遅くて自明な実装と突き合わせる(G-04 の縮小版)
    const D = 8;
    const N = 400;
    const rnd = mulberry32(12345);
    const v = new Float32Array(N * D);
    const vids = [];
    for (let i = 0; i < N; i++) {
      let norm = 0;
      for (let d = 0; d < D; d++) {
        const x = rnd() * 2 - 1;
        v[i * D + d] = x;
        norm += x * x;
      }
      norm = Math.sqrt(norm);
      for (let d = 0; d < D; d++) v[i * D + d] /= norm;
      // 同点を必ず起こすため、後半は前半の複製にする
      if (i >= N / 2) v.copyWithin(i * D, (i - N / 2) * D, (i - N / 2 + 1) * D);
      vids.push(`c${String(i).padStart(3, "0")}`);
    }
    const brute = (q, topK, exclude) => {
      const all = [];
      for (let i = 0; i < N; i++) {
        if (exclude?.has(vids[i])) continue;
        all.push({ id: vids[i], idx: i, score: dot(v, D, i, q) });
      }
      all.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      return all.slice(0, topK);
    };
    for (const topK of [1, 5, 50, 400]) {
      for (let t = 0; t < 5; t++) {
        const q = Array.from({ length: D }, () => rnd() * 2 - 1);
        const ex = t === 4 ? new Set(["c000", "c001", "c200"]) : null;
        const fast = searchDense(v, D, vids, q, { topK, exclude: ex });
        const slow = brute(q, topK, ex);
        expect(fast.map((h) => h.id), `topK=${topK} t=${t}`).toEqual(slow.map((h) => h.id));
      }
    }
  });
});

/** 種つき擬似乱数。Math.random を使うと失敗が再現できない */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
