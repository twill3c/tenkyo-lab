// 検索の評価指標。閾値は持たない —— 合否は SPEC のゲートが決める。
//
// 正解が複数ある問題があるため(一文が複数の条を指す)、Recall と Hit を別々に出す。
//   Recall@k = 正解のうち上位 k に入った割合。全部引けて 1.0
//   Hit@k    = 正解が 1 つでも上位 k に入れば 1.0
// **G-01 の合否は Recall@10 の全問平均(マクロ平均)で決める。**

const idsOf = (ranked) => ranked.map((r) => (typeof r === "string" ? r : r.id));

export function recallAtK(ranked, gold, k) {
  if (gold.size === 0) return 0;
  const top = idsOf(ranked).slice(0, k);
  let hit = 0;
  for (const id of top) if (gold.has(id)) hit += 1;
  return hit / gold.size;
}

export function hitAtK(ranked, gold, k) {
  if (gold.size === 0) return 0;
  return idsOf(ranked).slice(0, k).some((id) => gold.has(id)) ? 1 : 0;
}

export function reciprocalRank(ranked, gold) {
  const ids = idsOf(ranked);
  for (let i = 0; i < ids.length; i++) if (gold.has(ids[i])) return 1 / (i + 1);
  return 0;
}

/** 二値の関連度(正解か否か)での nDCG@k。 */
export function ndcgAtK(ranked, gold, k) {
  if (gold.size === 0) return 0;
  const top = idsOf(ranked).slice(0, k);
  let dcg = 0;
  for (let i = 0; i < top.length; i++) if (gold.has(top[i])) dcg += 1 / Math.log2(i + 2);
  let idcg = 0;
  for (let i = 0; i < Math.min(gold.size, k); i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * Reciprocal Rank Fusion。スコアの尺度が違う密検索と疎検索を、順位だけで混ぜる。
 * スコアの正規化を要らなくするのが利点で、k は上位の効き方を決める(慣例 60)。
 */
export function rrfFuse(rankings, { k = 60, topK = Infinity } = {}) {
  const acc = new Map();
  for (const ranking of rankings) {
    const ids = idsOf(ranking);
    for (let i = 0; i < ids.length; i++) {
      acc.set(ids[i], (acc.get(ids[i]) ?? 0) + 1 / (k + i + 1));
    }
  }
  const out = [...acc].map(([id, score]) => ({ id, score }));
  // 同点は id で決める。順位を実行ごとに揺らさない(二実装照合 G-04 の前提)
  out.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return Number.isFinite(topK) ? out.slice(0, topK) : out;
}
