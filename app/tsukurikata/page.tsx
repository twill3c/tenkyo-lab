// 「作り方」(F-10)。パイプラインの実装解説。
// 静的な文章なので client にしない —— 索引も模型も要らない。

export const metadata = { title: "作り方 — 典拠ラボ" };

export default function Tsukurikata() {
  return (
    <>
      <h1>作り方</h1>
      <p className="lead">
        このアプリがどう組まれているか。<strong>数字はすべて実測です</strong>。
        見積りを書いた箇所は「見積り」と明記しています。
      </p>

      <h2>1. 素材 —— 法令 26 本</h2>
      <p>
        e-Gov 法令検索の法令 API から主要法令 26 本を取得しました。題名からの推定で確定せず、
        <strong>API で題名を検索して完全一致した場合だけ</strong>採録しています(0 件・複数件は採らない)。
      </p>
      <div className="scroll">
        <table>
          <tbody>
            <tr><td>法令</td><td className="num">26 本</td></tr>
            <tr><td>本則の条</td><td className="num">6,239</td></tr>
            <tr><td>チャンク(条の項)</td><td className="num">13,600</td></tr>
            <tr><td>索引本文の長さ 中央値 / p90</td><td className="num">92 字 / 235 字</td></tr>
            <tr><td>除外した附則の条</td><td className="num">2,131</td></tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        附則は改正経過にひもづく時限規定が多く、参照構造が本則と別物になるので採っていません。
        黙って捨てず件数を数えています。
      </p>

      <h2>2. 正解をどう作ったか —— 条項参照オラクル</h2>
      <p>
        RAG の練習でいちばん足りないのは<strong>コーパスではなく正解</strong>です。
        人手のラベルは高く、言語モデルに正解を作らせると循環します。
      </p>
      <p>
        法令には内部参照が大量に書かれています。「第十七条第一項の規定は…準用する」。
        <strong>この文を問い、参照先の条文を正解にすれば、人手ゼロで正解が作れます。</strong>
        しかも一意です。
      </p>
      <h3>循環の禁止を三重に置いた</h3>
      <ol>
        <li>
          <strong>問いから参照の文字列そのものを消す。</strong>
          消さないと、語が一致するだけで当たってしまいます
        </li>
        <li>
          <strong>出題元の条文を検索結果から外す。</strong>
          問いは出題元の本文の一部なので、外さないと出題元が必ず 1 位に来ます。それは正解ではありません
        </li>
        <li><strong>自分の条への参照は捨てる。</strong>課題として成立しません</li>
      </ol>
      <p>
        <strong>選別の条件は「問いだけを見て」決めています。</strong>
        「正解の条文と語が重なるか」で選ぶと、答えを問いに埋め込むことになります。
        その副作用(語で引ける問題に偏る)は別に検算しました —— 疎検索が上位 10 に正解を
        1 件も入れられない問題が <strong>61.8%</strong> 残っており、偏っていません。
      </p>
      <h3>作った問いより、捨てた問いのほうが多い</h3>
      <div className="scroll">
        <table>
          <thead><tr><th>捨てた理由</th><th className="num">件</th></tr></thead>
          <tbody>
            <tr><td>他法令への参照</td><td className="num">1,114</td></tr>
            <tr><td>参照が文の 3 割以上を占める(列挙条文)</td><td className="num">833</td></tr>
            <tr><td>一文の参照が 4 件以上(列挙条文)</td><td className="num">710</td></tr>
            <tr><td>記号を除いた実質が 25 字未満</td><td className="num">183</td></tr>
            <tr><td>識別力のある語が残らない</td><td className="num">396</td></tr>
            <tr><td>その他(過短・自条・参照先不在)</td><td className="num">115</td></tr>
            <tr><td><strong>採用</strong></td><td className="num"><strong>2,808</strong></td></tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        相対参照(前項 3,317 / 前条 1,355 / 同項 1,456 ほか計 8,827)は文脈の解決が要るので使っていません。
      </p>

      <h2>3. 索引 —— 密と疎</h2>
      <h3>密(意味)</h3>
      <p>
        multilingual-e5-small(384 次元)で 13,600 チャンクを埋め込みました。
        <strong>e5 は接頭辞を要求します</strong> —— 索引側は <span className="mono">passage: </span>、
        問い合わせ側は <span className="mono">query: </span>。ここを間違えると別の空間を向きます
        (どれくらい壊れるかは<a href="/kiita/">効いた・効かなかった</a>に実測を置きました)。
      </p>
      <p>
        f32 では 19.9MB あるので <strong>int8 に落として 4.98MB</strong> にしています。
        全体を一律に 127 倍すると壊れます —— e5 のスコアは狭い範囲に固まっており、
        丸め誤差が散らばりに対して大きくなるためです。
        <strong>次元ごとに中心 μ と幅 s を取り、s を問い合わせ側へ畳み込みます。</strong>
        定数項は全チャンク共通なので順位に効かず、捨てられます。
      </p>
      <h3>疎(語)</h3>
      <p>
        <strong>形態素解析器を積んでいません。</strong>kuromoji の辞書は 15MB あり、配布量の規律と
        正面衝突します。代わりに<strong>文字バイグラムの BM25</strong> を使いました。
        日本語の全文検索は文字 n-gram で実用になります —— それ自体がこのアプリの教材です。
      </p>
      <p>
        <strong>記号で区切ってから切ります。</strong>除去してから切ると、読点をまたいで
        「あい、うえ」から「いう」という実在しない語ができます。この語は稀なので
        「識別力がある」と誤判定され、BM25 では偽の一致を生みます。
      </p>
      <p className="note">
        語 26,448 / ポスティング 1,080,280。素朴に持つと 5.2MB ですが、文書番号を昇順に並べて
        差分を取り可変長整数で詰めると <strong>2.21MB</strong>(gzip 1.08MB)になります。
      </p>

      <h2>4. 配る —— 段取りを分ける</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>いつ</th><th>何を</th><th className="num">量</th></tr></thead>
          <tbody>
            <tr><td>トップページ</td><td><strong>索引を 1 バイトも取らない</strong></td><td className="num">0</td></tr>
            <tr><td>一問目</td><td>模型 + 実行系 + 密索引</td><td className="num">48.48MB</td></tr>
            <tr><td>つまみ</td><td>疎索引(疎・ハイブリッドを選んだときだけ)</td><td className="num">2.44MB</td></tr>
            <tr><td>結果表示</td><td>条文の一節だけ(HTTP Range)</td><td className="num">数 KB</td></tr>
            <tr><td>二問目以降</td><td>問い合わせの埋め込みと条文の一節だけ</td><td className="num">10.7KB</td></tr>
          </tbody>
        </table>
      </div>
      <h3>模型を三分の一に刈った</h3>
      <p>
        multilingual-e5-small は 112.8MB のうち大半が語彙表です。XLM-R の 250,002 語には
        世界中の文字が入っていますが、このアプリが要るのは日本語と短い ASCII だけ。
        <strong>使わない行を落として 23,421 語(9.4%)にし、模型は 29.8MB、語彙表は 1.0MB</strong> に
        なりました。量子化はテンソル全体で 1 つの倍率なので、行を抜き出すだけで済みます。
      </p>
      <p className="note">
        長さで機械的に切ると <span className="mono">query: </span> の接頭辞のトークンまで落ちるので、
        元のトークナイザに実際に聞いて「必ず残す 263 トークン」を名指ししています。
        刈った模型が刈る前と同じベクトルを出すことは、実際の問い 16 件で確かめました
        (最悪でも一致度 0.999999。<strong>1 問ずつ通して</strong>測ります —— まとめて通すと
        詰め物の量が食い違い、模型の差でないものが差に見えます)。
      </p>
      <h3>実行系は WebGPU 版を積まない</h3>
      <p>
        onnxruntime の既定は WebGPU 込みで 24.89MB あります。このアプリは一問ごとに短い列を
        一本通すだけなので、wasm 専用の束に寄せて <strong>12.34MB</strong> にしました。
        <strong>控えとして WebGPU 版を置く手は採っていません</strong> ——
        置けば、寄せ替えが壊れたときに黙って倍の量が配られます。置かなければ壊れたと分かります。
      </p>

      <h2>5. 測る —— 何と何を突き合わせたか</h2>
      <p>
        「テストが緑」と「実際に動く」は別物です。次の照合を置いています。
      </p>
      <div className="scroll">
        <table>
          <thead><tr><th>照合</th><th>中身</th><th>結果</th></tr></thead>
          <tbody>
            <tr>
              <td>二実装照合</td>
              <td>
                検索を Python で独立に書き下し、分かち書き(全 13,600 チャンク + 全 2,808 問)・
                疎索引(語 26,448 の並びと文書頻度)・順位 240 件を突き合わせる
              </td>
              <td>完全一致。密検索の最上位スコアは<strong>ビット一致</strong></td>
            </tr>
            <tr>
              <td>詰めた索引の往復</td>
              <td>可変長整数・id の復元・疎索引 200 問・int8 のバイト一致・Range で切った本文 300 件</td>
              <td>完全一致</td>
            </tr>
            <tr>
              <td>実ブラウザ 対 Node</td>
              <td>同じ配布物を使って上位 10 件を比べる</td>
              <td>完全一致</td>
            </tr>
            <tr>
              <td>「測る」の指標</td>
              <td>詰めた順位から計算した値が評価器と一致するか</td>
              <td>小数点以下 12 桁まで一致</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        Python 側は <strong>numpy の内積を使っていません</strong>。BLAS は加算の順を変えるので、
        最終桁が食い違います。float32 を float64 に広げて先頭から順に足し、JS と演算順を揃えています。
      </p>

      <h2>6. 使っている部品</h2>
      <div className="scroll">
        <table>
          <tbody>
            <tr><td>枠組み</td><td>Next.js(静的書き出しのみ。<strong>サーバ関数を一つも持たない</strong>)</td></tr>
            <tr><td>埋め込み</td><td>Transformers.js + onnxruntime-web(wasm・単スレッド)</td></tr>
            <tr><td>模型</td><td>Xenova/multilingual-e5-small(語彙を刈ったもの)</td></tr>
            <tr><td>疎検索</td><td>自前(文字バイグラムの Okapi BM25)</td></tr>
            <tr><td>言語モデル</td><td><strong>積んでいません。</strong>回答は条文の抽出です</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>外部の API を一つも呼びません。</strong>閲覧時の通信はすべて同一オリジンで、
        実ブラウザで 0 件を確認しています。
      </p>

      <footer>
        <p>出典:「e-Gov 法令検索」(デジタル庁)https://laws.e-gov.go.jp/</p>
        <p>上記コンテンツを条・項の単位に分割し索引化する加工を行っています(作成者による加工)。</p>
        <p>本サイトは検索技術の実験台です。掲載する条文は法的助言ではありません。</p>
      </footer>
    </>
  );
}
