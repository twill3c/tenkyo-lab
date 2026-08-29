// 実ブラウザ検品。G-11 / G-12 / G-14 と N-02 / N-03 をここで確定する。
//
// **この道具自身が壊れていないかを先に疑う**(HC-055)。
// 取得に失敗した画面を見ても「異常なし」と出るので、
//   - 画面に結果の行が実際に何行出たか
//   - コンソールにエラーが出ていないか
//   - そもそも索引を取りに行ったか
// を明示的に確かめ、**確かめられなかったら異常終了する**。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { createServer } from "./serve-out.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4321;
// 既定は out/ をローカルで配る。--base https://… を渡すと**本番に対して**検品する。
// 「ローカルで通った」は本番の正しさの証拠にならない —— .vercelignore やヘッダ、
// HTTP Range の扱いはローカルのビルドが一切読まない(HC-055)。
const baseArgIdx = process.argv.indexOf("--base");
const REMOTE = baseArgIdx > 0 ? process.argv[baseArgIdx + 1].replace(/\/$/, "") : null;
const BASE = REMOTE ?? `http://127.0.0.1:${PORT}`;
const QUERIES = [
  "根抵当権の共有者が同意を得て権利を譲り渡す",
  "統括安全衛生責任者の業務の執行について準用する",
];
const G11_LIMIT = 50 * 1048576;
const G12_LIMIT = 1048576;

const mb = (n) => (n / 1048576).toFixed(2);

/** Node 側で、**ブラウザと同じ配布物**を使って上位 10 件を出す。 */
async function computeInNode(queries) {
  const { env, pipeline } = await import("@huggingface/transformers");
  const { searchQuantized, foldQuery } = await import("../src/lib/quant.mjs");
  const { rebuildIds } = await import("../src/lib/packed.mjs");
  const IDX = resolve(ROOT, "public/tenkyo/index");
  const meta = JSON.parse(fs.readFileSync(resolve(IDX, "meta.json"), "utf8"));
  const quant = JSON.parse(fs.readFileSync(resolve(IDX, "quant.json"), "utf8"));
  const buf = fs.readFileSync(resolve(IDX, "vec_i8.bin"));
  const q8 = new Int8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const ids = rebuildIds(meta);

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = resolve(ROOT, "public/tenkyo") + "/";
  const ex = await pipeline("feature-extraction", "model", { dtype: "q8" });

  const out = [];
  for (const q of queries) {
    const v = Float32Array.from((await ex("query: " + q, { pooling: "mean", normalize: true })).data);
    const hits = searchQuantized(q8, 384, ids, foldQuery(v, 384, { s: Float64Array.from(quant.s) }), { topK: 10 });
    out.push(hits.map((h) => h.id));
  }
  return out;
}

async function main() {
  const server = REMOTE ? null : createServer();
  if (server) await new Promise((r) => server.listen(PORT, r));
  if (REMOTE) console.log(`本番に対する検品: ${REMOTE}`);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const external = [];
  const requests = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on("request", (r) => {
    const u = r.url();
    requests.push(u);
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
  });

  const report = { queries: [] };

  /**
   * 文字が背景に埋もれていないかを、算出スタイルで確かめる。
   * **DOM に文字があることは、見えていることを確かめない**(loop_006 で白背景に白文字を出荷しかけた)。
   * 相対輝度の差が小さすぎる要素を拾う。
   */
  const contrastCheck = async (pg, selector) =>
    pg.$$eval(selector, (els) => {
      const lum = (c) => {
        const m = c.match(/[\d.]+/g).map(Number);
        const [r, g, b] = m.slice(0, 3).map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const bgOf = (el) => {
        let n = el;
        while (n) {
          const bg = getComputedStyle(n).backgroundColor;
          if (bg && !/rgba?\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
          n = n.parentElement;
        }
        return "rgb(255,255,255)";
      };
      const bad = [];
      for (const el of els) {
        const text = (el.textContent ?? "").trim();
        if (!text) continue;
        const fg = getComputedStyle(el).color;
        const a = lum(fg) + 0.05;
        const b = lum(bgOf(el)) + 0.05;
        const ratio = a > b ? a / b : b / a;
        if (ratio < 3) bad.push({ text: text.slice(0, 18), fg, bg: bgOf(el), ratio: Number(ratio.toFixed(2)) });
      }
      return bad;
    });

  // --- N-03 トップページは索引を 1 バイトも取らない ---
  const r1 = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  if (!r1 || !r1.ok()) throw new Error(`トップページが開けない: ${r1 && r1.status()}`);
  const h1 = await page.textContent("h1");
  if (!h1?.includes("典拠ラボ")) throw new Error(`トップの見出しが違う: ${h1}`);
  const topIndexReqs = requests.filter((u) => /\/tenkyo\/(index|model|ort)\//.test(u));
  report.topPage = { indexRequests: topIndexReqs.length, heading: h1 };
  console.log(`N-03 トップページの索引・模型への取得: ${topIndexReqs.length} 件`);

  // --- 一問目 ---
  await page.goto(`${BASE}/hiku/`, { waitUntil: "networkidle" });
  for (const [n, q] of QUERIES.entries()) {
    const before = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("/tenkyo/"))
        .reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0)
    );
    await page.fill('input[aria-label="質問"]', q);
    await page.click('button.pill:text("10 件")'); // G-14 は上位 10 件で見る
    await page.click("button:not(.pill)");
    await page.waitForSelector('[data-testid="results"] tbody tr', { timeout: 600000 });
    // 「表示されている」ことを別の量でも確かめる(HC-055)
    const rows = await page.$$eval('[data-testid="results"] tbody tr', (els) =>
      els.map((tr) => tr.querySelector("td span.mono")?.textContent?.trim() ?? "")
    );
    const answers = await page.$$('[data-testid="answer-item"]');
    const errBox = await page.$('[data-testid="error"]');
    if (errBox) throw new Error(`画面にエラーが出ている: ${await errBox.textContent()}`);
    if (rows.length === 0 || rows.some((x) => !x)) throw new Error(`結果の行が取れていない: ${JSON.stringify(rows)}`);
    if (answers.length !== rows.length) throw new Error(`回答の件数が結果と合わない ${answers.length} != ${rows.length}`);
    const bodyLen = await page.$$eval('[data-testid="answer-item"] p:last-child', (els) =>
      els.map((e) => (e.textContent ?? "").length)
    );
    if (bodyLen.some((l) => l < 5)) throw new Error(`条文の本文が取れていない: ${JSON.stringify(bodyLen)}`);

    const after = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes("/tenkyo/"))
        .reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0)
    );
    report.queries.push({ query: q, ids: rows, bytes: after - before, cumulative: after, answers: answers.length });
    console.log(`  問い ${n + 1}「${q.slice(0, 20)}…」 上位 ${rows.length} 件 / この問いで ${mb(after - before)} MB`);
  }

  await page.screenshot({ path: resolve(ROOT, "data/hiku.png"), fullPage: true });

  // --- 「測る」ページ(G-15 / つまみが効いているか) ---
  const hakaru = await ctx.newPage();
  const hakaruExternal = [];
  const hakaruIndexReqs = [];
  hakaru.on("request", (r) => {
    const u = r.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) hakaruExternal.push(u);
    if (/\/tenkyo\/(index|model|ort)\//.test(u)) hakaruIndexReqs.push(u);
  });
  hakaru.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(`[hakaru] ${m.text()}`);
  });
  hakaru.on("pageerror", (e) => consoleErrors.push(`[hakaru] pageerror: ${e.message}`));
  await hakaru.goto(`${BASE}/hakaru/`, { waitUntil: "networkidle" });
  await hakaru.waitForSelector('[data-testid="metrics"] tbody tr', { timeout: 120000 });

  const readMetrics = async () =>
    hakaru.$$eval('[data-testid="metrics"] tbody tr', (els) =>
      els.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? ""))
    );
  const at60 = await readMetrics();
  if (at60.length !== 3) throw new Error(`指標の行が 3 行でない: ${at60.length}`);
  // つまみを動かすと数字が動くか(効いていることの確認)
  await hakaru.click('button.pill[aria-pressed="false"]:text-is("10")');
  await hakaru.waitForTimeout(400);
  const at10 = await readMetrics();
  const moved = JSON.stringify(at60) !== JSON.stringify(at10);

  const evalBytes = await hakaru.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => e.name.includes("/tenkyo/eval/"))
      .reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0)
  );
  const perLawRows = await hakaru.$$('[data-testid="perlaw"] tbody tr');
  // 文字が背景に埋もれていないか(両ページ)
  const lowContrast = [
    ...(await contrastCheck(hakaru, "button, a, td, th, p, span, h1, h2, h3")).map((x) => ({ page: "hakaru", ...x })),
    ...(await contrastCheck(page, "button, a, td, th, p, span, h1, h2, h3")).map((x) => ({ page: "hiku", ...x })),
  ];
  report.lowContrast = lowContrast;

  // **陽性対照。** 「0 件」は「検査した」を意味しない(HC-041)。
  // 白背景に白文字の要素をその場で差し込み、検査器が必ず捕まえることを確かめる。
  // 捕まえられなければ検査器が壊れているので、検品全体を落とす。
  await hakaru.evaluate(() => {
    const el = document.createElement("p");
    el.id = "contrast-canary";
    el.textContent = "この文字は見えないはずです";
    el.style.cssText = "color:#fff;background:#fff";
    document.body.appendChild(el);
  });
  const canary = await contrastCheck(hakaru, "#contrast-canary");
  await hakaru.evaluate(() => document.getElementById("contrast-canary")?.remove());
  report.contrastCanary = canary.length;
  console.log(`  文字が埋もれている要素: ${lowContrast.length} 件(陽性対照は ${canary.length} 件で捕捉)`);
  if (lowContrast.length) console.log("   ", JSON.stringify(lowContrast.slice(0, 5)));
  await hakaru.screenshot({ path: resolve(ROOT, "data/hakaru.png"), fullPage: true });
  // --- 静的ページ(索引も模型も取らないことを確かめる) ---
  const staticPages = [];
  for (const path of ["/kiita/", "/tsukurikata/"]) {
    const pg = await ctx.newPage();
    const reqs = [];
    pg.on("request", (r) => reqs.push(r.url()));
    pg.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`[${path}] ${m.text()}`);
    });
    pg.on("pageerror", (e) => consoleErrors.push(`[${path}] pageerror: ${e.message}`));
    const res = await pg.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    if (!res || !res.ok()) throw new Error(`${path} が開けない: ${res && res.status()}`);
    const heading = (await pg.textContent("h1")) ?? "";
    const tables = (await pg.$$("table")).length;
    const heavy = reqs.filter((u) => /\/tenkyo\//.test(u));
    const ext = reqs.filter((u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"));
    const dim = await contrastCheck(pg, "button, a, td, th, p, span, h1, h2, h3, li");
    staticPages.push({ path, heading, tables, heavy: heavy.length, external: ext.length, lowContrast: dim.length });
    if (dim.length) lowContrast.push(...dim.map((x) => ({ page: path, ...x })));
    await pg.close();
  }
  report.staticPages = staticPages;
  for (const s of staticPages) {
    console.log(`  ${s.path} 「${s.heading}」表 ${s.tables} / 配布物への取得 ${s.heavy} 件 / 外部 ${s.external} 件`);
  }

  await hakaru.close();

  report.hakaru = {
    rows: at60,
    knobMoved: moved,
    bytes: evalBytes,
    perLawRows: perLawRows.length,
    indexRequests: hakaruIndexReqs.length,
    external: hakaruExternal.length,
  };
  report.g15 = { bytes: evalBytes, limit: 1.5 * 1048576, pass: evalBytes <= 1.5 * 1048576 };
  console.log(`\n--- 「測る」ページ ---`);
  console.log(`  指標(RRF k=60・上位10): ${at60.map((r) => `${r[0]}=${r[1]}`).join(" / ")}`);
  console.log(`  つまみで数字が動いた: ${moved ? "はい" : "いいえ"}`);
  console.log(`  法令別の行: ${perLawRows.length} / 索引・模型への取得: ${hakaruIndexReqs.length} 件`);
  console.log(`  ${report.g15.pass ? "○" : "×"} G-15 追加取得 ${mb(evalBytes)} MB  上限 1.50 MB`);
  report.consoleErrors = consoleErrors;
  report.external = [...new Set(external)];
  report.g11 = { bytes: report.queries[0].cumulative, limit: G11_LIMIT, pass: report.queries[0].cumulative <= G11_LIMIT };
  report.g12 = { bytes: report.queries[1].bytes, limit: G12_LIMIT, pass: report.queries[1].bytes < G12_LIMIT };

  console.log(`\nN-02 外部オリジンへの通信: ${report.external.length} 件 ${JSON.stringify(report.external)}`);
  console.log(`コンソールのエラー: ${consoleErrors.length} 件`);
  console.log(`${report.g11.pass ? "○" : "×"} G-11 初回一問 ${mb(report.g11.bytes)} MB  上限 ${mb(G11_LIMIT)} MB`);
  console.log(`${report.g12.pass ? "○" : "×"} G-12 二問目   ${(report.g12.bytes / 1024).toFixed(1)} KB  上限 1024 KB`);

  await browser.close();
  if (server) await new Promise((r) => server.close(r));

  // --- G-14 ブラウザと Node が同じ答えを出すか ---
  // **比べるのは同じ配布物どうし**。両側とも public/tenkyo/ の量子化索引と刈った模型を使う。
  // f32 索引や刈る前の模型と比べると、G-05 / G-10 が別に見ている差が混ざる。
  const nodeIds = await computeInNode(QUERIES);
  const g14 = QUERIES.map((q, i) => {
    const b = report.queries[i].ids;
    const n = nodeIds[i];
    const same = b.length === n.length && b.every((x, k) => x === n[k]);
    return { query: q, same, browser: b, node: n, firstDiff: b.findIndex((x, k) => x !== n[k]) };
  });
  report.g14 = { pass: g14.every((x) => x.same), cases: g14 };
  console.log("\n--- G-14 ブラウザ 対 Node(同じ配布物どうし) ---");
  for (const c of g14) {
    console.log(`  ${c.same ? "○" : "×"} ${c.query.slice(0, 24)}…  上位 ${c.browser.length} 件`);
    if (!c.same) {
      console.log(`     ${c.firstDiff + 1} 位から違う  browser=${c.browser[c.firstDiff]}  node=${c.node[c.firstDiff]}`);
    }
  }

  fs.writeFileSync(resolve(ROOT, "data/browser-inspect.json"), JSON.stringify(report, null, 2));

  const fatal = [];
  if (!report.g14.pass) fatal.push("G-14: ブラウザと Node の順位が違う");
  if (!report.g15.pass) fatal.push("G-15 超過");
  if (!report.hakaru.knobMoved) fatal.push("「測る」のつまみを動かしても数字が変わらない");
  if (report.hakaru.indexRequests !== 0) fatal.push("「測る」が索引・模型を取りに行った");
  if (report.hakaru.external !== 0) fatal.push("「測る」が外部オリジンへ通信した");
  if (report.hakaru.perLawRows < 10) fatal.push(`法令別の行が少なすぎる: ${report.hakaru.perLawRows}`);
  for (const s of report.staticPages ?? []) {
    if (s.heavy !== 0) fatal.push(`${s.path} が配布物を取りに行った`);
    if (s.external !== 0) fatal.push(`${s.path} が外部へ通信した`);
    if (s.tables < 3) fatal.push(`${s.path} の表が少なすぎる: ${s.tables}`);
    if (!s.heading) fatal.push(`${s.path} の見出しが空`);
  }
  if (report.lowContrast.length !== 0) fatal.push(`文字が背景に埋もれている: ${report.lowContrast.length} 件`);
  if (report.contrastCanary !== 1) fatal.push("対比の検査器が陽性対照を捕まえられない — 検査器が壊れている");
  if (topIndexReqs.length !== 0) fatal.push("N-03: トップページが索引を取りに行った");
  if (report.external.length !== 0) fatal.push("N-02: 外部オリジンへ通信した");
  if (consoleErrors.length !== 0) fatal.push(`コンソールにエラー ${consoleErrors.length} 件`);
  if (!report.g11.pass) fatal.push("G-11 超過");
  if (!report.g12.pass) fatal.push("G-12 超過");
  if (fatal.length) {
    console.error("\n×", fatal.join(" / "));
    process.exit(1);
  }
  console.log("\n○ 実ブラウザ検品を通過");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
