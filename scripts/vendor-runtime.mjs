// ONNX Runtime の wasm を自分のオリジンへ複製する(kototoi-do scripts/vendor-runtime.mjs から流用)。
// 既定では CDN から取りに行くため、そのままだと閲覧時に外部へ通信する(SPEC N-02 違反)。
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'node_modules/onnxruntime-web/dist';
const OUT = 'public/tenkyo/ort';
/*
  単スレッド運用なので jsep(WebGPU)版は要らない。10.6 MB と 20.6 MB の差は大きい。
  Transformers.js の既定は onnxruntime-web の "all" 束で jsep を取りに行くため、
  next.config.ts で wasm 専用の束に寄せてある。

  控えとして jsep 版も置く、という手は採らない。置けば、寄せ替えが壊れたときに
  **黙って倍の量が配られる**。置かなければ壊れたと分かる —— それを
  tests/runtime.test.mjs(L5 で置く) が組み上がった束に対して確かめる。
*/
const FILES = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

fs.mkdirSync(OUT, { recursive: true });
let total = 0;
for (const f of FILES) {
  const src = path.join(SRC, f);
  if (!fs.existsSync(src)) throw new Error(`${src} が無い — onnxruntime-web の版で名前が変わった可能性`);
  fs.copyFileSync(src, path.join(OUT, f));
  const n = fs.statSync(src).size;
  total += n;
  console.log(`  ${f}  ${(n / 1048576).toFixed(1)} MB`);
}
console.log(`実行系 → ${OUT}  計 ${(total / 1048576).toFixed(1)} MB`);
