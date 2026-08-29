// G-09 密検索の陽性対照。
//
// **G-01 が落ちた原因を切り分けるために loop_002 の途中で足した**(2026-08-29)。
// G-03 は疎検索の対照しか見ておらず、密検索には対照が無かった —— 検出系に対照を
// 対で置く規律(HC-041)の穴である。G-01 の値は動かさない。ここで見るのは索引の健全性だけ。
//
// チャンクの本文をそのまま "query: " 接頭辞で埋め込んで問えば、
// そのチャンク(または本文が同一のチャンク)が 1 位でなければならない。
// これが落ちるなら索引・接頭辞・並びのどれかが壊れている。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { searchDense } from "../src/lib/dense.mjs";
import { MODEL, DIMS } from "./embed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
env.cacheDir = resolve(ROOT, "data/model-cache");
const SAMPLE = 300;
const SEED = 20260829;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const bin = fs.readFileSync(resolve(ROOT, "data/index/vec_f32.bin"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const ids = chunks.map((c) => c.id);
  const textOf = new Map(chunks.map((c) => [c.id, c.indexText]));

  // --- 索引そのものの健全性 ---
  let minNorm = Infinity;
  let maxNorm = -Infinity;
  let zeroRows = 0;
  for (let i = 0; i < chunks.length; i++) {
    let n = 0;
    for (let d = 0; d < DIMS; d++) {
      const x = vecs[i * DIMS + d];
      n += x * x;
    }
    n = Math.sqrt(n);
    if (n === 0) zeroRows += 1;
    if (n < minNorm) minNorm = n;
    if (n > maxNorm) maxNorm = n;
  }
  console.log(`ベクトルのノルム 最小 ${minNorm.toFixed(6)} / 最大 ${maxNorm.toFixed(6)} / 零ベクトル ${zeroRows} 行`);

  const r = rng(SEED);
  const idx = [];
  const seen = new Set();
  while (idx.length < SAMPLE) {
    const i = Math.floor(r() * chunks.length);
    if (!seen.has(i)) {
      seen.add(i);
      idx.push(i);
    }
  }

  const ex = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const misses = [];
  let dupHits = 0;
  const BATCH = 64;
  for (let b = 0; b < idx.length; b += BATCH) {
    const slice = idx.slice(b, b + BATCH);
    const out = await ex(slice.map((i) => "query: " + chunks[i].indexText), {
      pooling: "mean",
      normalize: true,
    });
    const arr = Float32Array.from(out.data);
    for (let j = 0; j < slice.length; j++) {
      const q = arr.subarray(j * DIMS, (j + 1) * DIMS);
      const hit = searchDense(vecs, DIMS, ids, q, { topK: 1 })[0];
      const want = chunks[slice[j]];
      if (hit?.id === want.id) continue;
      if (hit && textOf.get(hit.id) === want.indexText) {
        dupHits += 1;
        continue;
      }
      misses.push({
        want: want.id,
        wantText: want.indexText.slice(0, 60),
        got: hit?.id ?? null,
        gotText: hit ? textOf.get(hit.id).slice(0, 60) : null,
        gotScore: hit?.score ?? null,
      });
    }
    console.log(`  ${Math.min(b + BATCH, idx.length)}/${idx.length}`);
  }
  const rate = (idx.length - misses.length) / idx.length;
  console.log(
    `\nG-09 密検索の陽性対照: ${rate.toFixed(4)}(${idx.length} 件中 ${misses.length} 件外し / 本文同一の別チャンク ${dupHits} 件)`
  );
  if (misses.length > 0) console.log(JSON.stringify(misses.slice(0, 5), null, 1));
  fs.writeFileSync(
    resolve(ROOT, "data/dense-control.json"),
    JSON.stringify({ sample: idx.length, misses: misses.length, dupHits, rate, minNorm, maxNorm, zeroRows, examples: misses.slice(0, 20) }, null, 2)
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
