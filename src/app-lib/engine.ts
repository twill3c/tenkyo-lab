// 閲覧者の端末で動く検索の一式。
//
// 段取りを分けて取る(SPEC §5.5)。トップページからは何も呼ばない。
//   stage "dense"  … 一問目に要る分だけ(vec_i8 + meta + quant)
//   stage "sparse" … 疎検索・ハイブリッドを選んだときだけ
//   本文           … 結果に出す一節だけを HTTP Range で
//
// **取得バイト数は推定せず、ブラウザの実測値を読む**(N-04)。
// performance の resource timing が返す transferSize が、実際に線を通った量である。

import { env, pipeline } from "@huggingface/transformers";
import { searchQuantized, foldQuery } from "@/lib/quant.mjs";
import { search as searchSparse } from "@/lib/bm25.mjs";
import { rrfFuse } from "@/lib/metrics.mjs";
import { openPackedSparse, asIndex, rebuildIds, textRange } from "@/lib/packed.mjs";

export const BASE = "/tenkyo";
export const DIMS = 384;
export type Method = "dense" | "sparse" | "hybrid";

export type Hit = {
  id: string;
  idx: number;
  score: number;
  lawTitle: string;
  articleLabel: string;
  paragraphNum: string;
  caption?: string | null;
  text?: string;
};

export type Stages = {
  query: string;
  prefixed: string;
  vector: Float32Array | null;
  dense: Hit[];
  sparse: Hit[];
  fused: Hit[];
  shown: Hit[];
  contextChars: number;
  ms: { embed: number; search: number; text: number };
};

/** 「第百二十条の二」のような表記へ戻す(src/lib/kanjinum.mjs と同じ規則)。 */
import { articleNumToLabel } from "@/lib/kanjinum.mjs";

type Meta = { laws: { id: string; title: string }[]; chunks: [number, string, string][] };

let dense: {
  q8: Int8Array;
  mu: Float64Array;
  s: Float64Array;
  ids: string[];
  meta: Meta;
  offsets: Uint32Array;
} | null = null;
let sparse: ReturnType<typeof asIndex> | null = null;
let extractor: unknown = null;

async function get(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}/${path}`, init);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r;
}

/** ブラウザが実際に受け取ったバイト数。推定しない。 */
export function transferred(): { total: number; byName: Record<string, number> } {
  if (typeof performance === "undefined") return { total: 0, byName: {} };
  const byName: Record<string, number> = {};
  let total = 0;
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (!e.name.includes(`${BASE}/`)) continue;
    const n = e.name.split(`${BASE}/`)[1].split("?")[0];
    const size = e.transferSize || e.encodedBodySize || 0;
    byName[n] = (byName[n] ?? 0) + size;
    total += size;
  }
  return { total, byName };
}

export async function loadDense(onProgress?: (s: string) => void) {
  if (dense) return dense;
  onProgress?.("索引(密)を取得中…");
  const meta: Meta = await (await get("index/meta.json")).json();
  const quant = await (await get("index/quant.json")).json();
  const q8 = new Int8Array(await (await get("index/vec_i8.bin")).arrayBuffer());
  const off = await (await get("index/text-offsets.bin")).arrayBuffer();
  dense = {
    q8,
    mu: Float64Array.from(quant.mu),
    s: Float64Array.from(quant.s),
    ids: rebuildIds(meta),
    meta,
    offsets: new Uint32Array(off),
  };
  if (q8.length !== meta.chunks.length * DIMS) {
    throw new Error(`索引の大きさが合わない: ${q8.length} != ${meta.chunks.length * DIMS}`);
  }
  return dense;
}

export async function loadSparse(onProgress?: (s: string) => void) {
  if (sparse) return sparse;
  const d = await loadDense(onProgress);
  onProgress?.("索引(疎)を取得中…");
  const [terms, postings, offsets, dl, meta] = await Promise.all([
    get("index/terms.bin").then((r) => r.arrayBuffer()),
    get("index/postings.bin").then((r) => r.arrayBuffer()),
    get("index/postings-offsets.bin").then((r) => r.arrayBuffer()),
    get("index/dl.bin").then((r) => r.arrayBuffer()),
    get("index/sparse-meta.json").then((r) => r.json()),
  ]);
  const opened = openPackedSparse({
    terms: new Uint16Array(terms),
    postings: new Uint8Array(postings),
    offsets: new Uint32Array(offsets),
    dl: new Uint16Array(dl),
    meta,
  });
  sparse = asIndex(opened, d.ids);
  return sparse;
}

export async function loadModel(onProgress?: (s: string) => void) {
  if (extractor) return extractor;
  onProgress?.("模型を取得中(初回のみ)…");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = `${BASE}/`;
  // wasm も同一オリジンから。既定は CDN を見に行く(N-02 違反になる)。
  // 型では optional だが、実体が無ければ寄せ替えが効かないので**その場で落とす** ——
  // 黙って CDN から取りに行かせない
  const wasm = env.backends?.onnx?.wasm;
  if (!wasm) throw new Error("onnxruntime の wasm 設定が見つからない — 寄せ替えが効いていない");
  wasm.wasmPaths = `${BASE}/ort/`;
  wasm.numThreads = 1;
  extractor = await pipeline("feature-extraction", "model", { dtype: "q8" });
  return extractor;
}

function hitOf(d: NonNullable<typeof dense>, idx: number, score: number): Hit {
  const [lawIdx, art, para] = d.meta.chunks[idx];
  return {
    id: d.ids[idx],
    idx,
    score,
    lawTitle: d.meta.laws[lawIdx].title,
    articleLabel: articleNumToLabel(art) ?? art,
    paragraphNum: para,
  };
}

/** 結果に出す一節だけを HTTP Range で取る。全文(5.22MB)は取らない。 */
export async function fetchTexts(hits: Hit[]) {
  const d = await loadDense();
  await Promise.all(
    hits.map(async (h) => {
      const r = textRange(d.offsets, h.idx);
      if (r.length === 0) return;
      const res = await get("index/text.bin", { headers: { Range: `bytes=${r.start}-${r.end}` } });
      const body = JSON.parse(await res.text());
      h.text = body.t;
      h.caption = body.c;
    })
  );
  return hits;
}

export async function runQuery(
  query: string,
  method: Method,
  topK: number,
  onProgress?: (s: string) => void
): Promise<Stages> {
  const d = await loadDense(onProgress);
  const needSparse = method !== "dense";
  const sp = needSparse ? await loadSparse(onProgress) : null;
  const ex = await loadModel(onProgress);

  onProgress?.("問い合わせを埋め込み中…");
  const prefixed = "query: " + query;
  const t0 = performance.now();
  const out = await (ex as (t: string, o: object) => Promise<{ data: ArrayLike<number> }>)(prefixed, {
    pooling: "mean",
    normalize: true,
  });
  const vector = Float32Array.from(out.data);
  const t1 = performance.now();

  const POOL = 50;
  const dHits = searchQuantized(d.q8, DIMS, d.ids, foldQuery(vector, DIMS, { s: d.s }), { topK: POOL }).map(
    (h: { idx: number; score: number }) => hitOf(d, h.idx, h.score)
  );
  const sHits = sp
    ? searchSparse(sp, query, { topK: POOL }).map((h: { idx: number; score: number }) => hitOf(d, h.idx, h.score))
    : [];
  const fused =
    method === "hybrid"
      ? rrfFuse([dHits, sHits], { topK: POOL }).map((f: { id: string; score: number }) => {
          const idx = d.ids.indexOf(f.id);
          return hitOf(d, idx, f.score);
        })
      : [];
  const t2 = performance.now();

  const chosen = method === "dense" ? dHits : method === "sparse" ? sHits : fused;
  const shown = chosen.slice(0, topK);
  onProgress?.("条文を取得中…");
  await fetchTexts(shown);
  const t3 = performance.now();

  return {
    query,
    prefixed,
    vector,
    dense: dHits.slice(0, topK),
    sparse: sHits.slice(0, topK),
    fused: fused.slice(0, topK),
    shown,
    contextChars: shown.reduce((n, h) => n + (h.text?.length ?? 0), 0),
    ms: { embed: t1 - t0, search: t2 - t1, text: t3 - t2 },
  };
}
