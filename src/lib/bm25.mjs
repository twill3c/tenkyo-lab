// 文字バイグラムの Okapi BM25。形態素解析器を積まない(src/lib/tokenize.mjs 参照)。
//
// 転置索引は事前に組み、閲覧時は問い合わせ側のバイグラムだけを引く。
// 閾値を持たない —— BM25 が返すのは順位であって合否ではない。

import { bigramCounts, tokenLength } from "./tokenize.mjs";

export const K1 = 1.2;
export const B = 0.75;

/**
 * docs = [{ id, text }] から転置索引を組む。
 * postings: term → [docIdx, tf, docIdx, tf, ...] の平坦配列(L3 でそのまま詰めるため)
 */
export function buildIndex(docs) {
  const ids = docs.map((d) => d.id);
  const dl = new Int32Array(docs.length);
  const postings = new Map();

  for (let i = 0; i < docs.length; i++) {
    const counts = bigramCounts(docs[i].text);
    dl[i] = tokenLength(docs[i].text);
    for (const [term, tf] of counts) {
      let p = postings.get(term);
      if (!p) postings.set(term, (p = []));
      p.push(i, tf);
    }
  }
  const total = dl.reduce((a, b) => a + b, 0);
  return {
    N: docs.length,
    ids,
    dl,
    avgdl: docs.length > 0 ? total / docs.length : 0,
    postings,
    idIndex: new Map(ids.map((id, i) => [id, i])),
  };
}

/** 文書頻度。索引に無い語は 0。 */
export function documentFrequency(ix, term) {
  const p = ix.postings.get(term);
  return p ? p.length / 2 : 0;
}

/**
 * Robertson-Sparck Jones 型の IDF。
 * df=0 のとき最大側へ倒れる。負にならないよう 1+ の中で押さえる(未知語で順位が壊れない)。
 */
export function idf(ix, term) {
  const df = documentFrequency(ix, term);
  return Math.log(1 + (ix.N - df + 0.5) / (df + 0.5));
}

/**
 * BM25 で上位 topK 件を返す。exclude に入れた id は結果から除く(循環の禁止2)。
 * スコアが 0 の文書は返さない —— 1 つも語を共有しないものを「該当」と呼ばないため。
 */
export function search(ix, query, { topK = 10, exclude = null, k1 = K1, b = B } = {}) {
  const scores = new Map();
  for (const [term, qtf] of bigramCounts(query)) {
    const p = ix.postings.get(term);
    if (!p) continue;
    const w = idf(ix, term);
    for (let j = 0; j < p.length; j += 2) {
      const d = p[j];
      const tf = p[j + 1];
      const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + (b * ix.dl[d]) / ix.avgdl));
      scores.set(d, (scores.get(d) ?? 0) + w * norm * Math.min(qtf, 1));
    }
  }
  const out = [];
  for (const [d, s] of scores) {
    if (s <= 0) continue;
    const id = ix.ids[d];
    if (exclude?.has(id)) continue;
    out.push({ id, idx: d, score: s });
  }
  // 同点は id で決める。順位を実行ごとに揺らさない(二実装照合 G-04 の前提)
  out.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return out.slice(0, topK);
}
