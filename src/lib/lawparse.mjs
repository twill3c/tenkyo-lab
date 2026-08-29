// e-Gov 法令 API v2 の law_full_text(タグ木)から、条・項を切り出す。
//
// 平坦化してから正規表現を当ててはならない。ArticleTitle(「第十七条」)が本文に
// 混ざり、その条自身の番号を「参照」として数えてしまう(data/PROVENANCE.md に記録した
// 予備計測の欠陥)。本モジュールはタグ構造で切ることでこの故障を構造的に防ぐ。

export { kanjiToArticleNum, articleNumToLabel, kanjiToInt, intToKanji } from "./kanjinum.mjs";

/** 本文として採らないタグ。番号・記号のたぐい。 */
const NON_BODY = new Set([
  "ParagraphNum",
  "ItemTitle",
  "Subitem1Title",
  "Subitem2Title",
  "Subitem3Title",
  "Subitem4Title",
  "ArticleTitle",
  "ArticleCaption",
  "ParagraphCaption",
]);

function textOf(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  if (NON_BODY.has(node.tag)) return "";
  return (node.children ?? []).map(textOf).join("");
}

/** タグを問わず、直下の文字列と子孫の文字列をすべて連結する(見出し用)。 */
function rawTextOf(node) {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  return (node.children ?? []).map(rawTextOf).join("");
}

function childrenByTag(node, tag) {
  return (node.children ?? []).filter((c) => c && typeof c === "object" && c.tag === tag);
}

function firstByTag(node, tag) {
  return childrenByTag(node, tag)[0] ?? null;
}

/** 木を降りて最初に見つかった当該タグのノードを返す。 */
function findFirst(node, tag) {
  if (!node || typeof node !== "object") return null;
  if (node.tag === tag) return node;
  for (const c of node.children ?? []) {
    const hit = findFirst(c, tag);
    if (hit) return hit;
  }
  return null;
}

/** 木を降りて当該タグをすべて集める。 */
function findAll(node, tag, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.tag === tag) out.push(node);
  for (const c of node.children ?? []) findAll(c, tag, out);
  return out;
}

function parseParagraph(pNode) {
  const text = (pNode.children ?? [])
    .map(textOf)
    .join("")
    .replace(/\s+/g, "")
    .trim();
  return { num: (pNode.attr ?? {}).Num ?? "1", text };
}

function parseArticle(aNode, context) {
  const captionNode = firstByTag(aNode, "ArticleCaption");
  const caption = captionNode ? rawTextOf(captionNode).replace(/^[（(]|[）)]$/g, "").trim() : null;
  const paragraphs = childrenByTag(aNode, "Paragraph")
    .map(parseParagraph)
    .filter((p) => p.text.length > 0);
  return {
    num: (aNode.attr ?? {}).Num ?? null,
    caption,
    chapter: context.chapter,
    section: context.section,
    paragraphs,
  };
}

/**
 * 本則(MainProvision)の条だけを採る。附則(SupplProvision)の条は採らず、件数だけ数える。
 * 附則は改正経過にひもづく時限的な規定が多く、参照構造の解決が本則と別物になるため、
 * 本ループでは射程外とする(SPEC §2.2 / 黙って捨てず件数を記録する)。
 */
export function parseLaw(apiJson) {
  const root = apiJson.law_full_text ?? apiJson;
  const main = findFirst(root, "MainProvision");
  const articles = [];

  const walk = (node, context) => {
    if (!node || typeof node !== "object") return;
    if (node.tag === "Article") {
      articles.push(parseArticle(node, context));
      return;
    }
    let next = context;
    if (node.tag === "Chapter") {
      next = { ...context, chapter: rawTextOf(firstByTag(node, "ChapterTitle") ?? {}).trim() || null };
    } else if (node.tag === "Section") {
      next = { ...context, section: rawTextOf(firstByTag(node, "SectionTitle") ?? {}).trim() || null };
    }
    for (const c of node.children ?? []) walk(c, next);
  };
  if (main) walk(main, { chapter: null, section: null });

  const supplArticles = findAll(root, "SupplProvision").reduce(
    (n, s) => n + findAll(s, "Article").length,
    0
  );

  const titleNode = findFirst(root, "LawTitle");
  return {
    lawId: apiJson.law_info?.law_id ?? null,
    lawNum: apiJson.law_info?.law_num ?? (rawTextOf(findFirst(root, "LawNum") ?? {}).trim() || null),
    title: apiJson.revision_info?.law_title ?? (titleNode ? rawTextOf(titleNode).trim() : null),
    articles,
    excluded: {
      supplProvisionArticles: supplArticles,
    },
  };
}
