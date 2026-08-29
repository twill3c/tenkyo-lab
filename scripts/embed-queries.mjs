// オラクルのクエリを埋め込む。索引側と別の接頭辞("query: ")を使う。
//
// e5 は接頭辞で「これは問い合わせか、収録文か」を区別する。
// 索引側と同じ接頭辞を使うと日本語検索が壊れる —— F-11 でこれを体験させる。

import fs from "node:fs";
import path from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";
import { MODEL, DIMS } from "./embed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
env.cacheDir = resolve(ROOT, "data/model-cache");
const BATCH = 64;

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i < 0 ? d : process.argv[i + 1];
};

async function main() {
  const prefix = arg("prefix", "query: ");
  const outName = arg("name", "query");
  const outDir = resolve(ROOT, "data/index");
  const source = arg("source", "data/oracle.json");
  const raw = JSON.parse(fs.readFileSync(resolve(ROOT, source), "utf8"));
  // オラクル({items:[{id, query}]})でも、素の文字列配列でも受ける
  const items = Array.isArray(raw)
    ? raw.map((q, i) => ({ id: `neg-${i}`, query: q }))
    : raw.items;
  if (!items || items.length === 0) {
    console.error(`${source} が空`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`クエリ ${items.length} 件 / 接頭辞 ${JSON.stringify(prefix)}`);

  const ex = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const buf = new Float32Array(items.length * DIMS);
  const t0 = Date.now();
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const out = await ex(slice.map((it) => prefix + it.query), { pooling: "mean", normalize: true });
    buf.set(Float32Array.from(out.data), i * DIMS);
    if ((i / BATCH) % 20 === 0 || i + BATCH >= items.length) {
      const done = Math.min(i + BATCH, items.length);
      console.log(`  ${done}/${items.length}  経過 ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }
  fs.writeFileSync(path.join(outDir, `${outName}_f32.bin`), Buffer.from(buf.buffer));
  fs.writeFileSync(
    path.join(outDir, `${outName}-meta.json`),
    JSON.stringify({ model: MODEL, dims: DIMS, prefix, count: items.length, ids: items.map((i) => i.id) })
  );
  console.log(`完了 ${items.length} 件 / ${((Date.now() - t0) / 60000).toFixed(1)} 分`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
