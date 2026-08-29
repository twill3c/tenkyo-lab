import { describe, it, expect } from "vitest";
import { buildIndex, search, idf } from "../src/lib/bm25.mjs";

// 期待値の出所:
//   すべて手作りの小さな文書集合。BM25 は閾値を持たず順位だけを返すので、
//   期待値は「順位の大小関係」で書く。絶対値の定数は書かない。
//   HC-057: BM25 の判定はデータ量に依存しないため、合成フィクスチャで確かめてよい。

const docs = [
  { id: "a", text: "根抵当権の共有者は、他の共有者の同意を得てその権利を譲り渡すことができる。" },
  { id: "b", text: "統括安全衛生責任者は、元方安全衛生管理者の指揮をしなければならない。" },
  { id: "c", text: "使用者は、労働者に、休憩時間を与えなければならない。" },
  { id: "d", text: "根抵当権の元本の確定前においては、根抵当権者は、これを譲り渡すことができる。" },
];

describe("BM25(文字バイグラム)", () => {
  const ix = buildIndex(docs);

  it("T-401 走査対象が空でない", () => {
    expect(ix.N).toBe(4);
    expect(ix.postings.size).toBeGreaterThan(0);
    expect(ix.avgdl).toBeGreaterThan(0);
  });

  it("T-402 陽性対照: 文書そのものを問うとその文書が 1 位(G-03 の核)", () => {
    for (const d of docs) {
      const hits = search(ix, d.text, { topK: 4 });
      expect(hits[0]?.id, `${d.id} が 1 位でない`).toBe(d.id);
    }
  });

  it("T-403 陰性対照: バイグラムを 1 つも共有しないクエリは 1 件も返らない", () => {
    expect(search(ix, "Lorem ipsum dolor", { topK: 4 })).toEqual([]);
    expect(search(ix, "", { topK: 4 })).toEqual([]);
  });

  it("T-404 主題が近い文書が上位に来る", () => {
    const hits = search(ix, "根抵当権を譲り渡すこと", { topK: 4 });
    expect(hits.map((h) => h.id).slice(0, 2).sort()).toEqual(["a", "d"]);
  });

  it("T-405 全文書に現れる語の IDF は、一部にしか現れない語より小さい", () => {
    // 「者は」は 4 文書すべてに現れる。「根抵」は 2 文書
    expect(idf(ix, "者は")).toBeLessThan(idf(ix, "根抵"));
    expect(idf(ix, "統括")).toBeGreaterThan(idf(ix, "根抵"));
  });

  it("T-406 陰性対照: 索引に無い語の IDF は最大側に倒れ、例外にならない", () => {
    expect(Number.isFinite(idf(ix, "ゑひ"))).toBe(true);
    expect(idf(ix, "ゑひ")).toBeGreaterThan(idf(ix, "者は"));
  });

  it("T-407 長さ正規化: 同じ語を同じ回数含むなら、短い文書が上に来る", () => {
    const two = [
      { id: "short", text: "特別清算の手続" },
      { id: "long", text: "特別清算の手続その他これに準ずる一切の手続に関する詳細な定めであって、必要な事項を含むもの" },
    ];
    const ix2 = buildIndex(two);
    const hits = search(ix2, "特別清算", { topK: 2 });
    expect(hits[0].id).toBe("short");
  });

  it("T-409 本文が完全に重複する文書は同点になり、順位は id で決まる", () => {
    // 実データに本文重複が 439 件ある(「削除」だけで 71 件)。
    // このとき「その文書自身が 1 位」は原理的に満たせない —— G-03 の対照を
    // 「同一本文の文書が 1 位」と書き直した根拠(loop_002 / SPEC-GAP)
    const dup = [
      { id: "z-dup", text: "第八十二条第三項の規定は、前項の請求についてこれを準用する。" },
      { id: "a-dup", text: "第八十二条第三項の規定は、前項の請求についてこれを準用する。" },
      { id: "other", text: "全く別の内容を定める条文である。" },
    ];
    const ixd = buildIndex(dup);
    const hits = search(ixd, dup[0].text, { topK: 3 });
    expect(hits[0].score).toBe(hits[1].score); // ビット一致であること
    expect(hits[0].id).toBe("a-dup"); // 同点は id の昇順
    // 「自分自身が 1 位」では落ちるが、「同一本文が 1 位」では通る
    const textOf = new Map(dup.map((d) => [d.id, d.text]));
    expect(hits[0].id).not.toBe("z-dup");
    expect(textOf.get(hits[0].id)).toBe(dup[0].text);
  });

  it("T-408 除外指定した文書は結果に現れない(循環の禁止2)", () => {
    const hits = search(ix, docs[0].text, { topK: 4, exclude: new Set(["a"]) });
    expect(hits.map((h) => h.id)).not.toContain("a");
    expect(hits.length).toBeGreaterThan(0);
  });
});
