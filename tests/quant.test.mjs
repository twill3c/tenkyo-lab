import { describe, it, expect } from "vitest";
import {
  fitQuantizer,
  quantize,
  dequantize,
  foldQuery,
  searchQuantized,
  roundHalfAwayFromZero,
} from "../src/lib/quant.mjs";
import { searchDense } from "../src/lib/dense.mjs";

// 期待値の出所: 手計算と、種つき乱数で作った合成索引。
// **量子化の良し悪しは順位で見る。** スコアの絶対値は変わって当たり前なので、
// 「上位 k の集合が変わらないか」を見る。閾値はデータ量に依存しない(HC-057)。

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** e5 に似せた索引: 各次元が狭い範囲に固まり、次元ごとに中心がずれている */
function makeIndex(n, dims, seed) {
  const r = mulberry32(seed);
  const center = Array.from({ length: dims }, () => (r() - 0.5) * 0.2);
  const v = new Float32Array(n * dims);
  for (let i = 0; i < n; i++) {
    let norm = 0;
    for (let d = 0; d < dims; d++) {
      const x = center[d] + (r() - 0.5) * 0.03; // 散らばりは中心のずれより一桁小さい
      v[i * dims + d] = x;
      norm += x * x;
    }
    norm = Math.sqrt(norm);
    for (let d = 0; d < dims; d++) v[i * dims + d] /= norm;
  }
  return v;
}

describe("丸めの向き(HC-054)", () => {
  it("T-801 0 から遠ざかる向きに統一されている", () => {
    // JS の Math.round は 0.5 → 1 だが -0.5 → -0(0 に寄る)。ここでは -1 にする
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2);
    expect(roundHalfAwayFromZero(2.5)).toBe(3); // 偶数丸めなら 2 になる
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(0.4)).toBe(0);
    expect(roundHalfAwayFromZero(-0.4)).toBe(-0);
  });
});

describe("次元ごとの量子化", () => {
  const dims = 16;
  const n = 500;
  const vecs = makeIndex(n, dims, 424242);
  const fit = fitQuantizer(vecs, dims, n);
  const q8 = quantize(vecs, dims, n, fit);

  it("T-802 int8 の範囲に収まり、幅いっぱいまで使う", () => {
    let min = 127;
    let max = -127;
    for (const x of q8) {
      if (x < min) min = x;
      if (x > max) max = x;
    }
    expect(min).toBeGreaterThanOrEqual(-127);
    expect(max).toBeLessThanOrEqual(127);
    // 次元ごとに幅を取っているので、必ずどこかが端に届く
    expect(Math.max(Math.abs(min), Math.abs(max))).toBe(127);
  });

  it("T-803 復元誤差は 1 段の半分以下に収まる", () => {
    const back = dequantize(q8, dims, n, fit);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dims; d++) {
        const err = Math.abs(vecs[i * dims + d] - back[i * dims + d]);
        expect(err).toBeLessThanOrEqual(fit.s[d] / 127 / 2 + 1e-7);
      }
    }
  });

  it("T-804 陽性対照: 次元ごとの量子化は上位 10 の集合をほぼ保つ", () => {
    const ids = Array.from({ length: n }, (_, i) => `c${String(i).padStart(4, "0")}`);
    const r = mulberry32(99);
    let agree = 0;
    const trials = 60;
    for (let t = 0; t < trials; t++) {
      const q = Array.from({ length: dims }, () => r() - 0.5);
      const a = new Set(searchDense(vecs, dims, ids, q, { topK: 10 }).map((h) => h.id));
      const b = new Set(searchQuantized(q8, dims, ids, foldQuery(q, dims, fit), { topK: 10 }).map((h) => h.id));
      if (a.size === b.size && [...a].every((x) => b.has(x))) agree += 1;
    }
    expect(agree / trials).toBeGreaterThanOrEqual(0.9);
  });

  it("T-805 陰性対照: 全体一律のスケールにすると保存率が落ちる", () => {
    // kototoi-do が実測した故障(84.9%)を、合成データで再現する。
    // **陰性対照が無いと「次元ごとにした甲斐があったのか」が分からない**(HC-041)
    let amax = 0;
    for (const x of vecs) if (Math.abs(x) > amax) amax = Math.abs(x);
    const flat = { mu: new Float64Array(dims), s: new Float64Array(dims).fill(amax) };
    const q8flat = quantize(vecs, dims, n, flat);
    const ids = Array.from({ length: n }, (_, i) => `c${String(i).padStart(4, "0")}`);
    const r = mulberry32(99);
    let agreeFlat = 0;
    let agreePerDim = 0;
    const trials = 60;
    for (let t = 0; t < trials; t++) {
      const q = Array.from({ length: dims }, () => r() - 0.5);
      const a = new Set(searchDense(vecs, dims, ids, q, { topK: 10 }).map((h) => h.id));
      const f = new Set(searchQuantized(q8flat, dims, ids, foldQuery(q, dims, flat), { topK: 10 }).map((h) => h.id));
      const p = new Set(searchQuantized(q8, dims, ids, foldQuery(q, dims, fit), { topK: 10 }).map((h) => h.id));
      if ([...a].every((x) => f.has(x))) agreeFlat += 1;
      if ([...a].every((x) => p.has(x))) agreePerDim += 1;
    }
    expect(agreeFlat / trials).toBeLessThan(agreePerDim / trials);
  });

  it("T-806 定数項 Σμ·q を足しても順位は変わらない(捨ててよい根拠)", () => {
    const ids = Array.from({ length: n }, (_, i) => `c${String(i).padStart(4, "0")}`);
    const q = Array.from({ length: dims }, (_, d) => (d % 3) - 1);
    const w = foldQuery(q, dims, fit);
    const withConst = fit.mu.reduce((acc, m, d) => acc + m * q[d], 0);
    const base = searchQuantized(q8, dims, ids, w, { topK: 20 });
    // 全件に同じ定数を足しても順位は同じ
    const shifted = base.map((h) => ({ ...h, score: h.score + withConst }));
    shifted.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
    expect(shifted.map((h) => h.id)).toEqual(base.map((h) => h.id));
  });

  it("T-807 陰性対照: 除外指定は量子化側でも効く", () => {
    const ids = Array.from({ length: n }, (_, i) => `c${String(i).padStart(4, "0")}`);
    const q = Array.from({ length: dims }, (_, d) => (d % 2 ? 1 : -1));
    const w = foldQuery(q, dims, fit);
    const top = searchQuantized(q8, dims, ids, w, { topK: 5 });
    const ex = new Set([top[0].id]);
    const after = searchQuantized(q8, dims, ids, w, { topK: 5, exclude: ex });
    expect(after.map((h) => h.id)).not.toContain(top[0].id);
    expect(after[0].id).toBe(top[1].id);
  });
});
