import type { NextConfig } from "next";
import path from "node:path";

// 静的書き出しのみ。サーバ関数を一つも持たない(SPEC N-01)。
// 索引はビルド前にローカルで焼き、public/tenkyo/ から同一オリジンで配る(N-02/N-04)。
// next build は索引生成器を呼ばない —— 呼べば Vercel 上で模型を落としに行くことになる。
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  /*
    onnxruntime-web の既定の束は WebGPU 込みの jsep 版で、wasm が 24.89MB ある。
    このアプリは一問ごとに短い列を一本通すだけなので WebGPU は要らない。
    wasm 専用の束へ寄せると 12.34MB になる。

    条件名の配列(resolve.conditionNames)に手を入れると "node" が紛れ込んで
    Node 版の transformers を掴むことがある(kototoi-do loop_001 で踏んだ)。
    exports フィールドが深いパスを塞ぐので、**ファイルの実体を絶対パスで名指しする**。
    控えとして jsep 版を置く手は採らない —— 置けば、寄せ替えが壊れたときに
    黙って倍の量が配られる。置かなければ壊れたと分かる。
  */
  webpack: (config, { isServer }) => {
    // 閲覧側の束だけを差し替える。サーバ側に混ぜると Node 版の実行系を掴んでしまう
    if (!isServer) {
      const wasmOnly = path.resolve("node_modules/onnxruntime-web/dist/ort.wasm.min.mjs");
      config.resolve.alias = {
        ...config.resolve.alias,
        // **下位パスも名指しする。** @huggingface/transformers v4 は
        // `onnxruntime-web/webgpu` を import しており、v3 のような素の
        // `onnxruntime-web` ではない。`$` 付きの別名だけでは掴めず、
        // WebGPU 込みの束が引き込まれて **asyncify 版の wasm 22.48MB が
        // 出荷物に混ざる**(loop_005 で束の検査が捕捉した)
        "onnxruntime-web/webgpu$": wasmOnly,
        "onnxruntime-web$": wasmOnly,
      };
    }
    return config;
  },
};

export default nextConfig;
