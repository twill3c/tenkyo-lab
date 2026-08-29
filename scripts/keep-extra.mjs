// 刈ってはいけないトークンを、元のトークナイザに実際に聞いて集める。
//
// e5 は "query: " / "passage: " の接頭辞を要求する。ここが割れると
// 索引側と問い合わせ側が別のベクトルを出す(kototoi-do loop_001 で実際に起きた)。
// **長さで機械的に切ると接頭辞のトークンまで落ちる**ので、名指しで残す。
import fs from "node:fs";
import { env, AutoTokenizer } from "@huggingface/transformers";
env.cacheDir = "data/model-cache";

const ESSENTIAL = [
  "query: ", "passage: ", "query", "passage",
  "0123456789",
  "、。「」『』・ー〜（）〔〕",
  ".,:;!?()[]{}\"'-_/\@#%&*+=<>|~`^$",
  "The quick brown fox jumps over the lazy dog",
  "あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん",
  "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン",
  // 法令特有: 条項号の数え方と、条文に頻出する語形
  "第一二三四五六七八九十百千条項号",
  "の規定は前項前条次条同条準用する場合を含む",
];

const tok = await AutoTokenizer.from_pretrained("Xenova/multilingual-e5-small");
const ids = new Set();
for (const s of ESSENTIAL) for (const id of tok.encode(s)) ids.add(id);
// 1 文字ずつも通す(単独で来たときに割れないように)
for (const s of ESSENTIAL) for (const ch of s) for (const id of tok.encode(ch)) ids.add(id);

fs.mkdirSync("data", { recursive: true });
fs.writeFileSync("data/keep-extra.json", JSON.stringify({ ids: [...ids].sort((a, b) => a - b) }));
console.log(`必ず残すトークン ${ids.size} 件 → data/keep-extra.json`);
const q = tok.encode("query: ");
// transformers.js v4 では tok.model が公開されていない(v3 から変わった)。
// 語彙表を直接引かず、トークナイザに復号させて確かめる
console.log('  "query: " →', q.join(","), "=", q.map((i) => tok.decode([i])).join("|"));
if (ids.size === 0) { console.error("1 件も集まらなかった"); process.exit(1); }
