// F-11 「query: の接頭辞を外すと何が起きるか」を実測する。
//
// **索引側は passage: のまま固定し、問い合わせ側の接頭辞だけを変える。**
// 索引ごと作り直すのが完全な比較だが 5 時間かかる。そして実際に人が間違えるのは
// 問い合わせ側である(索引は一度作れば触らないが、問い合わせは書くたびに書く)。
// **何を変えて何を変えていないかは、画面にそのまま書く。**

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { searchDense } from "../src/lib/dense.mjs";
import { recallAtK, hitAtK, reciprocalRank } from "../src/lib/metrics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIMS = 384;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const VARIANTS = [
  { name: "query", label: '"query: "(正しい使い方)' },
  { name: "query-noprefix", label: "接頭辞なし" },
  { name: "query-passage", label: '"passage: "(索引側と同じものを付けた)' },
];

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const bin = fs.readFileSync(resolve(ROOT, "data/index/vec_f32.bin"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const ids = chunks.map((c) => c.id);
  const golds = items.map((it) => new Set(it.gold));

  const out = [];
  for (const v of VARIANTS) {
    const p = resolve(ROOT, `data/index/${v.name}_f32.bin`);
    if (!fs.existsSync(p)) {
      console.log(`  — ${v.name} は未生成。飛ばす`);
      continue;
    }
    const qb = fs.readFileSync(p);
    const qv = new Float32Array(qb.buffer, qb.byteOffset, qb.byteLength / 4);
    if (qv.length !== items.length * DIMS) {
      throw new Error(`${v.name}: 要素数が合わない ${qv.length} != ${items.length * DIMS}`);
    }
    const r10 = [];
    const h10 = [];
    const mrr = [];
    const top = [];
    for (let i = 0; i < items.length; i++) {
      const q = qv.subarray(i * DIMS, (i + 1) * DIMS);
      const hits = searchDense(vecs, DIMS, ids, q, {
        topK: 10,
        exclude: new Set(items[i].excludeFromResults),
      });
      r10.push(recallAtK(hits, golds[i], 10));
      h10.push(hitAtK(hits, golds[i], 10));
      mrr.push(reciprocalRank(hits, golds[i]));
      top.push(hits[0]?.score ?? 0);
    }
    const row = {
      name: v.name,
      label: v.label,
      recall10: mean(r10),
      hit10: mean(h10),
      mrr: mean(mrr),
      topScore: mean(top),
    };
    out.push(row);
    console.log(
      `  ${v.label.padEnd(34)} Recall@10 ${row.recall10.toFixed(4)}  Hit@10 ${row.hit10.toFixed(4)}  ` +
        `MRR ${row.mrr.toFixed(4)}  最上位スコアの平均 ${row.topScore.toFixed(4)}`
    );
  }
  if (out.length === 0) {
    console.error("比べる相手が 1 つも無い");
    process.exit(1);
  }
  const base = out.find((x) => x.name === "query");
  if (base) {
    console.log("\n  正しい使い方に対する落ち幅(Recall@10):");
    for (const r of out) {
      if (r.name === "query") continue;
      const d = r.recall10 - base.recall10;
      console.log(`    ${r.label.padEnd(34)} ${d >= 0 ? "+" : ""}${d.toFixed(4)}  (相対 ${((d / base.recall10) * 100).toFixed(1)}%)`);
    }
  }
  fs.writeFileSync(resolve(ROOT, "data/prefix-experiment.json"), JSON.stringify({ variants: out }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
