// 詰めた索引を読む。閲覧者の端末で動く側。
//
// **転置索引を丸ごと展開しない。** 1,080,280 件のポスティングを Map に開くと
// 端末の常駐が数十 MB に膨らむ。問い合わせに出てくる語(数十件)だけをその場で解く。

/** LEB128 を 1 つ読む。返り値は [値, 次の位置]。 */
export function readVarint(buf, pos) {
  let v = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    v |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [v >>> 0, pos];
    shift += 7;
  }
}

/**
 * 詰めた疎索引を開く(展開はしない)。
 * terms は 2 つの UTF-16 符号単位で固定長に詰めてある(1 文字語は第 2 単位が 0)。
 */
export function openPackedSparse({ terms, postings, offsets, meta, dl }) {
  const termIndex = new Map();
  for (let i = 0; i < terms.length / 2; i++) {
    const a = terms[i * 2];
    const b = terms[i * 2 + 1];
    termIndex.set(b === 0 ? String.fromCharCode(a) : String.fromCharCode(a, b), i);
  }
  return { termIndex, postings, offsets, dl, N: meta.N, avgdl: meta.avgdl };
}

/** その語のポスティングを解く。差分を戻して [doc, tf, doc, tf, ...] にする。 */
export function decodePostings(packed, term) {
  const t = packed.termIndex.get(term);
  if (t === undefined) return null;
  let pos = packed.offsets[t];
  const end = packed.offsets[t + 1];
  let df;
  [df, pos] = readVarint(packed.postings, pos);
  const out = new Array(df * 2);
  let doc = 0;
  for (let i = 0; i < df; i++) {
    let delta;
    let tf;
    [delta, pos] = readVarint(packed.postings, pos);
    [tf, pos] = readVarint(packed.postings, pos);
    doc += delta;
    out[i * 2] = doc;
    out[i * 2 + 1] = tf;
  }
  if (pos !== end) throw new Error(`ポスティングの長さが合わない: ${term} pos=${pos} end=${end}`);
  return out;
}

/**
 * 詰めた索引の上に buildIndex と同じ形の窓口を作る。
 * bm25.mjs の search() をそのまま使えるので、**照合が二重にならない**。
 * postings は Map の顔をしているが、get されたときに初めて解く。
 */
export function asIndex(packed, ids) {
  const cache = new Map();
  return {
    N: packed.N,
    avgdl: packed.avgdl,
    dl: packed.dl,
    ids,
    postings: {
      get(term) {
        if (cache.has(term)) return cache.get(term);
        const p = decodePostings(packed, term);
        cache.set(term, p ?? undefined);
        return p ?? undefined;
      },
      has(term) {
        return packed.termIndex.has(term);
      },
      get size() {
        return packed.termIndex.size;
      },
      keys() {
        return packed.termIndex.keys();
      },
    },
  };
}

/** meta.json からチャンク id を組み立て直す。詰めるとき id 文字列を捨てた分を戻す。 */
export function rebuildIds(meta) {
  return meta.chunks.map(([lawIdx, art, para]) => `${meta.laws[lawIdx].id}#${art}-${para}`);
}

/** text.bin の該当範囲。HTTP Range のバイト範囲としてそのまま使える。 */
export function textRange(offsets, i) {
  return { start: offsets[i], end: offsets[i + 1] - 1, length: offsets[i + 1] - offsets[i] };
}
