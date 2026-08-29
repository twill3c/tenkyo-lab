// G-06 の正式判定と、「ハイブリッドは常に勝つ」が破れる条件の探索。
//
// 密・疎の順位は一度だけ計算し、融合だけを掛け直す。RRF は順位しか見ないので、
// 定数 k を変えても検索をやり直す必要はない。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildIndex, search as searchSparse } from "../src/lib/bm25.mjs";
import { searchDense } from "../src/lib/dense.mjs";
import { recallAtK, rrfFuse } from "../src/lib/metrics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIMS = 384;
const POOL = 50;
const K_VALUES = [1, 5, 10, 20, 60, 200, 1000];
const MIN_LAW_ITEMS = 30; // これ未満の法令は法令別の比較に使わない(数が少なすぎて揺れる)

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const bin = fs.readFileSync(resolve(ROOT, "data/index/vec_f32.bin"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const qbin = fs.readFileSync(resolve(ROOT, "data/index/query_f32.bin"));
  const qvecs = new Float32Array(qbin.buffer, qbin.byteOffset, qbin.byteLength / 4);
  const ids = chunks.map((c) => c.id);
  const ix = buildIndex(chunks.map((c) => ({ id: c.id, text: c.indexText })));

  const golds = items.map((it) => new Set(it.gold));
  const dense = [];
  const sparse = [];
  for (let i = 0; i < items.length; i++) {
    const exclude = new Set(items[i].excludeFromResults);
    const q = qvecs.subarray(i * DIMS, (i + 1) * DIMS);
    dense.push(searchDense(vecs, DIMS, ids, q, { topK: POOL, exclude }));
    sparse.push(searchSparse(ix, items[i].query, { topK: POOL, exclude }));
    if (i % 500 === 0) console.log(`  検索 ${i}/${items.length}`);
  }

  const rec = (ranked) => mean(ranked.map((r, i) => recallAtK(r, golds[i], 10)));
  const dR = rec(dense);
  const sR = rec(sparse);
  const best = Math.max(dR, sR);

  console.log("\n--- RRF の定数 k を掃引(Recall@10) ---");
  console.log(`  密 ${dR.toFixed(4)}  疎 ${sR.toFixed(4)}  単独の最良 ${best.toFixed(4)}`);
  const sweep = [];
  for (const k of K_VALUES) {
    const fused = dense.map((d, i) => rrfFuse([d, sparse[i]], { k, topK: POOL }));
    const r = rec(fused);
    sweep.push({ k, recall10: r, beatsBest: r >= best });
    console.log(`  k=${String(k).padStart(4)}  ${r.toFixed(4)}  ${r >= best ? "○ 単独を下回らない" : "× 単独に負けた"}`);
  }

  // --- 法令別。どこで融合が負けるか ---
  const byLaw = new Map();
  for (let i = 0; i < items.length; i++) {
    const k = items[i].lawTitle;
    if (!byLaw.has(k)) byLaw.set(k, []);
    byLaw.get(k).push(i);
  }
  const fused60 = dense.map((d, i) => rrfFuse([d, sparse[i]], { k: 60, topK: POOL }));
  const laws = [];
  for (const [title, idx] of byLaw) {
    if (idx.length < MIN_LAW_ITEMS) continue;
    const r = (arr) => mean(idx.map((i) => recallAtK(arr[i], golds[i], 10)));
    const d = r(dense);
    const s = r(sparse);
    const h = r(fused60);
    laws.push({ title, n: idx.length, dense: d, sparse: s, hybrid: h, loses: h < Math.max(d, s) });
  }
  laws.sort((a, b) => a.hybrid - Math.max(a.dense, a.sparse) - (b.hybrid - Math.max(b.dense, b.sparse)));
  console.log(`\n--- 法令別 Recall@10(${MIN_LAW_ITEMS} 問以上の ${laws.length} 法令・融合が弱い順) ---`);
  for (const l of laws) {
    const gap = l.hybrid - Math.max(l.dense, l.sparse);
    console.log(
      `  ${l.loses ? "×" : "○"} ${l.title.padEnd(22)} n=${String(l.n).padStart(4)}  ` +
        `密 ${l.dense.toFixed(3)}  疎 ${l.sparse.toFixed(3)}  融合 ${l.hybrid.toFixed(3)}  差 ${gap >= 0 ? "+" : ""}${gap.toFixed(3)}`
    );
  }
  const losers = laws.filter((l) => l.loses);

  const g06 = sweep.find((s) => s.k === 60);
  console.log(`\n${g06.beatsBest ? "○" : "×"} G-06(k=60): 融合 ${g06.recall10.toFixed(4)} 対 単独の最良 ${best.toFixed(4)}`);
  console.log(`   k を変えて単独に負けるのは ${sweep.filter((s) => !s.beatsBest).map((s) => `k=${s.k}`).join(", ") || "なし"}`);
  console.log(`   法令別では ${losers.length}/${laws.length} 法令で融合が単独に負ける`);

  fs.writeFileSync(
    resolve(ROOT, "data/hybrid-sweep.json"),
    JSON.stringify({ dense: dR, sparse: sR, best, sweep, laws }, null, 2)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
