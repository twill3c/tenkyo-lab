// 「測る」ページ用の資材を詰める。public/tenkyo/eval/ に置く。
//
// **このページは索引も模型も要らない。** 密・疎それぞれの上位 50 位を事前に計算して
// 詰めておけば、つまみ(k / RRF の定数 / 手法 / 指標 / 法令の絞り込み)は
// **順位だけで計算し直せる**。RRF は順位しか見ないので、スコアも要らない。
//
// 逆に言えば、**順位で回せないつまみはこのページでは扱えない** ——
// チャンクの粒度・埋め込み模型・MMR は索引そのものを作り直す必要がある。
// 扱えないことは画面に書く(黙って無いことにしない)。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { buildIndex, search as searchSparse } from "../src/lib/bm25.mjs";
import { searchDense } from "../src/lib/dense.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/tenkyo/eval");
const DIMS = 384;
export const POOL = 50;

/** 正解は 1〜3 件。件数 + チャンク番号を uint16 で並べる。 */
export function packGold(items, indexOf) {
  const counts = new Uint8Array(items.length);
  const flat = [];
  for (let i = 0; i < items.length; i++) {
    const ids = items[i].gold.map(indexOf);
    if (ids.some((x) => x < 0)) throw new Error(`正解が索引に無い: ${items[i].id}`);
    counts[i] = ids.length;
    flat.push(...ids);
  }
  return { counts, values: Uint16Array.from(flat) };
}

/** 出題元(結果から除く 1 件)。 */
export function packExclude(items, indexOf) {
  return Uint16Array.from(items.map((it) => indexOf(it.excludeFromResults[0])));
}

const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1);

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const { items } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/oracle.json"), "utf8"));
  const bin = fs.readFileSync(resolve(ROOT, "data/index/vec_f32.bin"));
  const vecs = new Float32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4);
  const qbin = fs.readFileSync(resolve(ROOT, "data/index/query_f32.bin"));
  const qvecs = new Float32Array(qbin.buffer, qbin.byteOffset, qbin.byteLength / 4);
  const ids = chunks.map((c) => c.id);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const indexOf = (id) => pos.get(id) ?? -1;
  const ix = buildIndex(chunks.map((c) => ({ id: c.id, text: c.indexText })));

  fs.mkdirSync(OUT, { recursive: true });

  // --- 上位 50 位を密・疎それぞれで ---
  // **f32 索引で計算する。** 「測る」ページが示すのは評価器と同じ数字であり、
  // 量子化の影響は G-05 が別に見ている(混ぜると何を測っているか分からなくなる)
  const dense = new Uint16Array(items.length * POOL);
  const sparse = new Uint16Array(items.length * POOL);
  const denseLen = new Uint8Array(items.length);
  const sparseLen = new Uint8Array(items.length);
  for (let i = 0; i < items.length; i++) {
    const exclude = new Set(items[i].excludeFromResults);
    const q = qvecs.subarray(i * DIMS, (i + 1) * DIMS);
    const d = searchDense(vecs, DIMS, ids, q, { topK: POOL, exclude });
    const s = searchSparse(ix, items[i].query, { topK: POOL, exclude });
    denseLen[i] = d.length;
    sparseLen[i] = s.length;
    for (let k = 0; k < d.length; k++) dense[i * POOL + k] = d[k].idx;
    for (let k = 0; k < s.length; k++) sparse[i * POOL + k] = s[k].idx;
    if (i % 500 === 0) console.log(`  ${i}/${items.length}`);
  }

  const gold = packGold(items, indexOf);
  const exclude = packExclude(items, indexOf);
  const laws = [];
  const lawIdx = new Map();
  for (const c of chunks) {
    if (!lawIdx.has(c.lawId)) {
      lawIdx.set(c.lawId, laws.length);
      laws.push(c.lawTitle);
    }
  }
  const itemLaw = Uint8Array.from(items.map((it) => lawIdx.get(it.lawId)));

  const sizes = {};
  const write = (name, buf) => {
    fs.writeFileSync(resolve(OUT, name), buf);
    sizes[name] = { raw: buf.length, gzip: gz(buf) };
  };
  write("rank-dense.bin", Buffer.from(dense.buffer));
  write("rank-sparse.bin", Buffer.from(sparse.buffer));
  write("rank-len.bin", Buffer.concat([Buffer.from(denseLen), Buffer.from(sparseLen)]));
  write("gold-counts.bin", Buffer.from(gold.counts));
  write("gold-values.bin", Buffer.from(gold.values.buffer));
  write("exclude.bin", Buffer.from(exclude.buffer));
  write("item-law.bin", Buffer.from(itemLaw));
  // **同点の割り方を再現するための表。**
  // 評価器の RRF は同点を id 文字列の昇順で割っている。ブラウザ側はチャンク番号しか
  // 持たないので、番号 → 辞書順の順位 を渡す。これが無いと融合の順位が評価器と食い違い、
  // G-16 が落ちる(順位の食い違いは同点のときだけ起きるので、気づきにくい)
  const order = new Uint16Array(ids.length);
  ids
    .map((id, i) => [id, i])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .forEach(([, i], rank) => {
      order[i] = rank;
    });
  write("id-order.bin", Buffer.from(order.buffer));
  write(
    "eval-meta.json",
    Buffer.from(
      JSON.stringify({
        items: items.length,
        chunks: chunks.length,
        pool: POOL,
        laws,
        // 評価器が出した値。ブラウザ側の計算がこれと一致することを G-16 で見る
        reference: JSON.parse(fs.readFileSync(resolve(ROOT, "data/eval-result.json"), "utf8")).results,
      }),
      "utf8"
    )
  );
  // 問い文は「例を見る」を開いたときだけ取る(既定では取らない)
  write("queries.json", Buffer.from(JSON.stringify(items.map((it) => it.query)), "utf8"));

  const core = ["rank-dense.bin", "rank-sparse.bin", "rank-len.bin", "gold-counts.bin", "gold-values.bin", "exclude.bin", "item-law.bin", "id-order.bin", "eval-meta.json"];
  const total = core.reduce((a, n) => ({ raw: a.raw + sizes[n].raw, gzip: a.gzip + sizes[n].gzip }), { raw: 0, gzip: 0 });
  console.log("\n--- 「測る」の資材 ---");
  for (const [n, s] of Object.entries(sizes)) console.log(`  ${n.padEnd(18)} ${kb(s.raw).padStart(8)} KB  (gzip ${kb(s.gzip)} KB)`);
  console.log(`\n  ページを開いたとき  ${kb(total.raw)} KB  (gzip ${kb(total.gzip)} KB)`);
  console.log(`  「例を見る」で追加  ${kb(sizes["queries.json"].raw)} KB  (gzip ${kb(sizes["queries.json"].gzip)} KB)`);
  fs.writeFileSync(resolve(ROOT, "data/eval-payload.json"), JSON.stringify({ sizes, total }, null, 2));
  if (items.length === 0) {
    console.error("問いが 1 件も無い");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
