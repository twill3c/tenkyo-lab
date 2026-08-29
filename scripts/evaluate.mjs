// 索引と評価器を突き合わせ、較正ゲート G-01 / G-02 / G-03 / G-08 を判定する。
//
// 閾値は SPEC §5 に置いてあり、このスクリプトは読むだけで書き換えない。
// 落ちたら閾値ではなく計器(索引・評価器・オラクル)を先に疑う。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildIndex, search as searchSparse } from "../src/lib/bm25.mjs";
import { searchDense } from "../src/lib/dense.mjs";
import { recallAtK, hitAtK, reciprocalRank, ndcgAtK, rrfFuse } from "../src/lib/metrics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIMS = 384;
const TOPK = 50; // 融合のために各手法から取る件数。指標は上位 k を切り出して計算する

// SPEC §5 の閾値。ここでは読むだけ
export const GATES = { G01_RECALL10: 0.5, G08_SPARSE_MISS: 0.1, G03_POSITIVE: 1.0 };

function loadVectors(name, expectCount) {
  const bin = fs.readFileSync(resolve(ROOT, `data/index/${name}_f32.bin`));
  const meta = JSON.parse(fs.readFileSync(resolve(ROOT, `data/index/${name}-meta.json`), "utf8"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  if (meta.count !== expectCount) {
    throw new Error(`${name}: 件数が合わない ${meta.count} != ${expectCount}`);
  }
  if (vecs.length !== meta.count * DIMS) {
    throw new Error(`${name}: 要素数が合わない ${vecs.length} != ${meta.count * DIMS}`);
  }
  return { vecs, meta };
}

const mean = (xs) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
};

/**
 * 条単位に丸めた順位。正解は「条の項」だが、参照が項を指定しないときは第 1 項に倒している。
 * 正しい条の別の項を引いても外れと数えるので、粒度がどれだけ効いているかを分けて見る。
 */
function toArticleLevel(ranked, articleOf) {
  const seen = new Set();
  const out = [];
  for (const r of ranked) {
    const a = articleOf.get(r.id);
    if (seen.has(a)) continue;
    seen.add(a);
    out.push({ id: a, score: r.score });
  }
  return out;
}

function summarize(rankedList, golds) {
  const at = (k, f) => mean(rankedList.map((r, i) => f(r, golds[i], k)));
  return {
    "Recall@1": at(1, recallAtK),
    "Recall@5": at(5, recallAtK),
    "Recall@10": at(10, recallAtK),
    "Recall@20": at(20, recallAtK),
    "Hit@10": at(10, hitAtK),
    MRR: mean(rankedList.map((r, i) => reciprocalRank(r, golds[i]))),
    "nDCG@10": at(10, ndcgAtK),
  };
}

const pct = (x) => (x * 100).toFixed(1) + "%";
const row = (name, m) =>
  `${name.padEnd(10)} ` +
  ["Recall@1", "Recall@5", "Recall@10", "Recall@20", "Hit@10", "MRR", "nDCG@10"]
    .map((k) => `${k} ${m[k].toFixed(4)}`)
    .join("  ");

async function main() {
  // 密検索の索引ができる前でも、疎検索だけで確定するゲート(G-03 / G-08)は測れる
  const sparseOnly = process.argv.includes("--sparse-only");
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const chunkIds = chunks.map((c) => c.id);

  // --- 計器の突き合わせ。ここが狂っていると以降の数字は全部無意味 ---
  let vecs = null;
  let qvecs = null;
  if (!sparseOnly) {
    const dense = loadVectors("vec", chunks.length);
    vecs = dense.vecs;
    const mismatched = dense.meta.ids.filter((id, i) => id !== chunkIds[i]);
    if (mismatched.length > 0) {
      throw new Error(`索引とチャンクの並びが違う(先頭 3 件: ${mismatched.slice(0, 3)})`);
    }
    const q = loadVectors("query", items.length);
    qvecs = q.vecs;
    const qMismatched = q.meta.ids.filter((id, i) => id !== items[i].id);
    if (qMismatched.length > 0) throw new Error("クエリ索引とオラクルの並びが違う");
    console.log(`接頭辞  索引側 ${JSON.stringify(dense.meta.prefix)} / 問い側 ${JSON.stringify(q.meta.prefix)}`);
  } else {
    console.log("--sparse-only: 密検索を飛ばし、G-03 と G-08 だけを測る");
  }
  console.log(`索引 ${chunks.length} チャンク / 問い ${items.length} 件`);

  const sparseIx = buildIndex(chunks.map((c) => ({ id: c.id, text: c.indexText })));
  console.log(`疎索引 ${sparseIx.postings.size.toLocaleString()} 語 / 平均長 ${sparseIx.avgdl.toFixed(1)}`);

  // --- 検索 ---
  const golds = items.map((it) => new Set(it.gold));
  const denseRanked = [];
  const sparseRanked = [];
  const hybridRanked = [];
  const denseTop = [];
  const t0 = Date.now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const exclude = new Set(it.excludeFromResults);
    const s = searchSparse(sparseIx, it.query, { topK: TOPK, exclude });
    sparseRanked.push(s);
    if (!sparseOnly) {
      const q = qvecs.subarray(i * DIMS, (i + 1) * DIMS);
      const d = searchDense(vecs, DIMS, chunkIds, q, { topK: TOPK, exclude });
      denseRanked.push(d);
      hybridRanked.push(rrfFuse([d, s], { topK: TOPK }));
      denseTop.push(d[0]?.score ?? 0);
    }
    if (i % 500 === 0) console.log(`  検索 ${i}/${items.length}`);
  }
  console.log(`検索 ${items.length} 問 / ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const results = { sparse: summarize(sparseRanked, golds) };
  if (!sparseOnly) {
    results.dense = summarize(denseRanked, golds);
    results.hybrid = summarize(hybridRanked, golds);
  }
  console.log("\n--- 指標(チャンク単位 = 条の項) ---");
  for (const [k, v] of Object.entries(results)) console.log(row(k, v));

  // --- 粒度の寄与を分けて見る(ゲートには使わない診断) ---
  const articleOf = new Map(chunks.map((c) => [c.id, `${c.lawId}#${c.articleNum}`]));
  const goldArts = items.map((it) => new Set(it.gold.map((g) => articleOf.get(g))));
  const byArticle = {};
  const pairs = [["sparse", sparseRanked]];
  if (!sparseOnly) pairs.push(["dense", denseRanked], ["hybrid", hybridRanked]);
  for (const [name, ranked] of pairs) {
    byArticle[name] = summarize(ranked.map((r) => toArticleLevel(r, articleOf)), goldArts);
  }
  console.log("\n--- 指標(条単位に丸めた場合) ---");
  for (const [k, v] of Object.entries(byArticle)) console.log(row(k, v));
  console.log("\n粒度の寄与(条単位 − 項単位, Recall@10)");
  for (const k of Object.keys(byArticle)) {
    console.log(`  ${k.padEnd(8)} +${(byArticle[k]["Recall@10"] - results[k]["Recall@10"]).toFixed(4)}`);
  }

  // --- G-01 主ゲート ---
  const g01 = results.dense?.["Recall@10"] ?? null;

  // --- G-02 陰性対照 ---
  // 無関係な問い合わせの最高スコアが、正しい問いの最高スコアの中央値を下回ること
  let g02 = null;
  if (!sparseOnly) {
    const negatives = JSON.parse(fs.readFileSync(resolve(ROOT, "data/negatives.json"), "utf8"));
    const { vecs: nvecs } = loadVectors("negative", negatives.length);
    const negTop = [];
    for (let i = 0; i < negatives.length; i++) {
      const q = nvecs.subarray(i * DIMS, (i + 1) * DIMS);
      negTop.push(searchDense(vecs, DIMS, chunkIds, q, { topK: 1 })[0]?.score ?? 0);
    }
    g02 = { negMax: Math.max(...negTop), posMedian: median(denseTop), pass: false };
    g02.pass = g02.negMax < g02.posMedian;
  }

  // --- G-03 疎検索の陽性対照 ---
  // チャンクの本文そのものを問えば、**その本文と同一の本文を持つチャンク**が 1 位でなければならない。
  // 除外は掛けない —— 掛けたら「自分自身を引けるか」を確かめられない。
  //
  // 当初は「そのチャンクが 1 位」と書いていたが、本文が完全に重複するチャンクが 439 件
  // (異なり 156 種・うち「削除」だけが 71 件)あり、**原理的に満たせない対照**だった。
  // スコアはビット一致し、同点は id で割れる。BM25 の実装ではなく対照の書き方の誤りである
  // (loop_002 / SPEC-GAP)。閾値 1.0 は動かしていない。
  const chunkText = new Map(chunks.map((c) => [c.id, c.indexText]));
  const step = Math.max(1, Math.floor(chunks.length / 500));
  let tried = 0;
  const g03Misses = [];
  let g03Dup = 0;
  for (let i = 0; i < chunks.length; i += step) {
    tried += 1;
    const hit = searchSparse(sparseIx, chunks[i].indexText, { topK: 1 })[0];
    if (hit?.id === chunks[i].id) continue;
    if (hit && chunkText.get(hit.id) === chunks[i].indexText) {
      g03Dup += 1; // 本文が同一の別チャンク。対照としては合格
      continue;
    }
    g03Misses.push({ want: chunks[i].id, got: hit?.id ?? null });
  }
  const g03 = {
    tried,
    misses: g03Misses.length,
    duplicateTextHits: g03Dup,
    rate: (tried - g03Misses.length) / tried,
  };

  // --- G-08 語彙的偏りの検算 ---
  const sparseMiss = sparseRanked.filter((r, i) => hitAtK(r, golds[i], 10) === 0).length;
  const g08 = sparseMiss / items.length;

  const verdict = {};
  if (!sparseOnly) {
    verdict["G-01 密検索 Recall@10"] = {
      value: g01,
      threshold: GATES.G01_RECALL10,
      pass: g01 >= GATES.G01_RECALL10,
    };
    verdict["G-02 陰性対照"] = {
      value: `陰性最高 ${g02.negMax.toFixed(4)} / 正例最高の中央値 ${g02.posMedian.toFixed(4)}`,
      threshold: "陰性 < 正例中央値",
      pass: g02.pass,
    };
  }
  Object.assign(verdict, {
    "G-03 疎検索の陽性対照": {
      value: `${g03.rate.toFixed(4)}(${tried} 件中 ${g03.misses} 件外し / 本文同一の別チャンク ${g03Dup} 件)`,
      threshold: GATES.G03_POSITIVE,
      pass: g03.rate >= GATES.G03_POSITIVE,
    },
    "G-08 疎検索が解けない問題の割合": {
      value: g08,
      threshold: GATES.G08_SPARSE_MISS,
      pass: g08 >= GATES.G08_SPARSE_MISS,
    },
  });

  console.log("\n--- 較正ゲート ---");
  for (const [k, v] of Object.entries(verdict)) {
    const val = typeof v.value === "number" ? v.value.toFixed(4) : v.value;
    console.log(`${v.pass ? "○" : "×"} ${k.padEnd(30)} ${String(val).padEnd(46)} 閾値 ${v.threshold}`);
  }
  if (g03.misses > 0) {
    console.log("\nG-03 の外し(先頭 5 件):", JSON.stringify(g03Misses.slice(0, 5), null, 1));
  }

  fs.writeFileSync(
    resolve(ROOT, "data/eval-result.json"),
    JSON.stringify(
      { items: items.length, chunks: chunks.length, results, byArticle, verdict, g02, g03 },
      null,
      2
    )
  );
  console.log("\n→ data/eval-result.json");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
