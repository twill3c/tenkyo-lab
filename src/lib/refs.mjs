// 条文中の条項参照を抽出する。
//
// これが本プロジェクトのオラクルの心臓部である(SPEC §2.2)。
// 抽出したいのは「同一法令内の絶対参照」だけで、次の三つは意図的に採らない:
//   1. 相対参照(前条・前項・次条・同条) …… 解決に文脈が要る。件数だけ数える
//   2. 他法令への参照(「民法（明治二十九年法律第八十九号）第七百九条」)…… 索引の外を指す
//   3. 条番号そのもの(ArticleTitle) …… lawparse がタグ構造で除くため本文には入らないが、
//      関数単体でも撃たないようにしておく(陰性対照 T-202)
//
// オラクルは「取りこぼし」より「間違った正解」の方が有害なので、迷ったら採らない側に倒す。

import { kanjiToArticleNum, kanjiToInt } from "./kanjinum.mjs";

const K = "[一二三四五六七八九十百千]+";

// 第○条(の○)*(第○項)?(第○号)? — 条を必ず含む形だけを拾う
const REF_RE = new RegExp(
  `第(${K})条((?:の${K})*)` + `(?:第(${K})項)?` + `(?:第(${K})号)?`,
  "g"
);

// 法令名の初出引用: 「…（明治二十九年法律第八十九号）」
// この直後に続く条参照は、その法令(＝本法令ではない)を指す
const LAW_CITATION_RE = new RegExp(
  `[（(](?:明治|大正|昭和|平成|令和)${K}年(?:法律|政令|勅令|府令|省令|規則)第${K}号[^）)]*[）)]`,
  "g"
);

// 括弧を伴わない他法令参照:「民法第七百九条」「同法第三条」「憲法第九条」
const LAW_NAME_TAIL_RE = /(?:法|令|条例|規則|憲章|協定|条約|議定書)$/;

const RELATIVE_PATTERNS = [
  "前各項", "前二項", "前三項", "前各号", "前二条", "前条", "前項", "前号",
  "次条", "次項", "次号",
  "同条", "同項", "同号", "同法",
];

function spansOf(text, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * 絶対参照を抽出する。返り値は出現順。
 * 他法令参照・条番号単体は除外される(理由は reason に入れて別途数えられる)。
 */
export function extractRefs(text, { includeExternal = false } = {}) {
  const citations = spansOf(text, LAW_CITATION_RE);
  const out = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(text)) !== null) {
    const [raw, artK, branchK, paraK, itemK] = m;
    const start = m.index;
    const end = start + raw.length;
    const article = kanjiToArticleNum(`第${artK}条${branchK ?? ""}`);
    if (article === null) continue;

    // 条番号そのもの(前後に文脈が無い)は参照ではない
    const isBareTitle = start === 0 && end === text.length && !paraK && !itemK;

    // 他法令参照の判定
    const afterCitation = citations.some(([, cEnd]) => cEnd === start);
    const before = text.slice(0, start);
    const afterLawName = LAW_NAME_TAIL_RE.test(before);
    const external = afterCitation || afterLawName;

    const ref = {
      raw,
      start,
      end,
      article,
      paragraph: paraK ? String(kanjiToInt(paraK)) : null,
      item: itemK ? String(kanjiToInt(itemK)) : null,
      external,
      bareTitle: isBareTitle,
    };
    if (isBareTitle) continue;
    if (external && !includeExternal) continue;
    out.push(ref);
  }
  return out;
}

/** 相対参照を種類ごとに数える。除外を黙って捨てないための計上(SPEC §2.2)。 */
export function countRelativeRefs(text) {
  const counts = Object.fromEntries(RELATIVE_PATTERNS.map((p) => [p, 0]));
  let i = 0;
  outer: while (i < text.length) {
    for (const p of RELATIVE_PATTERNS) {
      if (text.startsWith(p, i)) {
        counts[p] += 1;
        i += p.length;
        continue outer;
      }
    }
    i += 1;
  }
  return counts;
}

/**
 * クエリから参照文字列そのものを取り除く(循環の禁止 — SPEC §2.2)。
 * 除去しないと疎検索が文字列一致で当ててしまい、意味検索の評価にならない。
 * 他法令参照も含めてすべての条参照表現を落とす。位置ずれを避けるため後ろから消す。
 */
export function maskRefs(text) {
  const all = extractRefs(text, { includeExternal: true });
  const bare = [];
  REF_RE.lastIndex = 0;
  let m;
  while ((m = REF_RE.exec(text)) !== null) bare.push([m.index, m.index + m[0].length]);
  const spans = bare.length ? bare : all.map((r) => [r.start, r.end]);
  let out = text;
  for (const [s, e] of spans.slice().sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, s) + out.slice(e);
  }
  return out;
}
