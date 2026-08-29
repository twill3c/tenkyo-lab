"use client";

// 「引く」—— デモの本体(F-01 / F-03 / F-07)。
// **各段の中身をすべて開いたまま出す。** どこが retrieval でどこが generation かを、
// 隠さずに見せることがこのページの仕事である。

import { useCallback, useRef, useState } from "react";
import { runQuery, transferred, type Method, type Stages, type Hit } from "@/app-lib/engine";

const EXAMPLES = [
  "根抵当権の共有者が同意を得て権利を譲り渡す",
  "統括安全衛生責任者の業務の執行について準用する",
  "相続人が未成年者であるときの熟慮期間の起算点",
  "失火により自己の所有に係る物を焼損して公共の危険を生じさせた",
];

const METHODS: { key: Method; label: string; cost: string }[] = [
  { key: "dense", label: "密検索(意味)", cost: "追加 0MB" },
  { key: "sparse", label: "疎検索(語・BM25)", cost: "+2.44MB" },
  { key: "hybrid", label: "ハイブリッド(RRF)", cost: "+2.44MB" },
];

const fmt = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = terms.find((t) => t.length > 1 && text.startsWith(t, i));
    if (hit) {
      out.push(<mark key={i}>{hit}</mark>);
      i += hit.length;
    } else {
      const next = out.length && typeof out[out.length - 1] === "string" ? out.pop() : "";
      out.push((next as string) + text[i]);
      i += 1;
    }
  }
  return <>{out}</>;
}

export default function Hiku() {
  const [q, setQ] = useState("");
  const [method, setMethod] = useState<Method>("dense");
  const [topK, setTopK] = useState(5);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [stages, setStages] = useState<Stages | null>(null);
  const [bytes, setBytes] = useState<{ total: number; byName: Record<string, number> } | null>(null);
  const [firstDone, setFirstDone] = useState(false);
  const beforeRef = useRef(0);

  const go = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (!query || busy) return;
      setBusy(true);
      setError("");
      setStages(null);
      beforeRef.current = transferred().total;
      try {
        const s = await runQuery(query, method, topK, setStatus);
        setStages(s);
        setBytes(transferred());
        setFirstDone(true);
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
        setStatus("");
      }
    },
    [busy, method, topK]
  );

  const delta = bytes ? bytes.total - beforeRef.current : 0;
  // 問い合わせに現れる 2 文字の並び。回答のハイライトに使う
  const terms = stages
    ? [...new Set(stages.query.replace(/[、。（）()「」]/g, " ").split(/\s+/).filter((w) => w.length > 1))]
    : [];

  return (
    <>
      <h1>引く</h1>
      <p className="lead">
        質問を入れると、<strong>各段の中身がすべて開いたまま</strong>出ます。
        どこまでが検索で、どこからが回答の組み立てかを見てください。
      </p>

      <div className="card">
        <div className="row" style={{ marginBottom: "0.7rem" }}>
          <input
            type="text"
            value={q}
            placeholder="例) 根抵当権の共有者が同意を得て権利を譲り渡す"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go(q)}
            aria-label="質問"
          />
        </div>
        <div className="row">
          {METHODS.map((m) => (
            <button
              key={m.key}
              type="button"
              className="pill"
              aria-pressed={method === m.key}
              onClick={() => setMethod(m.key)}
            >
              {m.label} <span className="note">{m.cost}</span>
            </button>
          ))}
          <span className="note">上位</span>
          {[3, 5, 10].map((k) => (
            <button key={k} type="button" className="pill" aria-pressed={topK === k} onClick={() => setTopK(k)}>
              {k} 件
            </button>
          ))}
          <button type="button" onClick={() => go(q)} disabled={busy || q.trim().length === 0}>
            {busy ? "実行中…" : "引く"}
          </button>
        </div>
        <div className="row" style={{ marginTop: "0.6rem" }}>
          <span className="note">例:</span>
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              className="pill"
              onClick={() => {
                setQ(e);
                go(e);
              }}
              disabled={busy}
            >
              {e.slice(0, 18)}…
            </button>
          ))}
        </div>
        {!firstDone && (
          <p className="note" style={{ marginTop: "0.8rem" }}>
            初回の一問だけ模型と索引で約 29MB を取得します。二問目からは約 10KB です。
          </p>
        )}
        {busy && status && <p className="note" data-testid="status">{status}</p>}
        {error && <p className="warnbox" data-testid="error">{error}</p>}
      </div>

      {bytes && (
        <div className="card" data-testid="bytes">
          <h3>取得したバイト数(ブラウザの実測値)</h3>
          <p className="bytes">
            この問いで <strong>{fmt(delta)}</strong> / 開いてから累計 <strong>{fmt(bytes.total)}</strong>
          </p>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>ファイル</th>
                  <th className="num">バイト</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(bytes.byName)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([n, v]) => (
                    <tr key={n}>
                      <td className="mono">{n}</td>
                      <td className="num">{fmt(v)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {stages && (
        <div data-testid="stages">
          <h2>各段の中身</h2>

          <div className="stage">
            <div className="label">1. 問い合わせの整形と埋め込み</div>
            <p className="mono">{stages.prefixed}</p>
            <p className="note">
              e5 は「query: 」の接頭辞を要求します。外すと別の空間を向きます。
              384 次元・{stages.ms.embed.toFixed(0)}ms。先頭 8 次元:{" "}
              <span className="mono">
                {stages.vector ? [...stages.vector.slice(0, 8)].map((x) => x.toFixed(4)).join(", ") : ""}
              </span>
            </p>
          </div>

          <div className="stage">
            <div className="label">2. 検索(13,600 チャンクから上位 50 を取り、{topK} 件に絞る)</div>
            <p className="note">
              {method === "dense" && "量子化した索引に内積を取ります。"}
              {method === "sparse" && "文字バイグラムの BM25。形態素解析器は積んでいません。"}
              {method === "hybrid" && "密と疎の順位を RRF(k=60)で融合します。"}
              {stages.ms.search.toFixed(0)}ms
            </p>
            <div className="scroll">
              <table data-testid="results">
                <thead>
                  <tr>
                    <th className="num">順</th>
                    <th>条文</th>
                    <th className="num">スコア</th>
                    {method === "hybrid" && <th className="num">密</th>}
                    {method === "hybrid" && <th className="num">疎</th>}
                  </tr>
                </thead>
                <tbody>
                  {stages.shown.map((h, i) => {
                    const dRank = stages.dense.findIndex((x) => x.id === h.id);
                    const sRank = stages.sparse.findIndex((x) => x.id === h.id);
                    return (
                      <tr key={h.id}>
                        <td className="num">{i + 1}</td>
                        <td>
                          <strong>{h.lawTitle}</strong> {h.articleLabel}第{h.paragraphNum}項
                          {h.caption ? `（${h.caption}）` : ""}
                          <br />
                          <span className="mono note">{h.id}</span>
                        </td>
                        <td className="num">{h.score.toFixed(4)}</td>
                        {method === "hybrid" && <td className="num">{dRank < 0 ? "—" : dRank + 1}</td>}
                        {method === "hybrid" && <td className="num">{sRank < 0 ? "—" : sRank + 1}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="stage">
            <div className="label">3. 文脈の組み立て</div>
            <p className="note">
              上位 {stages.shown.length} 件の本文だけを HTTP Range で取りました(全文 5.22MB は取っていません)。
              合計 {stages.contextChars.toLocaleString()} 字・{stages.ms.text.toFixed(0)}ms
            </p>
          </div>

          <div className="stage">
            <div className="label">4. 回答(抽出型)</div>
            <p className="note">
              言語モデルは積んでいません。<strong>検索した条文をそのまま並べ、典拠を付けます。</strong>
              語の重なりを色で示します。要約も言い換えもしません。
            </p>
            {stages.shown.map((h, i) => (
              <div className="card" key={h.id} data-testid="answer-item">
                <p className="note">
                  典拠 {i + 1}:{h.lawTitle} {h.articleLabel}第{h.paragraphNum}項
                  {h.caption ? `（${h.caption}）` : ""}
                </p>
                <p>{h.text ? <Highlight text={h.text} terms={terms} /> : <span className="note">(本文なし)</span>}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <footer>
        <p>出典:「e-Gov 法令検索」(デジタル庁)https://laws.e-gov.go.jp/</p>
        <p>上記コンテンツを条・項の単位に分割し索引化する加工を行っています(作成者による加工)。</p>
        <p>本サイトは検索技術の実験台です。掲載する条文は法的助言ではありません。</p>
      </footer>
    </>
  );
}
