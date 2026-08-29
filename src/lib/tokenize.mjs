// 日本語の疎検索・識別力判定に使う文字バイグラム。
//
// 形態素解析器を積まない。kuromoji の辞書は 15MB あり、配布量の規律(SPEC N-04)と
// 正面衝突する。日本語の全文検索は文字 n-gram で実用になる —— その事実自体が教材である。
//
// **記号で区切ってから切る。** 除去してから切ると、読点をまたいで実在しない語ができる
// (「あい、うえ」→「いう」)。これは (a) 識別力の判定では「稀な語」に化けて過大評価を招き、
// (b) BM25 では偽の一致を生む。loop_002 で修正した(loop_001 の T-310 は名前と実態が
// 食い違っていた)。

/** 語の区切りとみなす文字。ここでバイグラムを切らない。 */
export const SYMBOLS = /[、。・「」『』（）()［］\[\]〔〕，．：；:;？?！!／/\s]+/;

/** 記号で分けた断片の列。 */
export function segments(s) {
  return String(s).split(SYMBOLS).filter((x) => x.length > 0);
}

/** 記号を除いた実質の文字数。 */
export function substantiveLength(s) {
  return segments(s).reduce((n, seg) => n + seg.length, 0);
}

/** 断片ごとに切り出した文字バイグラムの集合(重複を畳む)。1 文字の断片は 1-gram として拾う。 */
export function bigrams(s) {
  const out = new Set();
  for (const seg of segments(s)) {
    if (seg.length === 1) {
      out.add(seg);
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
  }
  return out;
}

/** バイグラムごとの出現回数(BM25 の tf に使う)。 */
export function bigramCounts(s) {
  const m = new Map();
  for (const seg of segments(s)) {
    if (seg.length === 1) {
      m.set(seg, (m.get(seg) ?? 0) + 1);
      continue;
    }
    for (let i = 0; i + 2 <= seg.length; i++) {
      const g = seg.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
  }
  return m;
}

/** 文書長(BM25 の dl)。バイグラムの総数。 */
export function tokenLength(s) {
  let n = 0;
  for (const seg of segments(s)) n += seg.length === 1 ? 1 : seg.length - 1;
  return n;
}
