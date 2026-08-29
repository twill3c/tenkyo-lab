import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { parseLaw, kanjiToArticleNum, articleNumToLabel } from "../src/lib/lawparse.mjs";

const mini = JSON.parse(readFileSync(new URL("./fixtures/mini-law.json", import.meta.url), "utf8"));

// 期待値の出所:
//   T-101〜T-106  手作りフィクスチャ tests/fixtures/mini-law.json。
//                 実物(e-Gov 法令 API v2 / 著作権法, 2026-08-29 取得)のタグ構成を写して作成。
//   T-107         実測。2026-08-29 に著作権法 345AC0000000048 を API から取得して数えた値。

describe("parseLaw — 構造の切り出し(F-01 / SPEC §2.1)", () => {
  it("T-101 本則の条だけを採り、附則の条は採らない", () => {
    const law = parseLaw(mini);
    expect(law.articles.map((a) => a.num)).toEqual(["1", "2_3"]);
    // 附則を「黙って捨てない」— 除外件数を記録すること(SPEC §2.2)
    expect(law.excluded.supplProvisionArticles).toBe(1);
  });

  it("T-102 条番号(ArticleTitle)は本文に含めない — 索引に条番号を入れない規律", () => {
    const law = parseLaw(mini);
    const a1 = law.articles[0];
    expect(a1.paragraphs[0].text).toBe("この法律は、見本を定めることを目的とする。");
    expect(a1.paragraphs[0].text).not.toContain("第一条");
    // 見出し(ArticleCaption)は本文とは別のフィールドに持つ
    expect(a1.caption).toBe("目的");
  });

  it("T-103 項は分けて持ち、号は所属する項の本文に連なる", () => {
    const law = parseLaw(mini);
    const a2 = law.articles[1];
    expect(a2.paragraphs.map((p) => p.num)).toEqual(["1", "2"]);
    expect(a2.paragraphs[0].text).toContain("準用する");
    // 第2項の号「第百二十条の二第一号に掲げるもの」が項本文に入っていること
    expect(a2.paragraphs[1].text).toContain("第百二十条の二第一号に掲げるもの");
    // ItemTitle(「一」)は本文に混ぜない
    expect(a2.paragraphs[1].text.startsWith("一")).toBe(false);
  });

  it("T-104 章の見出しを文脈として保持する", () => {
    const law = parseLaw(mini);
    expect(law.articles[0].chapter).toBe("第一章　総則");
  });

  it("T-105 走査対象が空でない(検査そのものが働いていることの確認)", () => {
    const law = parseLaw(mini);
    expect(law.articles.length).toBeGreaterThan(0);
    expect(law.articles.every((a) => a.paragraphs.length > 0)).toBe(true);
    expect(law.title).toBe("見本法");
    expect(law.lawId).toBe("999AC0000000001");
  });
});

describe("条番号の表記変換", () => {
  it("T-106 漢数字の条番号を Num 属性形式へ写す(枝番を含む)", () => {
    // 出所: e-Gov の Article/@Num は「4_2 = 第四条の二」形式。実物で確認(2026-08-29)
    expect(kanjiToArticleNum("第一条")).toBe("1");
    expect(kanjiToArticleNum("第十七条")).toBe("17");
    expect(kanjiToArticleNum("第四条の二")).toBe("4_2");
    expect(kanjiToArticleNum("第百二十条の二")).toBe("120_2");
    expect(articleNumToLabel("120_2")).toBe("第百二十条の二");
    expect(articleNumToLabel("17")).toBe("第十七条");
  });
});

describe("実データに対する煙試験(データ未取得ならスキップ)", () => {
  const raw = new URL("../data/raw/345AC0000000048.json", import.meta.url);
  const has = existsSync(raw);

  it.skipIf(!has)("T-107 著作権法の本則条数・附則条数が実測値と一致する", () => {
    // 出所: 実測。2026-08-29 に API v2 から取得して数えた値(data/PROVENANCE.md)
    const law = parseLaw(JSON.parse(readFileSync(raw, "utf8")));
    expect(law.articles.length).toBe(239);
    expect(law.excluded.supplProvisionArticles).toBe(150);
    // 本文に条番号が混じっていないこと(T-102 の実データ版)
    const withTitle = law.articles.filter((a) =>
      a.paragraphs.some((p) => p.text.startsWith(articleNumToLabel(a.num)))
    );
    expect(withTitle).toEqual([]);
  });
});
