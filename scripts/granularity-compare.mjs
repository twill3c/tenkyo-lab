// F-02 粒度の比較。**条単位の索引で直接測る。**
//
// §5.1 では「項単位の順位を条に丸めた推定」で 0.4938 を出した。
// 推定と直接測定が近ければ推定が妥当だったことになり、離れれば**推定のほうが間違っていた**ことになる。
// どちらでも成果なので、この数字に合否は付けない(SPEC §5 の閾値の根拠を参照)。
//
// 問いの文は項単位のものをそのまま使う。**埋め込みも使い回せる** ——
// 問いが同じなら問いのベクトルも同じで、変わるのは索引側だけである。
// 新しいのは正解と除外の写し替えだけで、そこが G-17 の見どころになる。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildIndex, search as searchSparse } from "../src/lib/bm25.mjs";
import { searchDense } from "../src/lib/dense.mjs";
import { recallAtK, hitAtK, reciprocalRank, ndcgAtK, rrfFuse } from "../src/lib/metrics.mjs";
import { extractRefs } from "../src/lib/refs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIMS = 384;
const POOL = 50;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const readVec = (p) => {
  const b = fs.readFileSync(resolve(ROOT, p));
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

/** 条単位の評価セットを、項単位のものから写し替える。 */
export function deriveArticleOracle(items, paraChunks, artChunks) {
  const artOf = new Map(paraChunks.map((c) => [c.id, `${c.lawId}#${c.articleNum}`]));
  const artIds = new Set(artChunks.map((c) => c.id));
  const key2id = new Map(artChunks.map((c) => [`${c.lawId}#${c.articleNum}`, c.id]));
  const out = [];
  const dropped = { selfArticle: 0, goldMissing: 0, sourceMissing: 0 };
  for (const it of items) {
    const srcKey = artOf.get(it.sourceChunkId);
    const srcId = key2id.get(srcKey);
    if (!srcId) {
      dropped.sourceMissing += 1;
      continue;
    }
    const goldKeys = [...new Set(it.gold.map((g) => artOf.get(g)))];
    if (goldKeys.some((k) => k === srcKey)) {
      dropped.selfArticle += 1;
      continue;
    }
    const goldIds = goldKeys.map((k) => key2id.get(k)).filter((x) => x && artIds.has(x));
    if (goldIds.length !== goldKeys.length) {
      dropped.goldMissing += 1;
      continue;
    }
    out.push({ id: it.id, query: it.query, lawId: it.lawId, gold: goldIds, excludeFromResults: [srcId], srcIndex: items.indexOf(it) });
  }
  return { items: out, dropped };
}

function summarize(ranked, golds, label) {
  const at = (k, f) => mean(ranked.map((r, i) => f(r, golds[i], k)));
  return {
    label,
    n: ranked.length,
    "Recall@1": at(1, recallAtK),
    "Recall@5": at(5, recallAtK),
    "Recall@10": at(10, recallAtK),
    "Recall@20": at(20, recallAtK),
    "Hit@10": at(10, hitAtK),
    MRR: mean(ranked.map((r, i) => reciprocalRank(r, golds[i]))),
    "nDCG@10": at(10, ndcgAtK),
  };
}

const row = (m) =>
  `${m.label.padEnd(16)} ` +
  ["Recall@1", "Recall@5", "Recall@10", "Recall@20", "Hit@10", "MRR", "nDCG@10"]
    .map((k) => `${k} ${m[k].toFixed(4)}`)
    .join("  ");

async function main() {
  const { chunks: paraChunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { chunks: artChunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks-article.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const paraVecs = readVec("data/index/vec_f32.bin");
  const artVecs = readVec("data/index-article/vec_f32.bin");
  const qvecs = readVec("data/index/query_f32.bin");
  const artMeta = JSON.parse(fs.readFileSync(resolve(ROOT, "data/index-article/vec-meta.json"), "utf8"));

  const artIds = artChunks.map((c) => c.id);
  if (artMeta.count !== artChunks.length) throw new Error(`条単位の索引の件数が合わない`);
  const misaligned = artMeta.ids.filter((id, i) => id !== artIds[i]);
  if (misaligned.length) throw new Error(`条単位の索引の並びが違う(先頭: ${misaligned[0]})`);

  const { items: artItems, dropped } = deriveArticleOracle(items, paraChunks, artChunks);
  console.log(`条単位の問い ${artItems.length} / 元 ${items.length}(写し替えで落ちた: ${JSON.stringify(dropped)})`);

  // --- G-17 循環の禁止の不変量 ---
  const artText = new Map(artChunks.map((c) => [c.id, c.indexText]));
  const bad = { refLeak: [], goldIsSource: [], goldMissing: [], excludeMissing: [] };
  for (const it of artItems) {
    if (extractRefs(it.query, { includeExternal: true }).length > 0) bad.refLeak.push(it.id);
    if (it.gold.includes(it.excludeFromResults[0])) bad.goldIsSource.push(it.id);
    if (it.gold.some((g) => !artText.has(g))) bad.goldMissing.push(it.id);
    if (!artText.has(it.excludeFromResults[0])) bad.excludeMissing.push(it.id);
  }
  const g17ok = Object.values(bad).every((x) => x.length === 0);
  console.log(
    `${g17ok ? "○" : "×"} G-17 循環の禁止の不変量: ` +
      Object.entries(bad).map(([k, v]) => `${k}=${v.length}`).join(" / ")
  );

  // --- 両粒度で検索 ---
  const paraIds = paraChunks.map((c) => c.id);
  const paraIx = buildIndex(paraChunks.map((c) => ({ id: c.id, text: c.indexText })));
  const artIx = buildIndex(artChunks.map((c) => ({ id: c.id, text: c.indexText })));
  console.log(`疎索引 項単位 ${paraIx.postings.size.toLocaleString()} 語 / 条単位 ${artIx.postings.size.toLocaleString()} 語`);

  const res = { paragraph: {}, article: {} };
  for (const [name, chunkIds, vecs, ix, evalItems] of [
    ["paragraph", paraIds, paraVecs, paraIx, items],
    ["article", artIds, artVecs, artIx, artItems],
  ]) {
    const golds = evalItems.map((it) => new Set(it.gold));
    const d = [];
    const s = [];
    const h = [];
    for (let i = 0; i < evalItems.length; i++) {
      const it = evalItems[i];
      const qi = name === "article" ? it.srcIndex : i;
      const exclude = new Set(it.excludeFromResults);
      const q = qvecs.subarray(qi * DIMS, (qi + 1) * DIMS);
      const dd = searchDense(vecs, DIMS, chunkIds, q, { topK: POOL, exclude });
      const ss = searchSparse(ix, it.query, { topK: POOL, exclude });
      d.push(dd);
      s.push(ss);
      h.push(rrfFuse([dd, ss], { topK: POOL }));
      if (i % 700 === 0) console.log(`  ${name} ${i}/${evalItems.length}`);
    }
    res[name] = {
      dense: summarize(d, golds, "密"),
      sparse: summarize(s, golds, "疎"),
      hybrid: summarize(h, golds, "融合"),
    };
  }

  console.log("\n--- 項単位(1 チャンク = 条の項・13,600) ---");
  for (const m of Object.values(res.paragraph)) console.log(row(m));
  console.log("\n--- 条単位(1 チャンク = 条・6,239) ---");
  for (const m of Object.values(res.article)) console.log(row(m));

  const estimate = 0.4938; // §5.1 の推定(項単位の順位を条に丸めたもの)
  const direct = res.article.dense["Recall@10"];
  console.log(`\n粒度の効き(密 Recall@10): 項単位 ${res.paragraph.dense["Recall@10"].toFixed(4)} → 条単位 ${direct.toFixed(4)}`);
  console.log(`  §5.1 の推定 ${estimate} との差 ${(direct - estimate >= 0 ? "+" : "") + (direct - estimate).toFixed(4)}`);

  // --- 実物比較用: 同じ条が二つの粒度でどう切れるか ---
  const samples = [];
  for (const c of artChunks) {
    const parts = paraChunks.filter((p) => p.lawId === c.lawId && p.articleNum === c.articleNum);
    if (parts.length >= 3 && c.text.length > 200 && c.text.length < 900) {
      samples.push({
        lawTitle: c.lawTitle,
        articleLabel: c.articleLabel,
        caption: c.caption,
        article: c.text,
        paragraphs: parts.map((p) => ({ num: p.paragraphNum, text: p.text })),
      });
    }
    if (samples.length >= 6) break;
  }

  const lens = (cs) => {
    const l = cs.map((c) => c.indexText.length).sort((a, b) => a - b);
    return { min: l[0], p50: l[l.length >> 1], p90: l[Math.floor(l.length * 0.9)], max: l.at(-1), n: l.length };
  };

  fs.writeFileSync(
    resolve(ROOT, "data/granularity.json"),
    JSON.stringify(
      {
        counts: { paragraph: paraChunks.length, article: artChunks.length },
        lengths: { paragraph: lens(paraChunks), article: lens(artChunks) },
        terms: { paragraph: paraIx.postings.size, article: artIx.postings.size },
        items: { paragraph: items.length, article: artItems.length, dropped },
        results: res,
        estimate,
        g17: { pass: g17ok, bad: Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.length])) },
        samples,
      },
      null,
      2
    )
  );
  console.log("\n→ data/granularity.json");
  if (!g17ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
