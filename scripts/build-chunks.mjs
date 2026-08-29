// data/raw/*.json → data/chunks.json
//
// チャンクの単位は「条の項」。条文本文の中央値は 178 字(実測・data/PROVENANCE.md)で、
// そのまま検索単位になる粒度である。
//
// 索引本文(indexText)に条番号を入れない。
// kototoi-do が索引に書名を入れなかったのと同じ規律で、参照オラクルが
// 条番号の文字列一致で当たってしまうのを構造的に防ぐ(SPEC §2.2)。
// 見出し(ArticleCaption)は条の主題を表す本文なので入れる。

import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseLaw, articleNumToLabel } from "../src/lib/lawparse.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = resolve(ROOT, "data/raw");

export function chunkId(lawId, articleNum, paragraphNum) {
  return `${lawId}#${articleNum}-${paragraphNum}`;
}

/**
 * 分割の粒度。F-02 で切り替えて比べる。
 *   paragraph … 条の項ごとに 1 チャンク(既定。中央値 92 字)
 *   article   … 条ごとに 1 チャンク(項を連ねる。粗いほうが良いという実測 §5.1 の検算用)
 */
export function buildChunks(law, granularity = "paragraph") {
  if (granularity === "article") return buildArticleChunks(law);
  const out = [];
  for (const a of law.articles) {
    if (!a.num) continue;
    const label = articleNumToLabel(a.num);
    for (const p of a.paragraphs) {
      out.push({
        id: chunkId(law.lawId, a.num, p.num),
        lawId: law.lawId,
        lawTitle: law.title,
        articleNum: a.num,
        articleLabel: label,
        paragraphNum: p.num,
        caption: a.caption,
        chapter: a.chapter,
        section: a.section,
        text: p.text,
        // 索引に載せる本文。条番号は載せない
        indexText: (a.caption ? `${a.caption}　` : "") + p.text,
      });
    }
  }
  return out;
}

/** 条ごとに 1 チャンク。項の本文を連ねる。id は項番号を 0 にして項単位と区別する。 */
export function buildArticleChunks(law) {
  const out = [];
  for (const a of law.articles) {
    if (!a.num) continue;
    if (a.paragraphs.length === 0) continue;
    const text = a.paragraphs.map((p) => p.text).join("");
    out.push({
      id: chunkId(law.lawId, a.num, "0"),
      lawId: law.lawId,
      lawTitle: law.title,
      articleNum: a.num,
      articleLabel: articleNumToLabel(a.num),
      paragraphNum: "0",
      caption: a.caption,
      chapter: a.chapter,
      section: a.section,
      text,
      indexText: (a.caption ? `${a.caption}　` : "") + text,
    });
  }
  return out;
}

async function main() {
  const arg = (k, d) => {
    const i = process.argv.indexOf("--" + k);
    return i < 0 ? d : process.argv[i + 1];
  };
  const granularity = arg("granularity", "paragraph");
  const outFile = arg("out", "data/chunks.json");
  const files = (await readdir(RAW_DIR)).filter((f) => f.endsWith(".json"));
  const chunks = [];
  const laws = [];
  for (const f of files.sort()) {
    const law = parseLaw(JSON.parse(await readFile(resolve(RAW_DIR, f), "utf8")));
    const c = buildChunks(law, granularity);
    chunks.push(...c);
    laws.push({
      lawId: law.lawId,
      title: law.title,
      articles: law.articles.length,
      chunks: c.length,
      excludedSupplArticles: law.excluded.supplProvisionArticles,
    });
  }
  const lens = chunks.map((c) => c.indexText.length).sort((a, b) => a - b);
  const stats = {
    laws: laws.length,
    articles: laws.reduce((n, l) => n + l.articles, 0),
    chunks: chunks.length,
    excludedSupplArticles: laws.reduce((n, l) => n + l.excludedSupplArticles, 0),
    indexTextChars: {
      min: lens[0],
      p50: lens[Math.floor(lens.length * 0.5)],
      p90: lens[Math.floor(lens.length * 0.9)],
      max: lens[lens.length - 1],
      total: lens.reduce((a, b) => a + b, 0),
    },
  };
  await writeFile(resolve(ROOT, outFile), JSON.stringify({ stats: { ...stats, granularity }, laws, chunks }), "utf8");
  console.table(laws);
  console.log(stats);
  // 生成物が空のまま正常終了しない(HC-056)
  if (chunks.length === 0) {
    console.error("チャンクが 1 件も生成されなかった");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
