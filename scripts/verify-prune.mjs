// G-10 語彙刈り込みの保存。刈った模型が刈る前と同じベクトルを出すかを検算する。
//
// 語彙を削ると Unigram の分かち方が変わりうる。ここを測らずに配ると、
// 索引(刈る前の模型で作った)と読み取り機(刈った模型)が別の空間を向く。
//
// **1 問ずつ通すこと。** まとめて通すと、束の中でいちばん長い列に合わせて詰め物が入り、
// 刈った側だけ列長が変わったときに詰め物の量が食い違って、模型の差でないものが差として出る。
// 閲覧時は 1 問ずつ通すので、検算もそれに揃える
// (kototoi-do は束にして測り、0.996 という偽の差を追いかけた)。
//
// **検証クエリは作り話ではなく、実際のオラクルから種つきで抽出する。**
// 手で考えた例文は、実データの語形の偏りを写せない。

import fs from "node:fs";
import { pipeline, env } from "@huggingface/transformers";

const THRESHOLD = 0.9999; // SPEC §5 の G-10。ここでは読むだけ
const SAMPLE = 16;
const SEED = 20260829;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const { items } = JSON.parse(fs.readFileSync("data/oracle.json", "utf8"));
const r = rng(SEED);
const picked = new Set();
while (picked.size < SAMPLE) picked.add(Math.floor(r() * items.length));
const JP_QUERIES = [...picked].sort((a, b) => a - b).map((i) => items[i].query);

// 刈った範囲。ここが落ちるのは想定どおりで、ゲートの対象にしない。
const OUT_OF_SCOPE = ["Съешь же ещё этих мягких французских булок", "a story about the sea"];  // text-hygiene:allow-foreign — 刈った範囲を示す意図的な陰性対照

async function load(local) {
  env.allowRemoteModels = !local;
  env.allowLocalModels = local;
  env.cacheDir = "data/model-cache";
  if (local) env.localModelPath = "./public/tenkyo/";
  return pipeline("feature-extraction", local ? "model" : "Xenova/multilingual-e5-small", { dtype: "q8" });
}

const ALL = [...JP_QUERIES, ...OUT_OF_SCOPE];
const full = await load(false);
const A = [];
for (const q of ALL) A.push(Float32Array.from((await full("query: " + q, { pooling: "mean", normalize: true })).data));
const pruned = await load(true);
const B = [];
for (const q of ALL) B.push(Float32Array.from((await pruned("query: " + q, { pooling: "mean", normalize: true })).data));

const D = A[0].length;
const cos = (i) => {
  let s = 0;
  for (let k = 0; k < D; k++) s += A[i][k] * B[i][k];
  return s;
};

console.log("  類似度   クエリ");
let worst = 1;
let worstQ = "";
let inScopePass = 0;
ALL.forEach((q, i) => {
  const s = cos(i);
  const inScope = i < JP_QUERIES.length;
  if (inScope) {
    if (s < worst) {
      worst = s;
      worstQ = q;
    }
    if (s >= THRESHOLD) inScopePass += 1;
  }
  console.log(`  ${s.toFixed(6)}  ${q.slice(0, 46)}${inScope ? "" : "   ← 刈った範囲(ゲート対象外)"}`);
});

// 借り元(kototoi-do G-06)の測り方に揃える: **件数**で判定する(HC-060)
const pass = inScopePass === JP_QUERIES.length;
console.log(`\n日本語クエリ ${JP_QUERIES.length} 件中 ${inScopePass} 件が ${THRESHOLD} 以上`);
console.log(`最悪 ${worst.toFixed(6)}(${worstQ.slice(0, 40)})`);
console.log(`\n${pass ? "○" : "×"} G-10: ${inScopePass}/${JP_QUERIES.length}  閾値 全件 ${THRESHOLD} 以上`);
fs.writeFileSync(
  "data/prune-verify.json",
  JSON.stringify({ threshold: THRESHOLD, n: JP_QUERIES.length, passed: inScopePass, worst, worstQ, pass }, null, 2)
);
if (!pass) process.exit(1);
