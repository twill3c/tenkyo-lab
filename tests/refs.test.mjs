import { describe, it, expect } from "vitest";
import { extractRefs, countRelativeRefs, maskRefs } from "../src/lib/refs.mjs";

// 期待値の出所:
//   すべて手作りの文字列。実物(著作権法・2026-08-29)に現れた表現を写して作った。
//   写した箇所は各ケースにコメントで示す。
//
// HC-041: 検出系のテストには陽性対照と陰性対照を対で置く。
//   陽性 = 必ず捕まえるべき既知の参照表現
//   陰性 = 撃ってはならない表現(自己参照・相対参照・条番号でない漢数字)

describe("extractRefs — 絶対参照の抽出(SPEC §2.2)", () => {
  it("T-201 陽性対照: 実物に現れる参照表現をすべて捕まえる", () => {
    const cases = [
      // 左: 実物(著作権法)に現れる形 / 右: 期待する解決結果
      ["第十七条第一項に規定する著作者人格権", { article: "17", paragraph: "1" }],
      ["第八十九条第六項に規定する著作隣接権", { article: "89", paragraph: "6" }],
      ["第三十条第一項第二号の規定により", { article: "30", paragraph: "1", item: "2" }],
      ["第百十三条第七項の場合", { article: "113", paragraph: "7" }],
      ["第百二十条の二第一号に掲げるもの", { article: "120_2", item: "1" }],
      ["第四条の二の規定にかかわらず", { article: "4_2" }],
      ["第二条の規定は適用しない", { article: "2" }],
    ];
    for (const [text, want] of cases) {
      const refs = extractRefs(text);
      expect(refs, `捕まえられなかった: ${text}`).toHaveLength(1);
      expect(refs[0].article, text).toBe(want.article);
      expect(refs[0].paragraph, text).toBe(want.paragraph ?? null);
      expect(refs[0].item, text).toBe(want.item ?? null);
    }
  });

  it("T-202 陰性対照: 撃ってはならない表現で 1 件も拾わない", () => {
    const cases = [
      // 条番号そのもの(ArticleTitle)。構造上は本文外だが、関数単体でも撃たないこと
      "第一条",
      // 相対参照 — 解決対象外(SPEC §2.2 で除外と定めた)
      "前条の場合について準用する。",
      "前項の規定により準用する。",
      "次条に定めるところによる。",
      "同条第二項の例による。",
      // 条番号でない漢数字
      "次の各号に掲げる用語の意義は、当該各号に定めるところによる。",
      "三年以下の拘禁刑に処する。",
      // 他の法令への参照(法令名を伴う)— 本ループの射程外
      "民法（明治二十九年法律第八十九号）第七百九条の規定",
    ];
    for (const text of cases) {
      expect(extractRefs(text), `誤って拾った: ${text}`).toEqual([]);
    }
  });

  it("T-203 一文に複数の参照があればすべて拾い、出現順に並ぶ", () => {
    // 実物(著作権法 第二条第一項第二十三号)に現れる形を写した
    const text =
      "第十七条第一項に規定する著作者人格権若しくは著作権、出版権又は第八十九条第一項に規定する実演家人格権";
    const refs = extractRefs(text);
    expect(refs.map((r) => r.article)).toEqual(["17", "89"]);
    expect(refs[0].start).toBeLessThan(refs[1].start);
  });

  it("T-204 拾った範囲は原文の該当部分と一致する(位置がずれていない)", () => {
    const text = "第百二十条の二第一号に掲げるものを除く。";
    const [r] = extractRefs(text);
    expect(text.slice(r.start, r.end)).toBe(r.raw);
    expect(r.raw).toBe("第百二十条の二第一号");
  });
});

describe("countRelativeRefs — 除外の計上(SPEC §2.2「黙って捨てない」)", () => {
  it("T-205 相対参照を種類ごとに数える", () => {
    const text = "前条の規定は、前項及び次条について準用する。同条第二項の例による。";
    const c = countRelativeRefs(text);
    expect(c.前条).toBe(1);
    expect(c.前項).toBe(1);
    expect(c.次条).toBe(1);
    expect(c.同条).toBe(1);
  });

  it("T-206 陰性対照: 相対参照が無い文では 0 件になる", () => {
    const c = countRelativeRefs("第十七条第一項の規定による。");
    expect(Object.values(c).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("maskRefs — クエリから参照文字列を除去する(循環の禁止)", () => {
  it("T-207 参照文字列だけが消え、他は 1 文字も変わらない", () => {
    const text = "第十七条第一項に規定する著作者人格権は、譲渡することができない。";
    const masked = maskRefs(text);
    expect(masked).toBe("に規定する著作者人格権は、譲渡することができない。");
  });

  it("T-208 複数参照でも位置ずれを起こさない(後ろから消す)", () => {
    const text = "第十七条第一項及び第八十九条第一項に規定する権利";
    expect(maskRefs(text)).toBe("及びに規定する権利");
  });

  it("T-209 陽性対照: 除去後の文に条番号表現が 1 つも残らない", () => {
    const text = "第三十条第一項第二号の規定により第百二十条の二第一号の適用を受ける。";
    const masked = maskRefs(text);
    expect(extractRefs(masked)).toEqual([]);
    expect(masked).not.toMatch(/第[一二三四五六七八九十百千]+条/);
  });

  it("T-210 陰性対照: 参照を含まない文は 1 文字も変わらない", () => {
    const text = "この法律は、見本を定めることを目的とする。";
    expect(maskRefs(text)).toBe(text);
  });
});
