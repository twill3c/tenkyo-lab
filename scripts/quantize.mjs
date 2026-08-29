// 密索引を int8 に落とし、G-05(順位の保存)を判定する。
//
// 陰性対照として「全体一律のスケール」も同時に測る。
// 次元ごとにした甲斐があったかは、比べなければ分からない(HC-041)。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fitQuantizer, quantize, foldQuery, searchQuantized } from "../src/lib/quant.mjs";
import { searchDense } from "../src/lib/dense.mjs";
import { recallAtK } from "../src/lib/metrics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIMS = 384;
const TOPK = 10;
export const G05_THRESHOLD = 0.95; // SPEC §5。ここでは読むだけ

const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
/**
 * 上位 k の重なり比率。**「集合一致率」という同じ言葉が二つの測り方を指す**:
 *   (1) 集合が完全に一致した問いの割合(setEq)  ← SPEC §5 の G-05 はこちら
 *   (2) 1 問ごとの重なり比率 |A∩B|/k の平均      ← kototoi-do の 98.2% はこちら
 * (2) は (1) より必ず甘い。kototoi-do は 40 問で 98.2% を出しており、
 * 40 × 0.982 = 39.28 と割り切れないことから (2) だったと分かる(loop_003 で気づいた)。
 */
const overlapRatio = (a, b) => [...a].filter((x) => b.has(x)).length / a.size;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const bin = fs.readFileSync(resolve(ROOT, "data/index/vec_f32.bin"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const qbin = fs.readFileSync(resolve(ROOT, "data/index/query_f32.bin"));
  const qvecs = new Float32Array(qbin.buffer, qbin.byteOffset, qbin.byteLength / 4);
  const ids = chunks.map((c) => c.id);
  const n = chunks.length;

  // --- 本命: 次元ごとの μ / s ---
  const fit = fitQuantizer(vecs, DIMS, n);
  const q8 = quantize(vecs, DIMS, n, fit);

  // --- 陰性対照: 全体一律のスケール(kototoi-do で 84.9% に落ちた形) ---
  let amax = 0;
  for (const x of vecs) if (Math.abs(x) > amax) amax = Math.abs(x);
  const flat = { mu: new Float64Array(DIMS), s: new Float64Array(DIMS).fill(amax) };
  const q8flat = quantize(vecs, DIMS, n, flat);

  fs.writeFileSync(resolve(ROOT, "data/index/vec_i8.bin"), Buffer.from(q8.buffer));
  fs.writeFileSync(
    resolve(ROOT, "data/index/quant-meta.json"),
    JSON.stringify({ dims: DIMS, count: n, mu: [...fit.mu], s: [...fit.s] })
  );
  const f32Bytes = bin.byteLength;
  const i8Bytes = q8.byteLength;
  const metaBytes = fs.statSync(resolve(ROOT, "data/index/quant-meta.json")).size;
  console.log(
    `配布量  f32 ${(f32Bytes / 1048576).toFixed(1)}MB → int8 ${(i8Bytes / 1048576).toFixed(1)}MB ` +
      `+ 変換表 ${(metaBytes / 1024).toFixed(0)}KB(${(((i8Bytes + metaBytes) / f32Bytes) * 100).toFixed(1)}%)`
  );

  // --- 順位の保存 ---
  const golds = items.map((it) => new Set(it.gold));
  let agree = 0;
  let agreeFlat = 0;
  let top1Same = 0;
  const overlaps = [];
  const overlapsFlat = [];
  const recF32 = [];
  const recI8 = [];
  const recFlat = [];
  for (let i = 0; i < items.length; i++) {
    const exclude = new Set(items[i].excludeFromResults);
    const q = qvecs.subarray(i * DIMS, (i + 1) * DIMS);
    const a = searchDense(vecs, DIMS, ids, q, { topK: TOPK, exclude });
    const b = searchQuantized(q8, DIMS, ids, foldQuery(q, DIMS, fit), { topK: TOPK, exclude });
    const c = searchQuantized(q8flat, DIMS, ids, foldQuery(q, DIMS, flat), { topK: TOPK, exclude });
    const sa = new Set(a.map((h) => h.id));
    if (setEq(sa, new Set(b.map((h) => h.id)))) agree += 1;
    if (setEq(sa, new Set(c.map((h) => h.id)))) agreeFlat += 1;
    overlaps.push(overlapRatio(sa, new Set(b.map((h) => h.id))));
    overlapsFlat.push(overlapRatio(sa, new Set(c.map((h) => h.id))));
    if (a[0]?.id === b[0]?.id) top1Same += 1;
    recF32.push(recallAtK(a, golds[i], TOPK));
    recI8.push(recallAtK(b, golds[i], TOPK));
    recFlat.push(recallAtK(c, golds[i], TOPK));
    if (i % 500 === 0) console.log(`  ${i}/${items.length}`);
  }

  const g05 = agree / items.length;
  const result = {
    threshold: G05_THRESHOLD,
    setAgreement: g05,
    setAgreementFlat: agreeFlat / items.length,
    overlapRatio: mean(overlaps),
    overlapRatioFlat: mean(overlapsFlat),
    top1Same: top1Same / items.length,
    recall10: { f32: mean(recF32), int8: mean(recI8), flat: mean(recFlat) },
    bytes: { f32: f32Bytes, int8: i8Bytes, meta: metaBytes },
  };
  console.log("\n--- G-05 量子化の順位保存 ---");
  console.log(`  上位10の集合一致  次元ごと ${g05.toFixed(4)}  /  全体一律 ${result.setAgreementFlat.toFixed(4)}`);
  console.log(`  上位10の重なり比率  次元ごと ${result.overlapRatio.toFixed(4)}  /  全体一律 ${result.overlapRatioFlat.toFixed(4)}`);
  console.log(`  1 位が同じ        ${result.top1Same.toFixed(4)}`);
  console.log(
    `  Recall@10        f32 ${result.recall10.f32.toFixed(4)}  int8 ${result.recall10.int8.toFixed(4)}  ` +
      `一律 ${result.recall10.flat.toFixed(4)}`
  );
  console.log(`\n${g05 >= G05_THRESHOLD ? "○" : "×"} G-05: ${g05.toFixed(4)}  閾値 ${G05_THRESHOLD}`);
  fs.writeFileSync(resolve(ROOT, "data/quant-result.json"), JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
