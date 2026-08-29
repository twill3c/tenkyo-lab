// 索引を配布形式に詰める。public/tenkyo/index/ に置く。
//
// 段取りを分ける。**トップページは索引を 1 バイトも取らない**(N-03)。
//   一問目(密検索)  … vec_i8.bin + quant.json + meta.json
//   つまみを入れたとき … sparse.bin + terms.bin(疎検索・ハイブリッドを選んだときだけ)
//   結果を出すとき   … text.bin の必要な一節だけを HTTP Range で取る
//
// **配布量はつまみごとに分けて画面に出す**(N-04)。
// 「ハイブリッドにすると 2.7MB 増える」ことを、使う側が見て選べるようにするため。

import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";
import { buildIndex } from "../src/lib/bm25.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "public/tenkyo/index");

/** 可変長整数(LEB128)。小さい値ほど短くなる。 */
export function writeVarint(bytes, v) {
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v);
}

export function readVarint(buf, pos) {
  let v = 0;
  let shift = 0;
  for (;;) {
    const b = buf[pos++];
    v |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [v >>> 0, pos];
    shift += 7;
  }
}

/**
 * 転置索引を詰める。文書番号は**昇順に並べてから差分**を取る。
 * 差分は小さくなるので可変長整数がよく効く。
 */
export function packPostings(postings, terms) {
  const bytes = [];
  const offsets = new Uint32Array(terms.length + 1);
  for (let t = 0; t < terms.length; t++) {
    offsets[t] = bytes.length;
    const p = postings.get(terms[t]);
    const pairs = [];
    for (let j = 0; j < p.length; j += 2) pairs.push([p[j], p[j + 1]]);
    pairs.sort((a, b) => a[0] - b[0]);
    writeVarint(bytes, pairs.length);
    let prev = 0;
    for (const [doc, tf] of pairs) {
      writeVarint(bytes, doc - prev);
      writeVarint(bytes, tf);
      prev = doc;
    }
  }
  offsets[terms.length] = bytes.length;
  return { data: Uint8Array.from(bytes), offsets };
}

/** 語は文字バイグラム。2 つの UTF-16 符号単位で固定長に詰める(1 文字語は第 2 単位を 0)。 */
export function packTerms(terms) {
  const out = new Uint16Array(terms.length * 2);
  for (let i = 0; i < terms.length; i++) {
    out[i * 2] = terms[i].charCodeAt(0);
    out[i * 2 + 1] = terms[i].length > 1 ? terms[i].charCodeAt(1) : 0;
  }
  return out;
}

const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;
const mb = (n) => (n / 1048576).toFixed(2);

async function main() {
  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });
  const sizes = {};
  const write = (name, buf) => {
    fs.writeFileSync(resolve(OUT, name), buf);
    sizes[name] = { raw: buf.length, gzip: gz(buf) };
  };

  // --- 密検索 ---
  write("vec_i8.bin", fs.readFileSync(resolve(ROOT, "data/index/vec_i8.bin")));
  write("quant.json", fs.readFileSync(resolve(ROOT, "data/index/quant-meta.json")));

  // --- チャンクの身元。本文は入れない(本文は Range で後から取る) ---
  const laws = [];
  const lawIdx = new Map();
  for (const c of chunks) {
    if (!lawIdx.has(c.lawId)) {
      lawIdx.set(c.lawId, laws.length);
      laws.push({ id: c.lawId, title: c.lawTitle });
    }
  }
  const meta = {
    laws,
    // [法令番号, 条番号, 項番号] のみ。id は組み立て直せる
    chunks: chunks.map((c) => [lawIdx.get(c.lawId), c.articleNum, c.paragraphNum]),
  };
  write("meta.json", Buffer.from(JSON.stringify(meta), "utf8"));

  // --- 疎検索(つまみを入れたときだけ取る) ---
  const ix = buildIndex(chunks.map((c) => ({ id: c.id, text: c.indexText })));
  const terms = [...ix.postings.keys()].sort();
  const packed = packPostings(ix.postings, terms);
  write("terms.bin", Buffer.from(packTerms(terms).buffer));
  write("postings.bin", Buffer.from(packed.data.buffer));
  write("postings-offsets.bin", Buffer.from(packed.offsets.buffer));
  write(
    "sparse-meta.json",
    Buffer.from(JSON.stringify({ N: ix.N, avgdl: ix.avgdl, termCount: terms.length }), "utf8")
  );
  write("dl.bin", Buffer.from(Uint16Array.from(ix.dl).buffer));

  // --- 本文(HTTP Range で必要な一節だけ取る) ---
  const parts = chunks.map((c) => Buffer.from(JSON.stringify({ c: c.caption, t: c.text }), "utf8"));
  const offsets = new Uint32Array(chunks.length + 1);
  let acc = 0;
  for (let i = 0; i < parts.length; i++) {
    offsets[i] = acc;
    acc += parts[i].length;
  }
  offsets[chunks.length] = acc;
  write("text.bin", Buffer.concat(parts));
  write("text-offsets.bin", Buffer.from(offsets.buffer));

  // --- 段取りごとの合計 ---
  const stage = (names) =>
    names.reduce((a, n) => ({ raw: a.raw + sizes[n].raw, gzip: a.gzip + sizes[n].gzip }), { raw: 0, gzip: 0 });
  const dense = stage(["vec_i8.bin", "quant.json", "meta.json"]);
  const sparse = stage(["terms.bin", "postings.bin", "postings-offsets.bin", "sparse-meta.json", "dl.bin"]);

  console.log("--- 配布物 ---");
  for (const [n, s] of Object.entries(sizes)) {
    console.log(`  ${n.padEnd(22)} ${mb(s.raw).padStart(6)} MB  (gzip ${mb(s.gzip)} MB)`);
  }
  console.log(`\n  一問目(密検索のみ)   ${mb(dense.raw)} MB  (gzip ${mb(dense.gzip)} MB)`);
  console.log(`  疎・ハイブリッド追加  ${mb(sparse.raw)} MB  (gzip ${mb(sparse.gzip)} MB)`);
  console.log(`  本文は Range で必要分だけ(全体 ${mb(sizes["text.bin"].raw)} MB)`);

  const modelDir = resolve(ROOT, "public/tenkyo/model");
  const modelBytes = ["onnx/model_quantized.onnx", "tokenizer.json", "config.json", "tokenizer_config.json"]
    .filter((f) => fs.existsSync(resolve(modelDir, f)))
    .reduce((a, f) => a + fs.statSync(resolve(modelDir, f)).size, 0);
  console.log(`  刈った模型一式      ${mb(modelBytes)} MB`);

  fs.writeFileSync(resolve(ROOT, "data/payload.json"), JSON.stringify({ sizes, dense, sparse, modelBytes }, null, 2));
  if (Object.keys(sizes).length === 0) {
    console.error("何も書き出さなかった");
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
