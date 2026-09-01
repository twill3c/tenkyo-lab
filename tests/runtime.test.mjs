import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// 組み上がった束に対する検査。
//
// next.config.ts は onnxruntime-web を **非 jsep 版**へ寄せている。
// 控えとして jsep 版を置く手は採らない —— 置けば、寄せ替えが壊れたときに
// 黙って倍の量(24.89MB 対 12.34MB)が配られる。置かないので、
// **壊れたことをこの検査で知る**。
//
// ビルド成果物が無ければスキップする(npm run build で作る)。

const OUT = "out";
const built = existsSync(OUT);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe.skipIf(!built)("組み上がった束(実行系の寄せ替え)", () => {
  const files = walk(OUT);

  it("T-1001 走査対象が空でない(検査が働いていることの確認)", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => f.endsWith(".html"))).toBe(true);
    expect(files.some((f) => f.endsWith(".js"))).toBe(true);
  });

  it("T-1002 jsep(WebGPU)版の wasm が出荷物に入っていない", () => {
    const jsep = files.filter((f) => /jsep|webgpu/i.test(f));
    expect(jsep).toEqual([]);
  });

  it("T-1003 同梱した wasm は非 jsep 版ひとつだけ", () => {
    const wasm = files.filter((f) => f.endsWith(".wasm"));
    expect(wasm.map((f) => f.replace(/\\/g, "/"))).toEqual(["out/tenkyo/ort/ort-wasm-simd-threaded.wasm"]);
    // 12MB 台であること(jsep 版なら 24MB 台になる)
    const mb = statSync(wasm[0]).size / 1048576;
    expect(mb).toBeGreaterThan(8);
    expect(mb).toBeLessThan(20);
  });

  it("T-1004 束の中に wasm を base64 で抱き込んでいない", () => {
    // 抱き込むと JS が数 MB に膨らむ。配布量の規律(N-04)と衝突する
    const big = files.filter((f) => f.endsWith(".js") && statSync(f).size > 2 * 1048576);
    expect(big).toEqual([]);
  });

  it("T-1005 束に現れる外部ホストが、既知の一覧と一致する(N-02)", () => {
    // **文字列の存在は通信ではない。** transformers.js と onnxruntime-web は
    // 予備の取得先や、エラー文中の参考 URL を文字列として持つ。それを一律に
    // 違反とすると、正当な出荷物を落としてしまう(loop_002 の λ と同じ形)。
    //
    // だから「無いこと」ではなく「**増えていないこと**」を見張る。
    // 新しいホストが入ったら落ちる。実際に通信しないことは、
    // 実ブラウザ検品(scripts/inspect-browser.mjs)が別に確かめる。
    const KNOWN = {
      "cdn.jsdelivr.net": "onnxruntime-web が wasmPaths 未設定のときに使う予備。engine.ts が必ず設定し、無ければ例外で落とす",
      "huggingface.co": "transformers.js の模型取得先。engine.ts が allowRemoteModels=false にする",
      "developer.mozilla.org": "参考 URL(エラー文)",
      "gist.github.com": "参考 URL(エラー文)",
      "github.com": "参考 URL(エラー文)",
      "nextjs.org": "参考 URL(エラー文)",
      "react.dev": "参考 URL(エラー文)",
      "web.dev": "参考 URL(エラー文)",
      "www.w3.org": "SVG などの名前空間 URI",
      // laws.e-gov.go.jp はここには**居ない**。出典表示は layout の静的な本文で、
      // 書き出されるのは HTML と RSC の payload であって .js の束ではない
      // (2026-09-01 実測: out/ の .html 8 件・.txt 6 件にあり、.js には 0 件)。
      // 一覧に残すと「死んだ除外」になり、下の緩みすぎ止めが落ちる。
      // 出典表示そのものは T-1008 が HTML 側で見る。
    };
    const found = new Set();
    for (const f of files.filter((x) => x.endsWith(".js"))) {
      const t = readFileSync(f, "utf8");
      for (const m of t.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/g)) found.add(m[1]);
    }
    expect([...found].sort()).toEqual(Object.keys(KNOWN).sort());
    // 緩みすぎ止め: 一覧に載せたホストが実在すること(死んだ除外を残さない)
    expect(found.size).toBe(Object.keys(KNOWN).length);
  });

  it("T-1006 トップページは索引も模型も参照していない(N-03)", () => {
    const html = readFileSync(join(OUT, "index.html"), "utf8");
    for (const bad of ["vec_i8.bin", "postings.bin", "model_quantized.onnx", "text.bin"]) {
      expect(html.includes(bad), `トップに ${bad} への参照がある`).toBe(false);
    }
  });

  it("T-1007 配布物が出荷物に含まれている", () => {
    for (const f of [
      "tenkyo/index/vec_i8.bin",
      "tenkyo/index/meta.json",
      "tenkyo/index/postings.bin",
      "tenkyo/index/text.bin",
      "tenkyo/model/onnx/model_quantized.onnx",
      "tenkyo/model/tokenizer.json",
    ]) {
      expect(existsSync(join(OUT, f)), `${f} が無い`).toBe(true);
    }
  });
  it("T-1008 全ページに e-Gov の出典と加工の記載がある(PDL1.0)", () => {
    // 公共データ利用規約 1.0 は**出典の記載**と**加工した旨の記載**を義務づける。
    // これまでこの義務は、T-1005 のホスト一覧に載っていたことで**偶然**守られていた。
    // 束の書き出し方が変われば黙って消える置き方だったので、HTML 側に据え直す。
    const pages = files.filter((f) => f.endsWith(".html") && !f.includes("404"));
    expect(pages.length).toBeGreaterThan(0);
    for (const f of pages) {
      const html = readFileSync(f, "utf8");
      expect(html.includes("laws.e-gov.go.jp"), `${f} に出典の URL が無い`).toBe(true);
      expect(html.includes("e-Gov 法令検索"), `${f} に出典の名称が無い`).toBe(true);
      expect(html.includes("加工"), `${f} に加工した旨の記載が無い`).toBe(true);
      expect(
        html.includes("国が作成したものではありません"),
        `${f} に「国が作成したものではない」旨が無い`,
      ).toBe(true);
    }
  });
});
