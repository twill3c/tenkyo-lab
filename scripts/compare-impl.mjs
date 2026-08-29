// G-04 二実装照合。TS 側と Python 側の書き出しを突き合わせる。
//
// **許容を置かない**(HC-054)。順位は完全一致を要求する。
// 食い違ったときは「順位が入れ替わったのか」「どの層で割れたのか」を分けて出す ——
// 上の層(分かち書き)が壊れていれば、下の層(順位)の一致は意味を持たない。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function compareArrays(a, b, label, sample = 3) {
  if (a.length !== b.length) {
    return { label, pass: false, detail: `件数が違う ${a.length} != ${b.length}` };
  }
  const bad = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) bad.push(i);
  return {
    label,
    pass: bad.length === 0,
    n: a.length,
    mismatches: bad.length,
    detail: bad.slice(0, sample).map((i) => `[${i}] ts=${a[i]} py=${b[i]}`),
  };
}

function compareRanks(a, b, label) {
  if (a.length !== b.length) return { label, pass: false, detail: `件数が違う` };
  const bad = [];
  for (let i = 0; i < a.length; i++) {
    if (a[i].item !== b[i].item) {
      bad.push({ i, why: "問いが違う", ts: a[i].item, py: b[i].item });
      continue;
    }
    if (a[i].ids.join("") !== b[i].ids.join("")) {
      const at = a[i].ids.findIndex((x, k) => x !== b[i].ids[k]);
      bad.push({ i, item: a[i].item, why: `${at + 1} 位から違う`, ts: a[i].ids[at], py: b[i].ids[at] });
    }
  }
  return { label, pass: bad.length === 0, n: a.length, mismatches: bad.length, detail: bad.slice(0, 5) };
}

async function main() {
  const tsPath = resolve(ROOT, "data/ranks-ts.json");
  const pyPath = resolve(ROOT, "data/ranks-py.json");
  for (const p of [tsPath, pyPath]) {
    if (!fs.existsSync(p)) {
      console.error(`${p} が無い。node scripts/dump-ranks.mjs と python harness/reference/dump_ranks.py を先に走らせる`);
      process.exit(1);
    }
  }
  const ts = JSON.parse(fs.readFileSync(tsPath, "utf8"));
  const py = JSON.parse(fs.readFileSync(pyPath, "utf8"));

  const results = [
    compareArrays(ts.tokenHashes.chunks, py.tokenHashes.chunks, "層1 分かち書き(チャンク全件)"),
    compareArrays(ts.tokenHashes.queries, py.tokenHashes.queries, "層1 分かち書き(クエリ全件)"),
    {
      label: "層1 文書長の総和ハッシュ",
      pass: ts.tokenHashes.lengths === py.tokenHashes.lengths,
      detail: [`ts=${ts.tokenHashes.lengths} py=${py.tokenHashes.lengths}`],
    },
  ];

  for (const k of ["N", "termCount", "dlSum", "termsHash", "dfHash"]) {
    results.push({
      label: `層2 疎索引 ${k}`,
      pass: ts.sparseIndex[k] === py.sparseIndex[k],
      detail: [`ts=${ts.sparseIndex[k]} py=${py.sparseIndex[k]}`],
    });
  }
  // avgdl は割り算の結果。両側とも float64 の同じ式なので完全一致を要求する
  results.push({
    label: "層2 疎索引 avgdl(完全一致)",
    pass: ts.sparseIndex.avgdl === py.sparseIndex.avgdl,
    detail: [`ts=${ts.sparseIndex.avgdl} py=${py.sparseIndex.avgdl}`],
  });

  results.push(compareRanks(ts.sparseRanks, py.sparseRanks, "層3 疎検索の順位"));
  results.push(compareRanks(ts.denseRanks, py.denseRanks, "層3 密検索の順位"));
  results.push(compareRanks(ts.hybridRanks, py.hybridRanks, "層3 融合(RRF)の順位"));

  // 密検索の最上位スコアは float64 の逐次和。ビット一致を要求する
  const scoreBad = [];
  for (let i = 0; i < ts.denseRanks.length; i++) {
    if (ts.denseRanks[i].topScore !== py.denseRanks[i].topScore) {
      scoreBad.push({
        item: ts.denseRanks[i].item,
        ts: ts.denseRanks[i].topScore,
        py: py.denseRanks[i].topScore,
        ulp: Math.abs(ts.denseRanks[i].topScore - py.denseRanks[i].topScore),
      });
    }
  }
  results.push({
    label: "層3 密検索の最上位スコア(ビット一致)",
    pass: scoreBad.length === 0,
    n: ts.denseRanks.length,
    mismatches: scoreBad.length,
    detail: scoreBad.slice(0, 3),
  });

  console.log("--- G-04 二実装照合 ---");
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    const extra = r.n !== undefined ? `(${r.n} 件中 ${r.mismatches} 件違い)` : "";
    console.log(`${r.pass ? "○" : "×"} ${r.label.padEnd(34)} ${extra}`);
    if (!r.pass && r.detail?.length) {
      for (const d of r.detail) console.log(`     ${typeof d === "string" ? d : JSON.stringify(d)}`);
    }
  }
  console.log(`\nG-04: ${allPass ? "○ 全層で完全一致" : "× 食い違いあり"}`);
  fs.writeFileSync(resolve(ROOT, "data/compare-impl.json"), JSON.stringify({ pass: allPass, results }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
