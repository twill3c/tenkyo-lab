// 模型の原本をリポジトリ内に落とす。node_modules 配下のキャッシュは npm i で消えるため、
// 生成資産は必ずリポジトリ側(data/)に置く(kototoi-do loop_001 の教訓)。
// これはビルド前の作業であり、閲覧時の通信ではない(N-02 は閲覧時の規定)。
import fs from "node:fs";
import path from "node:path";

const REPO = "Xenova/multilingual-e5-small";
const FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
const OUT = process.argv[2] ?? "data/model-src";

let got = 0;
for (const f of FILES) {
  const dest = path.join(OUT, f);
  if (fs.existsSync(dest)) {
    console.log("既にある", f);
    continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = `https://huggingface.co/${REPO}/resolve/main/${f}`;
  process.stdout.write(`取得 ${f} … `);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const b = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(dest, b);
  console.log(`${(b.length / 1048576).toFixed(1)} MB`);
  got += 1;
}
console.log(`原本 → ${OUT}(新規取得 ${got} / 全 ${FILES.length} 件)`);
if (FILES.some((f) => !fs.existsSync(path.join(OUT, f)))) {
  console.error("欠けているファイルがある");
  process.exit(1);
}
