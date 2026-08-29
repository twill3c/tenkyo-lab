// 密索引の int8 量子化。配布量を 4 分の 1(19.9MB → 5.0MB)にする。
//
// **全体一律に 127 倍してはならない。** kototoi-do では保存率が 84.9% まで落ちた ——
// e5 のスコアは狭い範囲に固まっており、丸め誤差が散らばりの三割に達する。
//
// 次元ごとに中心 μ と幅 s を取る:
//   q8[i][d] = round((v[i][d] - μ_d) / s_d * 127)
//   score(i) = Σ_d v[i][d]·q[d]
//            = Σ_d μ_d·q[d]  +  Σ_d q8[i][d] · (s_d·q[d] / 127)
//              ^^^^^^^^^^^^ 全チャンク共通の定数項。**順位に効かないので捨てる**
// つまり s はクエリ側へ畳み込む。索引側は int8 のまま触らない。
//
// この μ は**保存のための変換**であって、検索のための中心化とは別物である
// (kototoi-do では中心化そのものは測って捨てた —— 散らばりは 5 倍になるが検索は悪化した)。

/**
 * 丸めの向きを言語の既定に任せない(HC-054)。
 * JS の Math.round は半数切り上げ、Python の round は偶数丸めで食い違う。
 * ここでは **0 から遠ざかる向き**に統一する。
 */
export function roundHalfAwayFromZero(x) {
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/** 次元ごとの中心と幅を求める。 */
export function fitQuantizer(vecs, dims, count) {
  const mu = new Float64Array(dims);
  const s = new Float64Array(dims);
  for (let d = 0; d < dims; d++) {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += vecs[i * dims + d];
    mu[d] = sum / count;
  }
  for (let d = 0; d < dims; d++) {
    let m = 0;
    for (let i = 0; i < count; i++) {
      const a = Math.abs(vecs[i * dims + d] - mu[d]);
      if (a > m) m = a;
    }
    // 幅 0(その次元が定数)のときは 1 にする。0 で割らない
    s[d] = m === 0 ? 1 : m;
  }
  return { mu, s };
}

/** float32 の索引を int8 へ落とす。 */
export function quantize(vecs, dims, count, { mu, s }) {
  const out = new Int8Array(count * dims);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) {
      const q = roundHalfAwayFromZero(((vecs[i * dims + d] - mu[d]) / s[d]) * 127);
      out[i * dims + d] = q > 127 ? 127 : q < -127 ? -127 : q;
    }
  }
  return out;
}

/** 比較用: int8 から float32 相当へ戻す。検索では使わない。 */
export function dequantize(q8, dims, count, { mu, s }) {
  const out = new Float32Array(count * dims);
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < dims; d++) out[i * dims + d] = mu[d] + (s[d] * q8[i * dims + d]) / 127;
  }
  return out;
}

/** クエリ側へ s を畳み込む。定数項 Σ μ·q は順位に効かないので作らない。 */
export function foldQuery(q, dims, { s }) {
  const w = new Float64Array(dims);
  for (let d = 0; d < dims; d++) w[d] = (s[d] * q[d]) / 127;
  return w;
}

function better(a, b) {
  if (a.score !== b.score) return a.score > b.score;
  return a.id < b.id;
}

/** int8 索引に対する上位 k 検索。dense.mjs と同じ順位規約(同点は id 昇順)。 */
export function searchQuantized(q8, dims, ids, w, { topK = 10, exclude = null } = {}) {
  const heap = [];
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
    const base = i * dims;
    let sc = 0;
    for (let d = 0; d < dims; d++) sc += q8[base + d] * w[d];
    const cand = { id, idx: i, score: sc };
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
