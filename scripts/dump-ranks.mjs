// G-04 二実装照合の TS 側。Python 側(harness/reference/dump_ranks.py)と同じ形で吐く。
//
// 照合の対象を三層に分ける。上の層が壊れていると下の層の一致は意味を持たない。
//   1. 分かち書き …… 全 13,600 チャンク + 全 2,808 クエリのバイグラムを網羅照合(sha256)
//   2. 疎索引     …… N / avgdl / 語数 / 文書長の総和と checksum / df の全語照合
//   3. 検索順位   …… 疎 200 問・密 20 問・融合 20 問の上位 20 件

import fs from "node:fs";
import crypto from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bigrams, tokenLength } from "../src/lib/tokenize.mjs";
import { buildIndex, search as searchSparse } from "../src/lib/bm25.mjs";
import { searchDense } from "../src/lib/dense.mjs";
import { rrfFuse } from "../src/lib/metrics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIMS = 384;
export const SPARSE_QUERIES = 200;
export const DENSE_QUERIES = 20;
export const TOPK = 20;

const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

/** 等間隔で選ぶ。両実装で同じ問いを見るため、乱数を使わない */
export function stride(n, want) {
  const step = Math.max(1, Math.floor(n / want));
  const out = [];
  for (let i = 0; i < n && out.length < want; i += step) out.push(i);
  return out;
}

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const bin = fs.readFileSync(resolve(ROOT, "data/index/vec_f32.bin"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const qbin = fs.readFileSync(resolve(ROOT, "data/index/query_f32.bin"));
  const qvecs = new Float32Array(qbin.buffer, qbin.byteOffset, qbin.byteLength / 4);
  const ids = chunks.map((c) => c.id);

  // --- 層 1: 分かち書き(網羅) ---
  const tokenHashes = {
    chunks: chunks.map((c) => sha([...bigrams(c.indexText)].join(""))),
    queries: items.map((it) => sha([...bigrams(it.query)].join(""))),
    lengths: sha(chunks.map((c) => tokenLength(c.indexText)).join(",")),
  };

  // --- 層 2: 疎索引 ---
  const ix = buildIndex(chunks.map((c) => ({ id: c.id, text: c.indexText })));
  const terms = [...ix.postings.keys()].sort();
  const sparseIndex = {
    N: ix.N,
    avgdl: ix.avgdl,
    termCount: terms.length,
    dlSum: [...ix.dl].reduce((a, b) => a + b, 0),
    termsHash: sha(terms.join("")),
    dfHash: sha(terms.map((t) => ix.postings.get(t).length / 2).join(",")),
  };

  // --- 層 3: 検索順位 ---
  const sIdx = stride(items.length, SPARSE_QUERIES);
  const dIdx = stride(items.length, DENSE_QUERIES);
  const sparseRanks = sIdx.map((i) => ({
    item: items[i].id,
    ids: searchSparse(ix, items[i].query, {
      topK: TOPK,
      exclude: new Set(items[i].excludeFromResults),
    }).map((h) => h.id),
  }));
  const denseRanks = [];
  const hybridRanks = [];
  for (const i of dIdx) {
    const it = items[i];
    const exclude = new Set(it.excludeFromResults);
    const q = qvecs.subarray(i * DIMS, (i + 1) * DIMS);
    const d = searchDense(vecs, DIMS, ids, q, { topK: TOPK, exclude });
    const s = searchSparse(ix, it.query, { topK: TOPK, exclude });
    denseRanks.push({ item: it.id, ids: d.map((h) => h.id), topScore: d[0]?.score ?? null });
    hybridRanks.push({ item: it.id, ids: rrfFuse([d, s], { topK: TOPK }).map((h) => h.id) });
  }

  const out = { impl: "ts", tokenHashes, sparseIndex, sparseRanks, denseRanks, hybridRanks };
  fs.writeFileSync(resolve(ROOT, "data/ranks-ts.json"), JSON.stringify(out));
  console.log(
    `TS 側を書き出した: チャンク ${tokenHashes.chunks.length} / クエリ ${tokenHashes.queries.length} / ` +
      `疎 ${sparseRanks.length} 問 / 密 ${denseRanks.length} 問`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
