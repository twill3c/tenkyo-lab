// 密検索。埋め込みは正規化済みなので、余弦類似度は内積で足りる。
//
// 索引は Float32Array 1 本(連続配置)。チャンクごとの配列にすると
// 13,600 個のオブジェクトが要り、端末で重くなる。

export function dot(vecs, dims, i, q) {
  const base = i * dims;
  let s = 0;
  for (let d = 0; d < dims; d++) s += vecs[base + d] * q[d];
  return s;
}

/**
 * 上位 topK 件。exclude に入れた id は結果から除く(循環の禁止2)。
 * 疎検索と違い、スコアが 0 以下でも返す —— 余弦は「無関係」を 0 付近で表すだけで、
 * 「1 語も共有しない」という疎検索の 0 とは意味が違う。
 */
/** 上位ほど後ろに来る比較。同点は id の昇順が上位(二実装照合 G-04 の前提)。 */
function better(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  return a.id < b.id;
}

export function searchDense(vecs, dims, ids, q, { topK = 10, exclude = null } = {}) {
  // 全件をソートしない。13,600 件 × 数千問では全件ソートが律速になる。
  // 大きさ topK の最小ヒープを保ち、最下位を上回ったものだけを入れ替える
  const heap = []; // heap[0] が「いま最も弱い採用者」
  const siftDown = (i) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && better(heap[m], heap[l])) m = l;
      if (r < heap.length && better(heap[m], heap[r])) m = r;
      if (m === i) return;
      [heap[i], heap[m]] = [heap[m], heap[i]];
      i = m;
    }
  };
  const siftUp = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!better(heap[p], heap[i])) return;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (exclude?.has(id)) continue;
    const cand = { id, idx: i, score: dot(vecs, dims, i, q) };
    if (heap.length < topK) {
      heap.push(cand);
      siftUp(heap.length - 1);
    } else if (better(cand, heap[0])) {
      heap[0] = cand;
      siftDown(0);
    }
  }
  heap.sort((x, y) => (better(x, y) ? -1 : better(y, x) ? 1 : 0));
  return heap;
}
