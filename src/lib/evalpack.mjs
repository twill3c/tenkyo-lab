// 詰めた順位から指標を計算し直す。「測る」ページの心臓部。
//
// 索引も模型も要らない。持っているのは 2,808 問 × 2 手法 × 上位 50 位の**チャンク番号**だけ。
// つまみ(手法 / k / RRF の定数 / 法令の絞り込み)を変えても、検索はやり直さない。
//
// **同点は id の辞書順で割る。** 評価器(scripts/evaluate.mjs)がそうしているので、
// 番号 → 辞書順の順位 の表を持って合わせる。ここを合わせないと融合の順位だけが
// 静かに食い違い、指標が評価器と一致しなくなる。

export function openEvalPack({
  denseRanks,
  sparseRanks,
  rankLen,
  goldCounts,
  goldValues,
  exclude,
  itemLaw,
  idOrder,
  meta,
}) {
  const n = meta.items;
  const goldOffset = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) goldOffset[i + 1] = goldOffset[i] + goldCounts[i];
  if (goldOffset[n] !== goldValues.length) {
    throw new Error(`正解の件数が合わない: ${goldOffset[n]} != ${goldValues.length}`);
  }
  return {
    n,
    pool: meta.pool,
    laws: meta.laws,
    reference: meta.reference,
    dense: denseRanks,
    sparse: sparseRanks,
    denseLen: rankLen.subarray(0, n),
    sparseLen: rankLen.subarray(n, n * 2),
    goldOffset,
    goldValues,
    exclude,
    itemLaw,
    idOrder,
  };
}

export function goldOf(pack, i) {
  return pack.goldValues.subarray(pack.goldOffset[i], pack.goldOffset[i + 1]);
}

/**
 * i 番の問いの順位(チャンク番号の配列)。method に応じて融合する。
 *
 * @param {any} pack
 * @param {number} i
 * @param {"dense"|"sparse"|"hybrid"} method
 * @param {number} [rrfK]
 * @returns {Uint16Array|number[]}
 */
export function rankingFor(pack, i, method, rrfK = 60) {
  const base = i * pack.pool;
  const d = pack.dense.subarray(base, base + pack.denseLen[i]);
  const s = pack.sparse.subarray(base, base + pack.sparseLen[i]);
  if (method === "dense") return d;
  if (method === "sparse") return s;
  // RRF。順位しか見ないので、スコアは要らない
  const acc = new Map();
  for (let r = 0; r < d.length; r++) acc.set(d[r], (acc.get(d[r]) ?? 0) + 1 / (rrfK + r + 1));
  for (let r = 0; r < s.length; r++) acc.set(s[r], (acc.get(s[r]) ?? 0) + 1 / (rrfK + r + 1));
  const out = [...acc.keys()];
  const order = pack.idOrder;
  out.sort((x, y) => {
    const dx = acc.get(y) - acc.get(x);
    if (dx !== 0) return dx;
    return order[x] - order[y]; // 同点は id の辞書順(評価器と同じ)
  });
  // **上位 pool 件で切る。** 融合すると最大 100 件になるが、評価器は 50 件で切っている。
  // Recall / Hit / nDCG は上位 k で切るので違いが出ないが、**打ち切りなしで全体を走る MRR
  // にだけ差が出る**(切らないと下位の当たりを拾って値が大きくなる)。
  return out.slice(0, pack.pool);
}

const has = (gold, v) => {
  for (let i = 0; i < gold.length; i++) if (gold[i] === v) return true;
  return false;
};

export function recallAtK(ranked, gold, k) {
  if (gold.length === 0) return 0;
  let hit = 0;
  const m = Math.min(k, ranked.length);
  for (let i = 0; i < m; i++) if (has(gold, ranked[i])) hit += 1;
  return hit / gold.length;
}

export function hitAtK(ranked, gold, k) {
  if (gold.length === 0) return 0;
  const m = Math.min(k, ranked.length);
  for (let i = 0; i < m; i++) if (has(gold, ranked[i])) return 1;
  return 0;
}

export function reciprocalRank(ranked, gold) {
  for (let i = 0; i < ranked.length; i++) if (has(gold, ranked[i])) return 1 / (i + 1);
  return 0;
}

export function ndcgAtK(ranked, gold, k) {
  if (gold.length === 0) return 0;
  let dcg = 0;
  const m = Math.min(k, ranked.length);
  for (let i = 0; i < m; i++) if (has(gold, ranked[i])) dcg += 1 / Math.log2(i + 2);
  let idcg = 0;
  for (let i = 0; i < Math.min(gold.length, k); i++) idcg += 1 / Math.log2(i + 2);
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * つまみの現在値で全問を計算し直す。
 * lawFilter が null なら全問、数値ならその法令だけ。
 *
 * @param {any} pack
 * @param {{ method?: "dense"|"sparse"|"hybrid", k?: number, rrfK?: number, lawFilter?: number|null }} [opts]
 * @returns {{ n: number, recall: number, hit: number, mrr: number, ndcg: number }}
 */
export function computeMetrics(pack, { method = "dense", k = 10, rrfK = 60, lawFilter = null } = {}) {
  let n = 0;
  let recall = 0;
  let hit = 0;
  let mrr = 0;
  let ndcg = 0;
  for (let i = 0; i < pack.n; i++) {
    if (lawFilter !== null && pack.itemLaw[i] !== lawFilter) continue;
    const r = rankingFor(pack, i, method, rrfK);
    const g = goldOf(pack, i);
    recall += recallAtK(r, g, k);
    hit += hitAtK(r, g, k);
    mrr += reciprocalRank(r, g);
    ndcg += ndcgAtK(r, g, k);
    n += 1;
  }
  if (n === 0) return { n: 0, recall: 0, hit: 0, mrr: 0, ndcg: 0 };
  return { n, recall: recall / n, hit: hit / n, mrr: mrr / n, ndcg: ndcg / n };
}

/**
 * 法令ごとの内訳。「ハイブリッドが負ける法令」を見つけるのに使う。
 *
 * @param {any} pack
 * @param {{ k?: number, rrfK?: number }} opts
 * @param {number} [minItems] これ未満の法令は比べない(数が少なすぎて揺れる)
 * @returns {{ law: number, title: string, n: number, dense: number, sparse: number, hybrid: number, loses: boolean }[]}
 */
export function perLaw(pack, opts, minItems = 30) {
  const counts = new Map();
  for (let i = 0; i < pack.n; i++) counts.set(pack.itemLaw[i], (counts.get(pack.itemLaw[i]) ?? 0) + 1);
  const out = [];
  for (const [law, c] of counts) {
    if (c < minItems) continue;
    const d = computeMetrics(pack, { ...opts, method: "dense", lawFilter: law });
    const s = computeMetrics(pack, { ...opts, method: "sparse", lawFilter: law });
    const h = computeMetrics(pack, { ...opts, method: "hybrid", lawFilter: law });
    out.push({
      law,
      title: pack.laws[law],
      n: c,
      dense: d.recall,
      sparse: s.recall,
      hybrid: h.recall,
      loses: h.recall < Math.max(d.recall, s.recall),
    });
  }
  out.sort((a, b) => a.hybrid - Math.max(a.dense, a.sparse) - (b.hybrid - Math.max(b.dense, b.sparse)));
  return out;
}
