// 「測る」ページの資材を取る。
//
// **索引も模型も取らない。** 必要なのは事前計算した順位(上位 50 位)と正解だけで、
// 合計 600KB 弱。問い文(735KB)は「例を見る」を開いたときだけ取る。

import { openEvalPack } from "@/lib/evalpack.mjs";

export const BASE = "/tenkyo/eval";

export type Pack = ReturnType<typeof openEvalPack>;

async function bin(name: string) {
  const r = await fetch(`${BASE}/${name}`);
  if (!r.ok) throw new Error(`${name} → ${r.status}`);
  return r.arrayBuffer();
}

let cached: Pack | null = null;
let queries: string[] | null = null;

export async function loadPack(): Promise<Pack> {
  if (cached) return cached;
  const [d, s, len, gc, gv, ex, law, order, metaRes] = await Promise.all([
    bin("rank-dense.bin"),
    bin("rank-sparse.bin"),
    bin("rank-len.bin"),
    bin("gold-counts.bin"),
    bin("gold-values.bin"),
    bin("exclude.bin"),
    bin("item-law.bin"),
    bin("id-order.bin"),
    fetch(`${BASE}/eval-meta.json`).then((r) => r.json()),
  ]);
  cached = openEvalPack({
    denseRanks: new Uint16Array(d),
    sparseRanks: new Uint16Array(s),
    rankLen: new Uint8Array(len),
    goldCounts: new Uint8Array(gc),
    goldValues: new Uint16Array(gv),
    exclude: new Uint16Array(ex),
    itemLaw: new Uint8Array(law),
    idOrder: new Uint16Array(order),
    meta: metaRes,
  });
  return cached;
}

/** 問い文は既定では取らない。開いたときだけ。 */
export async function loadQueries(): Promise<string[]> {
  if (queries) return queries;
  const r = await fetch(`${BASE}/queries.json`);
  if (!r.ok) throw new Error(`queries.json → ${r.status}`);
  queries = (await r.json()) as string[];
  return queries;
}

/** ブラウザが実際に受け取ったバイト数(このページ分だけ)。 */
export function transferredHere(): number {
  if (typeof performance === "undefined") return 0;
  return (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
    .filter((e) => e.name.includes(`${BASE}/`))
    .reduce((a, e) => a + (e.transferSize || e.encodedBodySize || 0), 0);
}
