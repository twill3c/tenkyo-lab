"use client";

// 「測る」—— このアプリの目玉(F-04 / F-05 / F-06)。
// つまみを回すと 2,808 問の指標が端末上で計算し直される。索引も模型も取らない。

import { useCallback, useEffect, useMemo, useState } from "react";
import { computeMetrics, perLaw, rankingFor, goldOf } from "@/lib/evalpack.mjs";
import { loadPack, loadQueries, transferredHere, type Pack } from "@/app-lib/evalengine";

type Method = "dense" | "sparse" | "hybrid";
const METHODS: { key: Method; label: string }[] = [
  { key: "dense", label: "密(意味)" },
  { key: "sparse", label: "疎(語・BM25)" },
  { key: "hybrid", label: "ハイブリッド(RRF)" },
];
const K_CHOICES = [1, 3, 5, 10, 20, 50];
const RRF_CHOICES = [1, 5, 10, 20, 60, 200, 1000];
const fmt4 = (x: number) => x.toFixed(4);

export default function Hakaru() {
  const [pack, setPack] = useState<Pack | null>(null);
  const [err, setErr] = useState("");
  const [method, setMethod] = useState<Method>("hybrid");
  const [k, setK] = useState(10);
  const [rrfK, setRrfK] = useState(60);
  const [lawFilter, setLawFilter] = useState<number | null>(null);
  const [ms, setMs] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [examples, setExamples] = useState<{ query: string; rank: number }[] | null>(null);
  const [loadingEx, setLoadingEx] = useState(false);

  useEffect(() => {
    loadPack()
      .then((p) => {
        setPack(p);
        setBytes(transferredHere());
      })
      .catch((e) => setErr(String(e)));
  }, []);

  // つまみの現在値で 3 手法すべてを計算する。比べられないと意味がない
  const rows = useMemo(() => {
    if (!pack) return null;
    const t0 = performance.now();
    const out = METHODS.map((m) => ({
      key: m.key,
      label: m.label,
      ...computeMetrics(pack, { method: m.key, k, rrfK, lawFilter }),
    }));
    setMs(performance.now() - t0);
    return out;
  }, [pack, k, rrfK, lawFilter]);

  const laws = useMemo(() => (pack ? perLaw(pack, { k, rrfK }) : null), [pack, k, rrfK]);

  const best = rows ? Math.max(...rows.map((r) => r.recall)) : 0;

  const showExamples = useCallback(async () => {
    if (!pack || loadingEx) return;
    setLoadingEx(true);
    try {
      const qs = await loadQueries();
      // 「この手法で当たった/外れた」問いを混ぜて見せる
      const picked: { query: string; rank: number }[] = [];
      for (let i = 0; i < pack.n && picked.length < 12; i += 47) {
        if (lawFilter !== null && pack.itemLaw[i] !== lawFilter) continue;
        const r = rankingFor(pack, i, method, rrfK);
        const g = goldOf(pack, i);
        let rank = -1;
        for (let j = 0; j < r.length; j++) {
          let hit = false;
          for (let t = 0; t < g.length; t++) if (g[t] === r[j]) hit = true;
          if (hit) {
            rank = j + 1;
            break;
          }
        }
        picked.push({ query: qs[i], rank });
      }
      setExamples(picked);
      setBytes(transferredHere());
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingEx(false);
    }
  }, [pack, method, rrfK, lawFilter, loadingEx]);

  return (
    <>
      <h1>測る</h1>
      <p className="lead">
        つまみを回すと、<strong>2,808 問の指標がその場で計算し直されます。</strong>
        検索はやり直しません —— 上位 50 位を事前に計算して配っているので、
        このページは<strong>索引も模型も取りません</strong>。
      </p>

      {err && <p className="warnbox" data-testid="error">{err}</p>}
      {!pack && !err && <p className="note">資材を取得中…</p>}

      {pack && (
        <>
          <div className="card">
            <div className="row" style={{ marginBottom: "0.5rem" }}>
              <span className="note" style={{ minWidth: "5rem" }}>上位 k</span>
              {K_CHOICES.map((x) => (
                <button key={x} className="pill" aria-pressed={k === x} onClick={() => setK(x)}>
                  {x}
                </button>
              ))}
            </div>
            <div className="row" style={{ marginBottom: "0.5rem" }}>
              <span className="note" style={{ minWidth: "5rem" }}>RRF の定数</span>
              {RRF_CHOICES.map((x) => (
                <button key={x} className="pill" aria-pressed={rrfK === x} onClick={() => setRrfK(x)}>
                  {x}
                </button>
              ))}
            </div>
            <div className="row">
              <span className="note" style={{ minWidth: "5rem" }}>法令</span>
              <button className="pill" aria-pressed={lawFilter === null} onClick={() => setLawFilter(null)}>
                すべて
              </button>
              {(laws ?? []).map((l: { law: number; title: string; n: number }) => (
                <button
                  key={l.law}
                  className="pill"
                  aria-pressed={lawFilter === l.law}
                  onClick={() => setLawFilter(l.law)}
                >
                  {l.title}
                </button>
              ))}
            </div>
          </div>

          <h2>指標</h2>
          <div className="scroll">
            <table data-testid="metrics">
              <thead>
                <tr>
                  <th>手法</th>
                  <th className="num">Recall@{k}</th>
                  <th className="num">Hit@{k}</th>
                  <th className="num">MRR</th>
                  <th className="num">nDCG@{k}</th>
                </tr>
              </thead>
              <tbody>
                {rows?.map((r) => (
                  <tr key={r.key}>
                    <td>
                      {r.recall === best ? <strong>{r.label}</strong> : r.label}
                      {r.key === "hybrid" && <span className="note"> k={rrfK}</span>}
                    </td>
                    <td className="num">{r.recall === best ? <strong>{fmt4(r.recall)}</strong> : fmt4(r.recall)}</td>
                    <td className="num">{fmt4(r.hit)}</td>
                    <td className="num">{fmt4(r.mrr)}</td>
                    <td className="num">{fmt4(r.ndcg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" data-testid="calcinfo">
            {rows?.[0].n.toLocaleString()} 問 / 計算 {ms.toFixed(0)}ms / 取得 {(bytes / 1024).toFixed(0)} KB
            {lawFilter !== null && `(${pack.laws[lawFilter]} に絞り込み)`}
          </p>

          <h2>ハイブリッドが負ける法令</h2>
          <p className="note">
            全体平均ではハイブリッドが勝ちます。<strong>法令別に分けると負ける法令があります。</strong>
            片方が明らかに強いとき、RRF はそれを平均して引き下げます。
          </p>
          <div className="scroll">
            <table data-testid="perlaw">
              <thead>
                <tr>
                  <th>法令</th>
                  <th className="num">問</th>
                  <th className="num">密</th>
                  <th className="num">疎</th>
                  <th className="num">融合</th>
                  <th className="num">差</th>
                </tr>
              </thead>
              <tbody>
                {(laws ?? []).map((l: { law: number; title: string; n: number; dense: number; sparse: number; hybrid: number; loses: boolean }) => {
                  const gap = l.hybrid - Math.max(l.dense, l.sparse);
                  return (
                    <tr key={l.law}>
                      <td>{l.loses ? <strong>{l.title}</strong> : l.title}</td>
                      <td className="num">{l.n}</td>
                      <td className="num">{l.dense.toFixed(3)}</td>
                      <td className="num">{l.sparse.toFixed(3)}</td>
                      <td className="num">{l.hybrid.toFixed(3)}</td>
                      <td className="num">
                        {l.loses ? <strong>{gap.toFixed(3)}</strong> : `+${gap.toFixed(3)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2>実際の問いを見る</h2>
          <p className="note">
            問い文は既定では取りません(735KB)。開いたときだけ取ります。
            順位は「いま選んでいる手法・定数」での正解の位置です。
          </p>
          {!examples && (
            <button className="ghost" onClick={showExamples} disabled={loadingEx}>
              {loadingEx ? "取得中…" : "問いを取得して見る(+735KB)"}
            </button>
          )}
          {examples && (
            <div className="scroll">
              <table data-testid="examples">
                <thead>
                  <tr>
                    <th>問い(参照の文字列を消したもの)</th>
                    <th className="num">正解の順位</th>
                  </tr>
                </thead>
                <tbody>
                  {examples.map((e, i) => (
                    <tr key={i}>
                      <td>{e.query}</td>
                      <td className="num">{e.rank < 0 ? "50 位内になし" : e.rank}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>このページで動かせないもの</h2>
          <p>
            事前に計算して配っているのは<strong>上位 50 位の順位だけ</strong>です。
            順位から計算し直せるつまみ(手法・k・RRF の定数・法令)は動きますが、
            次のものは<strong>索引そのものを作り直す必要があり、ここでは動かせません</strong>。
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>動かせないもの</th>
                  <th>別に測った結果</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>チャンクの粒度(条の項 / 条)</td>
                  <td>
                    条単位の索引で直接測ると密 <strong>0.4572</strong>(項単位 0.3327)。
                    <strong>粗いほうが良い。</strong>しかも<strong>勝つ手法が入れ替わり</strong>、
                    条単位では疎が 0.5373 で密を 8 ポイント上回る
                  </td>
                </tr>
                <tr>
                  <td>埋め込み模型</td>
                  <td>multilingual-e5-small(384 次元)に固定。配布量の規律のため差し替えない</td>
                </tr>
                <tr>
                  <td>MMR(結果の多様化)</td>
                  <td>ベクトルが要るので未実装。順位だけでは計算できない</td>
                </tr>
                <tr>
                  <td>int8 量子化の影響</td>
                  <td>
                    このページは f32 索引の順位を使っています。量子化すると上位 10 の集合一致は
                    0.8725、Recall@10 は 0.3327 → 0.3318
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <footer>
        <p>出典:「e-Gov 法令検索」(デジタル庁)https://laws.e-gov.go.jp/</p>
        <p>上記コンテンツを条・項の単位に分割し索引化する加工を行っています(作成者による加工)。</p>
        <p>本サイトは検索技術の実験台です。掲載する条文は法的助言ではありません。</p>
      </footer>
    </>
  );
}
