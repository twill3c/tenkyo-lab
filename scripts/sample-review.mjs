// オラクルから無作為 100 問を抽出し、目視検分用の一覧を出す(G-07)。
//
// 「計器を先に疑う」— 自動生成した正解が本当に妥当かを、ゲート判定に使う前に人が見る。
// kototoi-do では G-01 が 4.60 で落ちた原因が実装ではなく計器の側にあった。
//
// 抽出は種つき擬似乱数で行い、何度走らせても同じ 100 問になるようにする
// (Math.random を使うと検分の対象が毎回変わり、検分そのものが再現できない)。

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLE_SIZE = 100;
const SEED = 20260830; // G-07 二度目: 一度目(20260829)とは別の 100 問で判定し直す

/** mulberry32 — 種つき擬似乱数。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample(items, n, seed) {
  const r = rng(seed);
  const idx = items.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, n).sort((a, b) => a - b).map((i) => items[i]);
}

/** 自動で拾える不審点。人の目を向ける先を絞るためのもので、合否は決めない。 */
export function flags(item, chunkById) {
  const f = [];
  if (/第[一二三四五六七八九十百千]+条/.test(item.query)) f.push("マスク漏れ");
  if (item.gold.length >= 5) f.push(`正解${item.gold.length}件`);
  if (item.query.length > 200) f.push(`長文${item.query.length}字`);
  if (item.gold.includes(item.sourceChunkId)) f.push("正解=出題元");
  const missing = item.gold.filter((g) => !chunkById.has(g));
  if (missing.length) f.push("正解が索引に無い");
  const bare = item.query.replace(/[、。「」（）()]/g, "");
  if (bare.length < 20) f.push("実質過短");
  return f;
}

async function main() {
  const { chunks } = JSON.parse(await readFile(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(await readFile(resolve(ROOT, "data/oracle.json"), "utf8"));
  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const picked = sample(items, SAMPLE_SIZE, SEED);

  const lines = [
    "# G-07 目視検分シート",
    "",
    `オラクル全 ${items.length} 問から、種 ${SEED} で無作為抽出した ${picked.length} 問。`,
    "同じ種で何度でも同じ 100 問が出る。**この検分に通るまで G-01 の閾値判定を行わない**(SPEC §2.2)。",
    "",
    "判定欄: `○` 正解が妥当 / `×` 妥当でない / `△` 判断保留。理由を添える。",
    "",
  ];
  const flagCount = {};
  for (const [n, it] of picked.entries()) {
    const fl = flags(it, chunkById);
    for (const f of fl) flagCount[f.replace(/\d+/g, "N")] = (flagCount[f.replace(/\d+/g, "N")] ?? 0) + 1;
    lines.push(`## ${n + 1}. ${it.lawTitle} ${it.sourceLabel}${fl.length ? `　⚠ ${fl.join(" / ")}` : ""}`);
    lines.push("");
    lines.push(`- **クエリ**: ${it.query}`);
    lines.push(`- **原文**: ${it.rawSentence}`);
    for (const g of it.gold) {
      const c = chunkById.get(g);
      lines.push(
        `- **正解** ${c ? `${c.articleLabel}第${c.paragraphNum}項` : g}${c?.caption ? `（${c.caption}）` : ""}: ${c ? c.text.slice(0, 120) : "索引に無い"}`
      );
    }
    lines.push("- **判定**: ");
    lines.push("");
  }

  await writeFile(resolve(ROOT, "data/oracle-review.md"), lines.join("\n"), "utf8");
  console.log(`検分シート: data/oracle-review.md（${picked.length} 問）`);
  console.log("自動で拾った不審点の内訳:", flagCount);
  const clean = picked.filter((it) => flags(it, chunkById).length === 0).length;
  console.log(`不審点なし: ${clean} / ${picked.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
