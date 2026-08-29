import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { writeVarint, packPostings, packTerms } from "../scripts/pack-index.mjs";
import { readVarint, openPackedSparse, decodePostings, asIndex, rebuildIds, textRange } from "../src/lib/packed.mjs";
import { buildIndex, search } from "../src/lib/bm25.mjs";
import { searchQuantized, foldQuery, fitQuantizer, quantize } from "../src/lib/quant.mjs";
import { searchDense } from "../src/lib/dense.mjs";

// 期待値の出所: 詰める前の実装。**詰めた索引は、詰める前と同じ答えを出さなければならない**。
// これは形式の検算であって、検索の正しさの検算ではない(それは G-01/G-04 の仕事)。

describe("可変長整数(LEB128)", () => {
  it("T-901 書いて読むと元に戻る(境界を含む)", () => {
    for (const v of [0, 1, 127, 128, 129, 255, 256, 16383, 16384, 65535, 1 << 20, 2 ** 31 - 1]) {
      const bytes = [];
      writeVarint(bytes, v);
      const [got, pos] = readVarint(Uint8Array.from(bytes), 0);
      expect(got, `v=${v}`).toBe(v);
      expect(pos).toBe(bytes.length);
    }
  });

  it("T-902 小さい値ほど短い(詰める意味があることの確認)", () => {
    const len = (v) => {
      const b = [];
      writeVarint(b, v);
      return b.length;
    };
    expect(len(1)).toBe(1);
    expect(len(127)).toBe(1);
    expect(len(128)).toBe(2);
    expect(len(16384)).toBe(3);
  });

  it("T-903 連続して読める(位置が正しく進む)", () => {
    const bytes = [];
    for (const v of [1, 300, 5, 70000]) writeVarint(bytes, v);
    const buf = Uint8Array.from(bytes);
    let pos = 0;
    const got = [];
    for (let i = 0; i < 4; i++) {
      const [v, p] = readVarint(buf, pos);
      got.push(v);
      pos = p;
    }
    expect(got).toEqual([1, 300, 5, 70000]);
    expect(pos).toBe(buf.length);
  });
});

describe("語と転置索引の詰め直し", () => {
  const docs = [
    { id: "a", text: "根抵当権の共有者は、他の共有者の同意を得てその権利を譲り渡すことができる。" },
    { id: "b", text: "統括安全衛生責任者は、元方安全衛生管理者の指揮をしなければならない。" },
    { id: "c", text: "使用者は、労働者に、休憩時間を与えなければならない。" },
    { id: "d", text: "あ" }, // 1 文字語(第 2 符号単位が 0 になる境界)
  ];
  const ix = buildIndex(docs);
  const terms = [...ix.postings.keys()].sort();
  const packed = packPostings(ix.postings, terms);
  const opened = openPackedSparse({
    terms: packTerms(terms),
    postings: packed.data,
    offsets: packed.offsets,
    meta: { N: ix.N, avgdl: ix.avgdl },
    dl: ix.dl,
  });

  it("T-904 語がすべて引ける(1 文字語を含む)", () => {
    expect(opened.termIndex.size).toBe(terms.length);
    for (const t of terms) expect(opened.termIndex.has(t), t).toBe(true);
    expect(opened.termIndex.has("あ")).toBe(true);
  });

  it("T-905 陽性対照: 解いたポスティングが詰める前と完全一致する", () => {
    for (const t of terms) {
      const orig = ix.postings.get(t);
      const pairs = [];
      for (let j = 0; j < orig.length; j += 2) pairs.push([orig[j], orig[j + 1]]);
      pairs.sort((a, b) => a[0] - b[0]);
      expect(decodePostings(opened, t), t).toEqual(pairs.flat());
    }
  });

  it("T-906 陰性対照: 索引に無い語は null を返す(例外にしない)", () => {
    expect(decodePostings(opened, "ゑひ")).toBe(null);
    expect(opened.termIndex.has("ゑひ")).toBe(false);
  });

  it("T-907 詰めた索引で検索しても、詰める前と同じ順位になる", () => {
    const view = asIndex(opened, ix.ids);
    for (const d of docs) {
      const a = search(ix, d.text, { topK: 4 });
      const b = search(view, d.text, { topK: 4 });
      expect(b.map((h) => h.id), d.id).toEqual(a.map((h) => h.id));
      expect(b.map((h) => h.score)).toEqual(a.map((h) => h.score));
    }
  });
});

describe("meta と本文の位置", () => {
  it("T-908 id を組み立て直すと元に戻る", () => {
    const meta = {
      laws: [{ id: "129AC0000000089", title: "民法" }, { id: "140AC0000000045", title: "刑法" }],
      chunks: [[0, "1", "1"], [0, "4_2", "2"], [1, "199", "1"]],
    };
    expect(rebuildIds(meta)).toEqual([
      "129AC0000000089#1-1",
      "129AC0000000089#4_2-2",
      "140AC0000000045#199-1",
    ]);
  });

  it("T-909 本文の範囲は隙間なく連続し、Range の終端は閉区間", () => {
    const offsets = Uint32Array.from([0, 10, 25, 25, 40]);
    expect(textRange(offsets, 0)).toEqual({ start: 0, end: 9, length: 10 });
    expect(textRange(offsets, 1)).toEqual({ start: 10, end: 24, length: 15 });
    // 長さ 0 の節(あり得る)。end < start になるので、呼ぶ側が length で判断する
    expect(textRange(offsets, 2).length).toBe(0);
    expect(textRange(offsets, 3)).toEqual({ start: 25, end: 39, length: 15 });
  });
});

// --- 実データでの G-13。生成物が無ければスキップ ---
const packedDir = new URL("../public/tenkyo/index/", import.meta.url);
const built = existsSync(new URL("postings.bin", packedDir)) && existsSync(new URL("../data/chunks.json", import.meta.url));

describe.skipIf(!built)("G-13 詰めた索引の照合(実データ)", () => {
  const { chunks } = JSON.parse(readFileSync(new URL("../data/chunks.json", import.meta.url), "utf8"));
  const { items } = JSON.parse(readFileSync(new URL("../data/oracle.json", import.meta.url), "utf8"));
  const rd = (n) => readFileSync(new URL(n, packedDir));
  const meta = JSON.parse(rd("meta.json").toString("utf8"));
  const sparseMeta = JSON.parse(rd("sparse-meta.json").toString("utf8"));
  const quant = JSON.parse(rd("quant.json").toString("utf8"));

  it("T-910 meta.json から組み立てた id が、詰める前と完全一致する", () => {
    const ids = rebuildIds(meta);
    expect(ids.length).toBe(chunks.length);
    const bad = ids.filter((id, i) => id !== chunks[i].id);
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it("T-911 詰めた疎索引の検索が、詰める前と完全一致する(200 問)", () => {
    const ix = buildIndex(chunks.map((c) => ({ id: c.id, text: c.indexText })));
    const b = rd("terms.bin");
    const o = rd("postings-offsets.bin");
    const opened = openPackedSparse({
      terms: new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2),
      postings: new Uint8Array(rd("postings.bin")),
      offsets: new Uint32Array(o.buffer, o.byteOffset, o.byteLength / 4),
      meta: sparseMeta,
      dl: (() => {
        const d = rd("dl.bin");
        return new Uint16Array(d.buffer, d.byteOffset, d.byteLength / 2);
      })(),
    });
    expect(opened.termIndex.size).toBe(sparseMeta.termCount);
    const view = asIndex(opened, chunks.map((c) => c.id));
    const step = Math.max(1, Math.floor(items.length / 200));
    const bad = [];
    for (let i = 0; i < items.length; i += step) {
      const ex = new Set(items[i].excludeFromResults);
      const a = search(ix, items[i].query, { topK: 20, exclude: ex });
      const c = search(view, items[i].query, { topK: 20, exclude: ex });
      if (a.map((h) => h.id).join("") !== c.map((h) => h.id).join("")) bad.push(items[i].id);
    }
    expect(bad).toEqual([]);
  });

  it("T-912 詰めた密索引(int8)の検索が、data/index のものと完全一致する", () => {
    const packedVec = new Int8Array(rd("vec_i8.bin").buffer.slice(0));
    const src = readFileSync(new URL("../data/index/vec_i8.bin", import.meta.url));
    const srcVec = new Int8Array(src.buffer, src.byteOffset, src.byteLength);
    expect(packedVec.length).toBe(srcVec.length);
    // 全バイトが一致すること(丸ごと比較)
    let diff = 0;
    for (let i = 0; i < srcVec.length; i++) if (packedVec[i] !== srcVec[i]) diff += 1;
    expect(diff).toBe(0);
    expect(quant.dims).toBe(384);
    expect(quant.count).toBe(chunks.length);
    expect(quant.mu.length).toBe(384);
    expect(quant.s.length).toBe(384);
  });

  it("T-913 量子化の変換表が、いま計算し直したものと一致する", () => {
    const bin = readFileSync(new URL("../data/index/vec_f32.bin", import.meta.url));
    const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
    const fit = fitQuantizer(vecs, 384, chunks.length);
    expect([...fit.mu]).toEqual(quant.mu);
    expect([...fit.s]).toEqual(quant.s);
    // 量子化し直しても同じバイト列になる(丸めの向きが固定されていることの確認)
    const q8 = quantize(vecs, 384, chunks.length, fit);
    const src = readFileSync(new URL("../data/index/vec_i8.bin", import.meta.url));
    const srcVec = new Int8Array(src.buffer, src.byteOffset, src.byteLength);
    let diff = 0;
    for (let i = 0; i < q8.length; i++) if (q8[i] !== srcVec[i]) diff += 1;
    expect(diff).toBe(0);
    // 検索も一致する
    const ids = chunks.map((c) => c.id);
    const qbin = readFileSync(new URL("../data/index/query_f32.bin", import.meta.url));
    const qvecs = new Float32Array(qbin.buffer, qbin.byteOffset, qbin.byteLength / 4);
    const q = qvecs.subarray(0, 384);
    const a = searchQuantized(q8, 384, ids, foldQuery(q, 384, fit), { topK: 10 });
    const c = searchQuantized(srcVec, 384, ids, foldQuery(q, 384, fit), { topK: 10 });
    expect(c.map((h) => h.id)).toEqual(a.map((h) => h.id));
    // 陽性対照: そもそも密検索が動いていること
    expect(searchDense(vecs, 384, ids, q, { topK: 1 })[0].score).toBeGreaterThan(0.5);
  });

  it("T-914 本文の位置表が、実ファイルの大きさと合う", () => {
    const o = rd("text-offsets.bin");
    const offsets = new Uint32Array(o.buffer, o.byteOffset, o.byteLength / 4);
    expect(offsets.length).toBe(chunks.length + 1);
    expect(offsets[0]).toBe(0);
    expect(offsets[chunks.length]).toBe(rd("text.bin").length);
    // 単調非減少であること(隙間も重なりも無い)
    let bad = 0;
    for (let i = 1; i < offsets.length; i++) if (offsets[i] < offsets[i - 1]) bad += 1;
    expect(bad).toBe(0);
  });

  it("T-915 Range で切り出した一節が、詰める前の本文と一致する", () => {
    const text = rd("text.bin");
    const o = rd("text-offsets.bin");
    const offsets = new Uint32Array(o.buffer, o.byteOffset, o.byteLength / 4);
    const step = Math.max(1, Math.floor(chunks.length / 300));
    const bad = [];
    for (let i = 0; i < chunks.length; i += step) {
      const r = textRange(offsets, i);
      const got = JSON.parse(text.subarray(r.start, r.start + r.length).toString("utf8"));
      if (got.t !== chunks[i].text || got.c !== chunks[i].caption) bad.push(chunks[i].id);
    }
    expect(bad).toEqual([]);
  });
});
