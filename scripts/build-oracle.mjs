// data/chunks.json → data/oracle.json
//
// 条文中の内部参照から、人手ゼロで検索評価セットを作る(SPEC §2.2)。
//   クエリ = 参照を含む文から、参照文字列そのものを取り除いたもの
//   正解   = その参照が指す条(項)のチャンク
//
// 循環の禁止のために三つの手当てをする:
//   1. クエリから参照文字列(「第十七条第一項」)を消す。消さないと疎検索が文字列一致で当たる
//   2. 出題元のチャンクを検索結果から除外する。クエリは出題元の本文の一部なので、
//      除外しないと出題元が必ず 1 位に来る(それは正解ではない)
//   3. 自条への参照を捨てる。1 と 2 があっても、自条参照は課題として成立しない
//
// 捨てたものは黙って捨てず、理由ごとに数える。

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { extractRefs, countRelativeRefs, maskRefs } from "../src/lib/refs.mjs";
import { articleNumToLabel } from "../src/lib/lawparse.mjs";
import { substantiveLength, bigrams } from "../src/lib/tokenize.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 課題として成立しないものを落とす条件。
//
// G-07(目視検分・2026-08-29)で分かったのは、失敗が無作為ではなく一つの型に集中することだった。
// 罰則・読替・準用の「列挙条文」は文のほとんどが参照でできており、マスクすると
// 「）若しくは（において準用する場合を含む。」のような残骸しか残らない。人にも答えられない。
//
// 除外条件は **クエリ単独の性質だけ**で組む。
// 「正解の条文と語が重なるか」で選別してはならない — それは答えを問いに埋め込む循環である。
const MIN_QUERY_CHARS = 20;
/** 記号・括弧を除いた実質の文字数。これ未満は残骸(例:「ただし書の規定は、前項の場合について準用する。」)。 */
const MIN_SUBSTANTIVE_CHARS = 25;
/** 元の文のうち参照文字列が占める割合。高いほど列挙条文である。 */
const MAX_REF_COVERAGE = 0.3;
/** 一文が指す参照の数。多いほど列挙条文である。 */
const MAX_REFS_PER_SENTENCE = 3;
/** 正解の件数。多いと Recall@k が無償で上がり、指標が意味を失う。 */
const MAX_GOLD = 3;

// --- 識別力(specificity)の下限 ---
//
// 一度目の検分(妥当率 85%)で残った不良は、すべて「準用規定で場面指示が相対参照だけ」の型だった。
//   不良: 「の規定は、前項第一号及び第二号に掲げる場合について準用する。」(実質 30 字)
//   良問: 「の規定は、統括安全衛生責任者の業務の執行について準用する。」(実質 27 字)
// 長さでは分けられない。分けているのは **識別力のある語が残っているか** である。
//
// 循環しないか: 判定に使うのは「コーパス全体での語の希少さ」であって、
// 「正解の条文と語が重なるか」ではない。正解を一切見ないので、答えを問いに埋め込まない。
// ただし *語彙的に引ける問題* へ寄る恐れは残る。L2 で「クエリと正解の文字バイグラムの
// 重なりがゼロの件数」を測り、密検索でしか解けない問題が残っていることを確かめる(SPEC N-08)。
// 二つの定数は、一度目の検分で判定した既知の不良 7 問・良問 5 問に当てて選んだ(2026-08-29)。
// **観測に合わせて選んだ値である**ことを明記しておく。DF<=0.5%・3 個以上で、
// 不良 7 問中 6 問が落ち、良問 5 問はすべて残った(残った 1 問は「申立て及びその取下げ」を含み、
// 判定が × と △ の境目だったもの)。較正した値であり、合否を決めるゲート閾値ではない。
// G-07 の閾値 90% は動かさず、この変更後に別の 100 問で判定し直す。
/** この割合以下のチャンクにしか現れないバイグラムを「識別力がある」とみなす。 */
const DISTINCTIVE_DF_RATIO = 0.005;
/** クエリに残っていることを要求する識別力のあるバイグラムの数。 */
const MIN_DISTINCTIVE_BIGRAMS = 3;

/** チャンク集合から、各バイグラムが何チャンクに現れるかを数える。 */
export function documentFrequency(chunks) {
  const df = new Map();
  for (const c of chunks) {
    for (const g of bigrams(c.indexText)) df.set(g, (df.get(g) ?? 0) + 1);
  }
  return df;
}

export function distinctiveCount(query, df, total) {
  const cut = total * DISTINCTIVE_DF_RATIO;
  let n = 0;
  for (const g of bigrams(query)) if ((df.get(g) ?? 0) <= cut) n += 1;
  return n;
}

export { substantiveLength, bigrams } from "../src/lib/tokenize.mjs";

/** 文へ割る。法令の括弧書きは長いが句点を含むことは稀なので、句点だけで割る。 */
export function splitSentences(text) {
  return text
    .split(/(?<=。)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function buildOracle(chunks) {
  // lawId → articleNum → paragraphNum → chunk
  const byLaw = new Map();
  for (const c of chunks) {
    if (!byLaw.has(c.lawId)) byLaw.set(c.lawId, new Map());
    const arts = byLaw.get(c.lawId);
    if (!arts.has(c.articleNum)) arts.set(c.articleNum, new Map());
    arts.get(c.articleNum).set(c.paragraphNum, c);
  }

  const items = [];
  const excl = {
    self: 0,
    external: 0,
    targetMissing: 0,
    queryTooShort: 0,
    paragraphFellBack: 0,
    // 以下は G-07 目視検分(2026-08-29)を受けて足した除外(列挙条文)
    refCoverageTooHigh: 0,
    tooManyRefs: 0,
    notSubstantive: 0,
    tooManyGold: 0,
    notDistinctive: 0,
  };
  const df = documentFrequency(chunks);
  const relative = {};

  for (const src of chunks) {
    for (const [si, sentence] of splitSentences(src.text).entries()) {
      for (const [k, v] of Object.entries(countRelativeRefs(sentence))) {
        relative[k] = (relative[k] ?? 0) + v;
      }
      // 他法令参照は extractRefs が既に落としているので、数えるために別途取る
      const all = extractRefs(sentence, { includeExternal: true });
      excl.external += all.filter((r) => r.external).length;

      const refs = extractRefs(sentence);
      if (refs.length === 0) continue;

      // --- 列挙条文を落とす。判定はすべて「元の文とクエリ」だけを見る(正解は見ない) ---
      if (all.length > MAX_REFS_PER_SENTENCE) {
        excl.tooManyRefs += 1;
        continue;
      }
      const refChars = all.reduce((n, r) => n + r.raw.length, 0);
      if (refChars / sentence.length >= MAX_REF_COVERAGE) {
        excl.refCoverageTooHigh += 1;
        continue;
      }

      const arts = byLaw.get(src.lawId);
      const gold = new Set();
      for (const r of refs) {
        if (r.article === src.articleNum) {
          excl.self += 1;
          continue;
        }
        const paras = arts.get(r.article);
        if (!paras) {
          excl.targetMissing += 1;
          continue;
        }
        let target = r.paragraph ? paras.get(r.paragraph) : null;
        if (!target) {
          if (r.paragraph) excl.paragraphFellBack += 1;
          target = paras.get("1") ?? [...paras.values()][0];
        }
        if (target) gold.add(target.id);
      }
      if (gold.size === 0) continue;
      if (gold.size > MAX_GOLD) {
        excl.tooManyGold += 1;
        continue;
      }

      const query = maskRefs(sentence).replace(/\s+/g, "").trim();
      if (query.length < MIN_QUERY_CHARS) {
        excl.queryTooShort += 1;
        continue;
      }
      if (substantiveLength(query) < MIN_SUBSTANTIVE_CHARS) {
        excl.notSubstantive += 1;
        continue;
      }
      if (distinctiveCount(query, df, chunks.length) < MIN_DISTINCTIVE_BIGRAMS) {
        excl.notDistinctive += 1;
        continue;
      }

      items.push({
        id: `${src.id}@${si}`,
        lawId: src.lawId,
        lawTitle: src.lawTitle,
        query,
        rawSentence: sentence,
        sourceChunkId: src.id,
        sourceLabel: `${src.articleLabel}第${src.paragraphNum}項`,
        gold: [...gold],
        goldLabels: [...gold].map((id) => {
          const [, ap] = id.split("#");
          const [a] = ap.split("-");
          return articleNumToLabel(a);
        }),
        // 出題元は結果から除外して採点する(循環の禁止 2)
        excludeFromResults: [src.id],
      });
    }
  }
  return { items, excluded: excl, relative };
}

async function main() {
  const { chunks } = JSON.parse(await readFile(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items, excluded, relative } = buildOracle(chunks);

  const perLaw = {};
  for (const it of items) perLaw[it.lawTitle] = (perLaw[it.lawTitle] ?? 0) + 1;
  const goldSizes = items.map((i) => i.gold.length);
  const qlens = items.map((i) => i.query.length).sort((a, b) => a - b);

  const stats = {
    chunks: chunks.length,
    items: items.length,
    goldPerItem: {
      one: goldSizes.filter((n) => n === 1).length,
      many: goldSizes.filter((n) => n > 1).length,
      max: Math.max(...goldSizes),
    },
    queryChars: { min: qlens[0], p50: qlens[Math.floor(qlens.length / 2)], max: qlens.at(-1) },
    excluded,
    relativeRefs: Object.fromEntries(Object.entries(relative).filter(([, v]) => v > 0)),
    perLaw,
  };

  await writeFile(resolve(ROOT, "data/oracle.json"), JSON.stringify({ stats, items }), "utf8");
  console.log(JSON.stringify(stats, null, 2));
  if (items.length === 0) {
    console.error("オラクルが 1 件も生成されなかった");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
