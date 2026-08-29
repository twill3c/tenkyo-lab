// e-Gov 法令 API v2 から対象法令を取得して data/raw/ に置く。
//
// 出典: e-Gov 法令検索(デジタル庁) https://laws.e-gov.go.jp/
// 利用条件: 公共データ利用規約(第1.0版) — data/PROVENANCE.md 参照
//
// HC-012: 題名からの推定で確定しない。API で題名を検索し、
//         「題名が完全一致すること」を確かめてから law_id を採る。
//         一致が 0 件・複数件のものは採らず、理由つきで報告する。

import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = resolve(ROOT, "data/raw");
const API = "https://laws.e-gov.go.jp/api/2";

/** 採録対象。分野が偏らないように選んだ。題名は正式名称で書く。 */
const TARGETS = [
  "日本国憲法",
  "民法",
  "商法",
  "会社法",
  "民事訴訟法",
  "借地借家法",
  "製造物責任法",
  "消費者契約法",
  "刑法",
  "刑事訴訟法",
  "軽犯罪法",
  "著作権法",
  "特許法",
  "商標法",
  "意匠法",
  "不正競争防止法",
  "労働基準法",
  "労働契約法",
  "労働安全衛生法",
  "労働組合法",
  "個人情報の保護に関する法律",
  "不正アクセス行為の禁止等に関する法律",
  "電気通信事業法",
  "行政手続法",
  "行政不服審査法",
  "行政機関の保有する情報の公開に関する法律",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

/** 題名の完全一致で law_id を引く。曖昧なものは null を返して理由を残す。 */
async function resolveLawId(title) {
  const url = `${API}/laws?law_title=${encodeURIComponent(title)}&limit=100`;
  const data = await getJson(url);
  const exact = (data.laws ?? []).filter((l) => l.revision_info?.law_title === title);
  if (exact.length === 0) return { title, id: null, reason: `題名の完全一致なし(候補 ${data.total_count} 件)` };
  if (exact.length > 1) {
    // 同名の法令が複数(旧法など)。公布日が最も新しいものを採り、その旨を記録する
    exact.sort((a, b) => (a.law_info.promulgation_date < b.law_info.promulgation_date ? 1 : -1));
    return {
      title,
      id: exact[0].law_info.law_id,
      reason: `同名 ${exact.length} 件のうち公布日最新(${exact[0].law_info.promulgation_date})を採用`,
      ambiguous: true,
    };
  }
  return { title, id: exact[0].law_info.law_id, reason: null };
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const manifest = [];
  const skipped = [];

  for (const title of TARGETS) {
    const r = await resolveLawId(title);
    await sleep(300);
    if (!r.id) {
      console.log(`  ✗ ${title} — ${r.reason}`);
      skipped.push(r);
      continue;
    }
    const path = resolve(RAW_DIR, `${r.id}.json`);
    if (existsSync(path)) {
      const cached = JSON.parse(await readFile(path, "utf8"));
      manifest.push({ ...r, updated: cached.revision_info?.law_updated ?? null, cached: true });
      console.log(`  = ${title} (${r.id}) 取得済み`);
      continue;
    }
    const body = await getJson(`${API}/law_data/${r.id}?response_format=json`);
    await writeFile(path, JSON.stringify(body), "utf8");
    manifest.push({
      title,
      id: r.id,
      lawNum: body.law_info?.law_num ?? null,
      promulgationDate: body.law_info?.promulgation_date ?? null,
      updated: body.revision_info?.updated ?? null,
      ambiguous: r.ambiguous ?? false,
      note: r.reason,
    });
    console.log(`  + ${title} (${r.id}) ${(JSON.stringify(body).length / 1024).toFixed(0)} KB`);
    await sleep(400);
  }

  await writeFile(
    resolve(ROOT, "data/corpus-manifest.json"),
    JSON.stringify(
      {
        source: "e-Gov 法令検索 法令API Version 2",
        sourceUrl: "https://laws.e-gov.go.jp/",
        license: "公共データ利用規約(第1.0版)",
        fetchedAt: new Date().toISOString(),
        requested: TARGETS.length,
        acquired: manifest.length,
        laws: manifest,
        skipped,
      },
      null,
      2
    ),
    "utf8"
  );
  console.log(`\n要求 ${TARGETS.length} / 取得 ${manifest.length} / 不採録 ${skipped.length}`);
}

await main();
