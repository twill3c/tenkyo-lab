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

  // 陰性対照として非日本語を**意図的に**置く行がある(刈り込みの範囲外を示すため)。
  // ファイル単位で除外すると緩すぎるので、**行単位のマーカー**にする。
  // そして「マーカーが実際に必要な行にだけ付いているか」を対で検査する(AGENTS.md の規範)。
  const ALLOW = "text-hygiene:allow-foreign";

  function scanSources() {
    const dirs = ["src/lib", "scripts"];
    const files = [];
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => x.endsWith(".mjs"))) files.push(`${d}/${f}`);
    }
    return files;
  }

  it("T-704b ソースに同形異字が混入していない(マーカー行を除く)", () => {
    const bad = [];
    const files = scanSources();
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.includes(ALLOW)) return;
        if (CYRILLIC.test(line)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(files.length).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("T-704c 緩みすぎ止め: 除外マーカーは、実際に非日本語を含む行にだけ付いている", () => {
    const useless = [];
    let markers = 0;
    for (const f of scanSources()) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!line.includes(ALLOW)) return;
          markers += 1;
          // マーカーを剥がした残りに、本当にキリル文字があるか
          if (!CYRILLIC.test(line.replace(ALLOW, ""))) useless.push(`${f}:${i + 1}`);
        });
    }
    // マーカーが 1 つも無ければ、この検査は何も見張っていない
    expect(markers, "除外マーカーが 1 つも無い — T-704b が働いているか疑わしい").toBeGreaterThan(0);
    expect(useless, "不要な除外マーカーが付いている").toEqual([]);
  });

  it("T-705 コーパス本文に混入していない(データ未取得ならスキップ)", () => {
    if (!existsSync("data/chunks.json")) return;
    const { chunks } = JSON.parse(readFileSync("data/chunks.json", "utf8"));
    expect(chunks.length).toBeGreaterThan(0);
    const bad = chunks.filter((c) => CYRILLIC.test(c.indexText) || GREEK.test(c.indexText));
    expect(bad.map((c) => c.id)).toEqual([]);
  });

  it("T-707 陽性対照: 制御文字の検出器は既知の悪い例を捕まえ、正当な空白を撃たない", () => {
    const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;
    // **悪い例は必ずエスケープ表記で組み立てる。** リテラルで書くと、
    // このファイル自身が T-708 の走査に引っかかる(loop_003 で実際にそうなった)
    const SOH = String.fromCharCode(1);
    expect(CTRL.test(`join("${SOH}")`)).toBe(true); // loop_003 で実際に混入した形
    expect(CTRL.test(`a${String.fromCharCode(0)}b`)).toBe(true);
    // 陰性対照: 改行・タブ・全角空白は正当
    expect(CTRL.test("a\nb\tc　d")).toBe(false);
  });

  it("T-708 ソースに制御文字が混入していない", () => {
    // loop_003: dump-ranks.mjs の join("") に U+0001 が紛れ、G-04 が偽の不一致を出した。
    // **ソースを開いても検索しても見えない**(cat -A で ^A として初めて見える)。
    // 構文エラーにならないので、テストで見張るしかない(HC-042)
    const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
    const dirs = ["src/lib", "scripts", "tests", "harness/reference"];
    const bad = [];
    let scanned = 0;
    for (const d of dirs) {
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => /\.(mjs|py|json)$/.test(x))) {
        scanned += 1;
        const t = readFileSync(`${d}/${f}`, "utf8");
        for (const m of t.matchAll(CTRL)) {
          const line = t.slice(0, m.index).split("\n").length;
          bad.push(`${d}/${f}:${line} U+${m[0].codePointAt(0).toString(16).padStart(4, "0")}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("T-706 陰性対照の一覧には、意図した非日本語が実在する", () => {
    // 陰性対照が全部日本語になっていたら、陰性対照として働いていない
    const neg = JSON.parse(readFileSync("data/negatives.json", "utf8"));
    expect(neg.length).toBeGreaterThan(10);
    expect(neg.some((s) => CYRILLIC.test(s)), "キリル文字の陰性対照が無い").toBe(true);
    expect(neg.some((s) => /^[\x20-\x7E]+$/.test(s)), "ラテン文字だけの陰性対照が無い").toBe(true);
  });
});
