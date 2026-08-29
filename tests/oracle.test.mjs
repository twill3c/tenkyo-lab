import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { extractRefs } from "../src/lib/refs.mjs";
import {
  buildOracle,
  splitSentences,
  substantiveLength,
  bigrams,
  distinctiveCount,
} from "../scripts/build-oracle.mjs";

// 期待値の出所:
//   T-301〜T-306  不変量。件数ではなく「集合の一致・取りこぼしの不在」で書く(TEST_SPEC)。
//                 生成物が無ければスキップする(data/ は .gitignore 済み。npm run chunks && npm run oracle で作る)
//   T-307〜T-309  手作りの文字列。

const chunksPath = new URL("../data/chunks.json", import.meta.url);
const oraclePath = new URL("../data/oracle.json", import.meta.url);
const built = existsSync(chunksPath) && existsSync(oraclePath);

describe.skipIf(!built)("オラクルの不変量(SPEC §2.2)", () => {
  const { chunks } = JSON.parse(readFileSync(chunksPath, "utf8"));
  const { items } = JSON.parse(readFileSync(oraclePath, "utf8"));
  const byId = new Map(chunks.map((c) => [c.id, c]));

  it("T-301 走査対象が空でない", () => {
    expect(chunks.length).toBeGreaterThan(0);
    expect(items.length).toBeGreaterThan(0);
  });

  it("T-302 循環の禁止1: クエリに条番号表現が 1 つも残っていない", () => {
    const leaked = items.filter((i) => extractRefs(i.query, { includeExternal: true }).length > 0);
    expect(leaked.map((i) => i.id)).toEqual([]);
  });

  it("T-303 循環の禁止2: 出題元は必ず結果から除外される指定がある", () => {
    const missing = items.filter((i) => !i.excludeFromResults?.includes(i.sourceChunkId));
    expect(missing.map((i) => i.id)).toEqual([]);
  });

  it("T-304 循環の禁止3: 正解に出題元が混ざっていない", () => {
    const bad = items.filter((i) => i.gold.includes(i.sourceChunkId));
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it("T-305 正解はすべて索引に実在する", () => {
    const dangling = items.flatMap((i) => i.gold.filter((g) => !byId.has(g)));
    expect(dangling).toEqual([]);
  });

  it("T-306 正解は同一法令内を指す(他法令参照が紛れていない)", () => {
    const cross = items.filter((i) => i.gold.some((g) => byId.get(g).lawId !== i.lawId));
    expect(cross.map((i) => i.id)).toEqual([]);
  });

  it("T-307 自条への参照が正解になっていない", () => {
    const self = items.filter((i) => {
      const src = byId.get(i.sourceChunkId);
      return i.gold.some((g) => byId.get(g).articleNum === src.articleNum);
    });
    expect(self.map((i) => i.id)).toEqual([]);
  });
});

describe("生成器の部品", () => {
  it("T-308 文の分割は句点を残し、連結すると元に戻る", () => {
    const t = "第一の文である。第二の文である。";
    expect(splitSentences(t)).toEqual(["第一の文である。", "第二の文である。"]);
    expect(splitSentences(t).join("")).toBe(t);
  });

  it("T-309 実質文字数は記号と括弧を数えない", () => {
    // 出所: G-07 一度目の検分で「実質過短」と判定した実例(2026-08-29)。
    // 期待値 17 は実測(記号 3 文字を除いた残り)。当初 18 と書いて落ちた — 数えずに書いた定数だった
    expect(substantiveLength("）若しくは（において準用する場合を含む。")).toBe(17);
    expect(substantiveLength("あいうえお")).toBe(5);
  });

  it("T-310 バイグラムは記号をまたがない位置で切り出される", () => {
    expect([...bigrams("あい、うえ")]).toEqual(["あい", "いう", "うえ"]);
  });
});

describe("buildOracle の陽性・陰性対照(HC-041)", () => {
  const mk = (lawId, articleNum, paragraphNum, text, caption = null) => ({
    id: `${lawId}#${articleNum}-${paragraphNum}`,
    lawId,
    lawTitle: "見本法",
    articleNum,
    articleLabel: null,
    paragraphNum,
    caption,
    chapter: null,
    section: null,
    text,
    indexText: text,
  });

  // 識別力の判定はコーパス全体の文書頻度に依存する。合成コーパスは小さく、
  // 閾値(件数 × 0.5%)が 1 件台まで下がるため、実データの条件を写せない
  // (13,600 件なら 68 件、302 件なら 1.5 件 — HC-040)。
  // よって DF に依存する判定は df を直接与える単体試験で見る(T-314/T-315)。
  // ここでは DF に依存しない構造フィルタだけを buildOracle 越しに確かめる。

  it("T-311 陽性対照: 識別力のある語を伴う絶対参照は課題になる", () => {
    // 詰め物は判定対象の機能語(規定・準用・場合・掲げる)を共有させる。
    // 共有させないと、それらが「稀な語」に化けて陽性対照が意味を失う
    const filler = Array.from({ length: 300 }, (_, i) =>
      mk("L", `${i + 10}`, "1", "前項の規定は、次の各号に掲げる場合について準用する。一般的な定めである。")
    );
    const chunks = [
      mk("L", "1", "1", "第五条の規定は、統括安全衛生責任者の業務の執行について準用する。"),
      mk("L", "5", "1", "統括安全衛生責任者は、元方安全衛生管理者の指揮をしなければならない。"),
      ...filler,
    ];
    const { items } = buildOracle(chunks);
    expect(items).toHaveLength(1);
    expect(items[0].gold).toEqual(["L#5-1"]);
    expect(items[0].query).not.toContain("第五条");
  });

  it("T-312 陰性対照: 実質文字数が足りない準用規定は課題にならない", () => {
    const chunks = [
      // 長さの下限(20 字)は超えるが、記号を除いた実質(25 字)には届かない文にする。
      // 二つの門を取り違えないため、どちらで落ちたかを名指しで確かめる
      mk("L", "1", "1", "第五条の規定は、前項の場合について準用するものとする。"),
      mk("L", "5", "1", "内容のある条文であって、相当の理由があるときに適用される。"),
    ];
    const { items, excluded } = buildOracle(chunks);
    expect(items).toEqual([]);
    expect(excluded.queryTooShort).toBe(0);
    expect(excluded.notSubstantive).toBe(1);
  });

  it("T-314 識別力の判定は文書頻度そのものを与えて確かめる", () => {
    // 出所: 実データ(13,600 チャンク)での判定条件を、df を直接与えて再現する。
    // 閾値は総数 × 0.5% = 68 件。これ以下にしか現れないバイグラムを識別力ありとする
    const total = 13600;
    const common = 5000; // どこにでもある語
    const rare = 10; // 稀な語
    const df = new Map();
    for (const g of bigrams("の規定は、前項第一号及び第二号に掲げる場合について準用する。")) df.set(g, common);
    for (const g of bigrams("統括安全衛生責任者")) df.set(g, rare);

    // 機能語だけの文 → 識別力 0
    expect(distinctiveCount("の規定は、前項第一号及び第二号に掲げる場合について準用する。", df, total)).toBe(0);
    // 稀な語を含む文 → 識別力あり
    expect(
      distinctiveCount("の規定は、統括安全衛生責任者について準用する。", df, total)
    ).toBeGreaterThanOrEqual(3);
  });

  it("T-315 陰性対照: 未知のバイグラムは df 0 として識別力ありに数える", () => {
    // df に無い語は「どこにも出てこない＝最も稀」であって、見落としではない。
    // ここを 0 件扱いにすると、新語を含むクエリが黙って捨てられる
    expect(distinctiveCount("あいうえおかきくけこ", new Map(), 13600)).toBeGreaterThan(0);
  });

  it("T-313 陰性対照: 列挙条文は参照件数と被覆率で落ちる", () => {
    const chunks = [
      mk("L", "1", "1", "第五条、第六条、第七条、第八条又は第九条の規定に違反した者は、罰する。"),
      mk("L", "5", "1", "内容のある条文である。"),
      mk("L", "6", "1", "内容のある条文である。"),
      mk("L", "7", "1", "内容のある条文である。"),
      mk("L", "8", "1", "内容のある条文である。"),
      mk("L", "9", "1", "内容のある条文である。"),
    ];
    const { items, excluded } = buildOracle(chunks);
    expect(items).toEqual([]);
    expect(excluded.tooManyRefs + excluded.refCoverageTooHigh).toBeGreaterThan(0);
  });
});
