"use client";

// 「刻む」(F-02)。分割の粒度を実物と数字の両方で比べる。
// 資材は 18KB の JSON ひとつだけ —— 索引も模型も取らない。

import { useEffect, useState } from "react";

type Sample = {
  lawTitle: string;
  articleLabel: string;
  caption: string | null;
  article: string;
  paragraphs: { num: string; text: string }[];
};
type Metrics = Record<string, number | string>;
type Data = {
  counts: { paragraph: number; article: number };
  lengths: Record<string, { min: number; p50: number; p90: number; max: number; n: number }>;
  terms: { paragraph: number; article: number };
  items: { paragraph: number; article: number };
  results: Record<string, Record<string, Metrics>>;
  estimate: number;
  samples: Sample[];
};

const METRICS = ["Recall@1", "Recall@5", "Recall@10", "Recall@20", "Hit@10", "MRR", "nDCG@10"];
const num = (x: unknown) => (typeof x === "number" ? x.toFixed(4) : String(x));

export default function Kizamu() {
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState(0);

  useEffect(() => {
    fetch("/tenkyo/eval/granularity.json")
      .then((r) => {
        if (!r.ok) throw new Error(`granularity.json → ${r.status}`);
        return r.json();
      })
      .then(setD)
      .catch((e) => setErr(String(e)));
  }, []);

  const s = d?.samples[pick];

  return (
    <>
      <h1>刻む</h1>
      <p className="lead">
        同じ条文を<strong>二つの粒度で刻んで、実物と数字の両方で比べます</strong>。
        「細かく刻むほど良い」は、このコーパスでは成り立ちません。
      </p>

      {err && <p className="warnbox" data-testid="error">{err}</p>}
      {!d && !err && <p className="note">資材を取得中…</p>}

      {d && (
        <>
          <h2>同じ条文がどう切れるか</h2>
          <div className="row" style={{ marginBottom: "0.8rem" }}>
            {d.samples.map((x, i) => (
              <button key={i} className="pill" aria-pressed={pick === i} onClick={() => setPick(i)}>
                {x.lawTitle} {x.articleLabel}
              </button>
            ))}
          </div>
          {s && (
            <div data-testid="samples">
              <div className="card">
                <h3>
                  条単位 —— 1 チャンク({s.article.length} 字)
                </h3>
                <p className="note">
                  {s.lawTitle} {s.articleLabel}
                  {s.caption ? `（${s.caption}）` : ""}
                </p>
                <p>{s.article}</p>
              </div>
              <div className="card">
                <h3>項単位 —— {s.paragraphs.length} チャンク</h3>
                {s.paragraphs.map((p) => (
                  <div key={p.num} className="stage">
                    <div className="label">
                      第 {p.num} 項({p.text.length} 字)
                    </div>
                    <p>{p.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className="note">
            条単位は前後の文脈が付いてくる代わりに、当たったときに<strong>読む量が増えます</strong>。
            項単位はその逆で、短く出せる代わりに<strong>条の後半だけを渡してしまう</strong>ことがあります。
          </p>

          <h2>どちらが引きやすいか</h2>
          <div className="scroll">
            <table data-testid="granularity">
              <thead>
                <tr>
                  <th>粒度 / 手法</th>
                  {METRICS.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["paragraph", "article"] as const).map((g) =>
                  ["dense", "sparse", "hybrid"].map((m) => (
                    <tr key={`${g}-${m}`}>
                      <td>
                        {g === "paragraph" ? "項単位" : <strong>条単位</strong>} ·{" "}
                        {m === "dense" ? "密" : m === "sparse" ? "疎" : "融合"}
                      </td>
                      {METRICS.map((k) => (
                        <td key={k} className="num">
                          {num(d.results[g][m][k])}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2>分かったこと</h2>
          <p>
            <strong>粗いほうが引きやすい。</strong>密検索の Recall@10 は
            項単位 {num(d.results.paragraph.dense["Recall@10"])} に対し、
            条単位 <strong>{num(d.results.article.dense["Recall@10"])}</strong> です。
            チャンクの数は半分以下(13,600 → 6,239)になるのに、当たる割合は上がります。
          </p>
          <p>
            <strong>そして勝つ手法が入れ替わります。</strong>
            項単位では密 {num(d.results.paragraph.dense["Recall@10"])} 対 疎{" "}
            {num(d.results.paragraph.sparse["Recall@10"])} でほぼ互角でしたが、
            条単位では疎が <strong>{num(d.results.article.sparse["Recall@10"])}</strong> で
            密を 8 ポイント上回ります。
            <strong>チャンクを長くすると、語の検索のほうが有利になる</strong> ——
            当たり前のようですが、粒度を変えずに手法だけ比べていたら見えません。
          </p>
          <p>
            融合の上積みも縮みます。項単位では単独の最良に対して +0.037 でしたが、
            条単位では <strong>+0.005</strong> しかありません。
            <a href="/kiita/">片方が強いと RRF の利点が消える</a>のは、法令別に見たときと同じ形です。
          </p>

          <div className="warnbox" data-testid="correction">
            <strong>この数字は、以前このサイトに書いていたものと違います。</strong>
            当初は「条単位にすると 0.4938」と書いていました。これは
            <strong>項単位の順位を条に丸めた推定値</strong>で、条単位の索引で直接測ると{" "}
            <strong>{num(d.results.article.dense["Recall@10"])}</strong> です。
            推定は 0.037(相対 7.4%)甘く出ていました。
            <strong>丸めた推定と、粒度を変えて測り直したものは別物です。</strong>
          </div>

          <h2>刻み方の内訳</h2>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>粒度</th>
                  <th className="num">チャンク</th>
                  <th className="num">最小</th>
                  <th className="num">中央</th>
                  <th className="num">p90</th>
                  <th className="num">最大</th>
                  <th className="num">語(疎索引)</th>
                </tr>
              </thead>
              <tbody>
                {(["paragraph", "article"] as const).map((g) => (
                  <tr key={g}>
                    <td>{g === "paragraph" ? "項単位" : "条単位"}</td>
                    <td className="num">{d.counts[g].toLocaleString()}</td>
                    <td className="num">{d.lengths[g].min}</td>
                    <td className="num">{d.lengths[g].p50}</td>
                    <td className="num">{d.lengths[g].p90}</td>
                    <td className="num">{d.lengths[g].max}</td>
                    <td className="num">{d.terms[g].toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">
            問いは両方で同じ {d.items.article.toLocaleString()} 問です。問い合わせの埋め込みも
            使い回しています —— 問いが同じなら問いのベクトルも同じで、変わるのは索引側だけだからです。
            正解と「出題元の除外」だけを条へ写し替え、
            <strong>循環の禁止の条件が粒度を変えても保たれていること</strong>を全問で確かめています。
          </p>

          <h2>ここで扱っていない刻み方</h2>
          <p>
            固定長で切る・重なりを持たせる・章単位でまとめる、といった刻み方は
            <strong>実装していません</strong>。それぞれ索引を作り直す必要があり、
            1 通りあたり 3〜6 時間かかります。
            <strong>やっていないことを「効果がなかった」とは書きません。</strong>
          </p>
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
