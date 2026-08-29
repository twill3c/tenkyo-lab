import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";

// N-07 文字種検査。
//
// 日本語本文にキリル文字などの同形異字が混ざると、字形が似ていて目視では気づけない
// (フリート横断の既知の故障 — senoto-mori の text-hygiene が雛形)。
// **検出系なので陽性対照を対で置く**(HC-041)。パターン自身が壊れていないことを確かめる。

const CYRILLIC = /[Ѐ-ӿ]/;
const GREEK = /[Ͱ-Ͽ]/;
// 全角ラテン英字。法令本文には現れない
const FULLWIDTH_LATIN = /[Ａ-Ｚａ-ｚ]/;

describe("N-07 文字種検査", () => {
  it("T-701 陽性対照: 検査器は既知の悪い例を必ず捕まえる", () => {
    // а は U+0430(キリル)。a(U+0061)ではない
    expect(CYRILLIC.test("これはキリルのаです")).toBe(true);
    expect(GREEK.test("これはギリシャのοです")).toBe(true);
    expect(FULLWIDTH_LATIN.test("これは全角のＡです")).toBe(true);
  });

  it("T-702 陰性対照: 正当な日本語・半角英数を撃たない", () => {
    for (const s of ["第十七条第一項の規定", "ISO 8601 形式", "PDL1.0", "e-Gov 法令検索"]) {
      expect(CYRILLIC.test(s), s).toBe(false);
      expect(GREEK.test(s), s).toBe(false);
      expect(FULLWIDTH_LATIN.test(s), s).toBe(false);
    }
  });

  // 検査の射程を対象で分ける。
  //   文書・ソース … 数式記号(MMR の λ、量子化の μ / s)を**正当に**使う。
  //                  ここでギリシャ文字を一律に撃つと、正しい記述を混入と報告する
  //   コーパス本文 … 法令の条文に数式記号は現れない。ギリシャ文字も撃ってよい
  // 実害のある同形異字はキリルであり(フリート横断の既知の故障)、これはどこでも撃つ。

  it("T-703 陰性対照: 数式記号は文書での混入としない", () => {
    expect(CYRILLIC.test("MMR の λ を 0.5 とする")).toBe(false);
    expect(CYRILLIC.test("次元ごとの中心 μ と幅 s")).toBe(false);
  });

  it("T-704 プロジェクトの文書に同形異字が混入していない", () => {
    const files = ["SPEC.md", "TEST_SPEC.md", "data/PROVENANCE.md", "AGENTS.md"];
    const scanned = [];
    const bad = [];
    for (const f of files) {
      if (!existsSync(f)) continue;
      scanned.push(f);
      const t = readFileSync(f, "utf8");
      for (const [name, re] of [["キリル", CYRILLIC], ["全角ラテン", FULLWIDTH_LATIN]]) {
        const m = re.exec(t);
        if (m) bad.push(`${f}: ${name} ${JSON.stringify(m[0])} at ${m.index}`);
      }
    }
    // 走査対象が空でないことを別ケースで確かめる(検査が働いていることの確認)
    expect(scanned.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("T-704b ソースに同形異字が混入していない", () => {
    const dirs = ["src/lib", "scripts"];
    const bad = [];
    let scanned = 0;
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".mjs"))) {
        scanned += 1;
        const t = readFileSync(`${d}/${f}`, "utf8");
        const m = CYRILLIC.exec(t);
        if (m) bad.push(`${d}/${f}: ${JSON.stringify(m[0])} at ${m.index}`);
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("T-705 コーパス本文に混入していない(データ未取得ならスキップ)", () => {
    if (!existsSync("data/chunks.json")) return;
    const { chunks } = JSON.parse(readFileSync("data/chunks.json", "utf8"));
    expect(chunks.length).toBeGreaterThan(0);
    const bad = chunks.filter((c) => CYRILLIC.test(c.indexText) || GREEK.test(c.indexText));
    expect(bad.map((c) => c.id)).toEqual([]);
  });

  it("T-706 陰性対照の一覧には、意図した非日本語が実在する", () => {
    // 陰性対照が全部日本語になっていたら、陰性対照として働いていない
    const neg = JSON.parse(readFileSync("data/negatives.json", "utf8"));
    expect(neg.length).toBeGreaterThan(10);
    expect(neg.some((s) => CYRILLIC.test(s)), "キリル文字の陰性対照が無い").toBe(true);
    expect(neg.some((s) => /^[\x20-\x7E]+$/.test(s)), "ラテン文字だけの陰性対照が無い").toBe(true);
  });
});
