// data/chunks.json → data/index/vec_f32.bin
//
// 密検索の索引をローカルで事前計算する。Vercel のビルド中には決して走らせない(SPEC N-01/N-02)。
//
// kototoi-do から流用した勘所:
//   - e5 は接頭辞を要求する。索引側は "passage: "、問い合わせ側は "query: "。
//     外すと日本語検索が壊れる(F-11 でこれを体験させる索引も別に作る)
//   - ベクトルは溜めずに書き流す。全件を配列で抱えるとメモリが膨らむ
//   - 模型キャッシュは npm i で消えるので、リポジトリ側の data/ に置く

import fs from "node:fs";
import path from "node:path";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { env, pipeline } from "@huggingface/transformers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
env.cacheDir = resolve(ROOT, "data/model-cache");

export const MODEL = "Xenova/multilingual-e5-small";
export const DIMS = 384;
const BATCH = 64;

const arg = (k, d) => {
  const i = process.argv.indexOf("--" + k);
  return i < 0 ? d : process.argv[i + 1];
};

async function main() {
  const prefix = arg("prefix", "passage: ");
  const outDir = resolve(ROOT, arg("out", "data/index"));
  const limit = Number(arg("limit", Infinity));

  const { chunks } = JSON.parse(fs.readFileSync(resolve(ROOT, "data/chunks.json"), "utf8"));
  const targets = chunks.slice(0, limit);
  if (targets.length === 0) {
    console.error("チャンクが 1 件も無い");
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`索引対象 ${targets.length} チャンク / 接頭辞 ${JSON.stringify(prefix)} / 出力 ${outDir}`);

  const ex = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
  const sink = fs.createWriteStream(path.join(outDir, "vec_f32.bin"));
  const write = (buf) =>
    new Promise((res, rej) => {
      sink.write(buf) ? res() : sink.once("drain", res);
      sink.once("error", rej);
    });

  const t0 = Date.now();
  for (let i = 0; i < targets.length; i += BATCH) {
    const slice = targets.slice(i, i + BATCH);
    const out = await ex(slice.map((c) => prefix + c.indexText), { pooling: "mean", normalize: true });
    await write(Buffer.from(Float32Array.from(out.data).buffer));
    if ((i / BATCH) % 20 === 0 || i + BATCH >= targets.length) {
      const done = Math.min(i + BATCH, targets.length);
      const el = (Date.now() - t0) / 1000;
      console.log(
        `  ${done}/${targets.length}  経過 ${el.toFixed(0)}s  残り ${((el / done) * (targets.length - done)).toFixed(0)}s`
      );
    }
  }
  await new Promise((res) => sink.end(res));

  const bytes = fs.statSync(path.join(outDir, "vec_f32.bin")).size;
  const want = targets.length * DIMS * 4;
  if (bytes !== want) {
    console.error(`書き出し量が合わない: ${bytes} != ${want}`);
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(outDir, "vec-meta.json"),
    JSON.stringify({ model: MODEL, dims: DIMS, prefix, count: targets.length, ids: targets.map((c) => c.id) })
  );
  console.log(`完了 ${targets.length} 件 / ${(bytes / 1048576).toFixed(1)} MB / ${((Date.now() - t0) / 60000).toFixed(1)} 分`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
