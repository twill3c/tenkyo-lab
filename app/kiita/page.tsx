// 「効いた・効かなかった」(F-09)。実測の記録。
// **通説が壊れた場所と、落ちたゲートを隠さずに置く。**

export const metadata = { title: "効いた・効かなかった — 典拠ラボ" };

export default function Kiita() {
  return (
    <>
      <h1>効いた・効かなかった</h1>
      <p className="lead">
        測って分かったことを、<strong>効かなかったものも含めて</strong>置きます。
        数字はすべて 2,808 問の実測です。
      </p>

      <h2>通説が壊れた三か所</h2>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>よく言われること</th>
              <th>実測</th>
              <th>判定</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>意味検索(密)は語の検索(BM25)に勝つ</td>
              <td>密 0.3327 / 疎 <strong>0.3374</strong></td>
              <td><strong>壊れた。</strong>ほぼ互角で、むしろ BM25 が上</td>
            </tr>
            <tr>
              <td>両方混ぜれば勝つ</td>
              <td>融合 <strong>0.3740</strong>(k を 1〜1000 まで振っても負けない)</td>
              <td>全体では成立</td>
            </tr>
            <tr>
              <td>同上(法令ごとに見ると)</td>
              <td>17 法令中 <strong>2 法令で融合が単独に負ける</strong></td>
              <td><strong>壊れた</strong></td>
            </tr>
            <tr>
              <td>細かく刻むほど良い</td>
              <td>密は項単位 0.3327 / 条単位 <strong>0.4572</strong></td>
              <td><strong>壊れた。</strong>粗いほうが良い</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="note">Recall@10(上位 10 件に正解が入った割合)の全問平均。</p>

      <h3>ハイブリッドが負けるのはどういうときか</h3>
      <div className="scroll">
        <table>
          <thead>
            <tr><th>法令</th><th className="num">問</th><th className="num">密</th><th className="num">疎</th><th className="num">融合</th><th className="num">差</th></tr>
          </thead>
          <tbody>
            <tr><td><strong>個人情報の保護に関する法律</strong></td><td className="num">106</td><td className="num"><strong>0.392</strong></td><td className="num">0.325</td><td className="num">0.358</td><td className="num"><strong>−0.033</strong></td></tr>
            <tr><td><strong>民事訴訟法</strong></td><td className="num">162</td><td className="num">0.254</td><td className="num"><strong>0.344</strong></td><td className="num">0.341</td><td className="num"><strong>−0.003</strong></td></tr>
            <tr><td>不正競争防止法</td><td className="num">34</td><td className="num">0.382</td><td className="num">0.412</td><td className="num"><strong>0.515</strong></td><td className="num">+0.103</td></tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>片方が明らかに強いとき、RRF はそれを平均して引き下げます。</strong>
        個人情報保護法では密検索が疎検索を 7 ポイント上回っており、融合すると密の単独に 3 ポイント負けます。
        「ハイブリッドにしておけば安全」は全体平均では正しく、<strong>部分集合では正しくありません</strong>。
      </p>
      <p className="note">
        つまみを回して自分で確かめられます → <a href="/hakaru/">測る</a>
      </p>

      <h2>目標に届かなかった三本</h2>
      <p>
        較正の線は<strong>測る前に置き、一本も下げていません</strong>。届かなかったものはそのまま出します。
      </p>
      <div className="scroll">
        <table>
          <thead><tr><th>線</th><th className="num">目標</th><th className="num">実測</th><th>なぜ下げなかったか</th></tr></thead>
          <tbody>
            <tr>
              <td>密検索の Recall@10</td>
              <td className="num">0.50</td>
              <td className="num"><strong>0.3327</strong></td>
              <td>
                計器を先に疑いました —— ベクトルのノルムは全 13,600 行で 1.000、
                自分自身を引く対照は 300/300、id の並びも照合済み。
                <strong>索引は健全で、これは本物の結果です</strong>
              </td>
            </tr>
            <tr>
              <td>語の検索の自己一致</td>
              <td className="num">1.0</td>
              <td className="num"><strong>0.9960</strong></td>
              <td>
                外れ 2 件は <strong>2〜3 文字しか違わない準重複の条文</strong>で、BM25 の長さ正規化が
                短いほうを上に置いています。実装は正しい
              </td>
            </tr>
            <tr>
              <td>量子化の順位保存</td>
              <td className="num">0.95</td>
              <td className="num"><strong>0.8725</strong></td>
              <td>
                線を<strong>別プロジェクトから借りたが、同じ文言で測り方が違っていました</strong>。
                借り元と同じ測り方なら 0.9872。<strong>それでも定義を合わせ直しません</strong> ——
                事後の線の変更と区別がつかなくなるからです
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>借りた線が測り方まで借りられていなかった話</h3>
      <p>
        量子化の線 0.95 は、同じ模型・同じ手法を使った別プロジェクトの実測 98.2% から借りました。
        仕様の文言(「上位 10 件の集合一致率」)まで写したのに、実装が割れました。
        この日本語が<strong>「集合が完全に一致した問いの割合」とも「1 問ごとの重なり比率の平均」とも読める</strong>からです。
      </p>
      <p>
        気づいた手がかりは算術でした。<strong>借り元は 40 問で 98.2%。40 × 0.982 = 39.28 は整数になりません。</strong>
        「該当した問いの割合」なら分母 40 の分数になるはずです。ならないなら比率の平均です。
        この検算は一行で済み、借りた時点でできました。
      </p>

      <h2>接頭辞を間違えると何が起きるか</h2>
      <p>
        e5 系の模型は「これは問い合わせか、収録文か」を接頭辞で区別します。
        索引側は <span className="mono">passage: </span>、問い合わせ側は <span className="mono">query: </span>。
        <strong>間違えるとどれくらい落ちるかを測りました。</strong>
      </p>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>問い合わせ側の接頭辞</th>
              <th className="num">Recall@10</th>
              <th className="num">落ち幅</th>
              <th className="num">最上位スコアの平均</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="mono">query: </span>(正しい使い方)</td>
              <td className="num"><strong>0.3327</strong></td>
              <td className="num">—</td>
              <td className="num">0.9219</td>
            </tr>
            <tr>
              <td>なし</td>
              <td className="num">0.3155</td>
              <td className="num">−5.2%</td>
              <td className="num">0.9343</td>
            </tr>
            <tr>
              <td><span className="mono">passage: </span>(索引側と同じものを付けた)</td>
              <td className="num">0.2800</td>
              <td className="num"><strong>−15.8%</strong></td>
              <td className="num"><strong>0.9361</strong></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        <strong>間違えたほうがスコアは高く出ます。</strong>
        精度は落ちているのに、最上位のスコアは <span className="mono">0.9219 → 0.9361</span> と上がりました。
        <strong>スコアが高いことは、当たっていることを意味しません。</strong>
        「類似度が 0.93 もあるから合っている」という読み方が、ここで崩れます。
      </p>
      <p className="note">
        <strong>何を変えて何を変えていないか</strong>:索引側は <span className="mono">passage: </span> のまま固定し、
        問い合わせ側の接頭辞だけを変えています。索引ごと作り直すのが完全な比較ですが 5 時間かかり、
        そして実際に人が間違えるのは問い合わせ側です(索引は一度作れば触りませんが、問い合わせは書くたびに書きます)。
        MRR はこの表では上位 10 件までで計算しており、他の表(上位 50 件まで)の値とは揃いません。
      </p>
      <p className="note">
        落ち幅は −5% から −16% で、「外すと壊滅する」ほどではありませんでした。
        <strong>そう書いてある文章もありますが、このコーパスではそこまで落ちません。</strong>
        別プロジェクトで「外すと日本語まで壊れる」と記録されているのは、
        語彙を刈るときに接頭辞のトークンごと落としてしまった場合の話で、これとは別の故障です。
      </p>

      <h2>効いた工夫</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>やったこと</th><th>効果</th></tr></thead>
          <tbody>
            <tr>
              <td>量子化を<strong>次元ごと</strong>にした(全体一律にしない)</td>
              <td>上位 10 の集合一致 0.7521 → <strong>0.8725</strong>。配布量は同じ 4.98MB</td>
            </tr>
            <tr>
              <td>ポスティングを差分 + 可変長整数で詰めた</td>
              <td>5.2MB → <strong>2.21MB</strong>(gzip 1.08MB)</td>
            </tr>
            <tr>
              <td>模型の語彙を刈った</td>
              <td>112.8MB → <strong>29.8MB</strong>、語彙表 16.3MB → 1.0MB。一致度は 0.999999 を保つ</td>
            </tr>
            <tr>
              <td>実行系を WebGPU 抜きに寄せた</td>
              <td>24.89MB → <strong>12.34MB</strong></td>
            </tr>
            <tr>
              <td>上位 k の選抜を全件ソートからヒープに変えた</td>
              <td>2,808 問 × 13,600 件が現実的な時間に。<strong>全件ソートと完全一致することを確認済み</strong></td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>効かなかった・捨てたもの</h2>
      <div className="scroll">
        <table>
          <thead><tr><th>捨てたもの</th><th>なぜ</th></tr></thead>
          <tbody>
            <tr>
              <td>列挙条文から作った問い <strong>1,726 問</strong></td>
              <td>
                罰則・読替・準用の列挙は文のほとんどが参照でできており、参照を消すと
                「）若しくは（において準用する場合を含む。」しか残りません。<strong>人にも答えられません</strong>
              </td>
            </tr>
            <tr>
              <td>「そのチャンクが 1 位」という対照</td>
              <td>
                本文が完全に重複するチャンクが <strong>439 件</strong>(「削除」だけで 71 件)あり、
                <strong>原理的に満たせない</strong>対照でした。「同一本文のチャンクが 1 位」に書き直しました
              </td>
            </tr>
            <tr>
              <td>形態素解析器(kuromoji)</td>
              <td>辞書が 15MB。文字バイグラムで足りることを確かめて積みませんでした</td>
            </tr>
            <tr>
              <td>WebGPU 版の実行系を「控え」として置くこと</td>
              <td>
                置けば、寄せ替えが壊れたときに<strong>黙って倍の量が配られます</strong>。
                置かなければ壊れたと分かります
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>計器のほうが壊れていた話</h2>
      <p>
        測った結果より、<strong>測る道具が壊れていた回数のほうが多い</strong>のが実情でした。
      </p>
      <div className="scroll">
        <table>
          <thead><tr><th>何が起きたか</th><th>どう気づいたか</th></tr></thead>
          <tbody>
            <tr>
              <td>
                条文を平坦化して「第○条」を拾うと、<strong>その条自身の番号を参照として数えていた</strong>
              </td>
              <td>抽出器を書く前の予備計測で、候補の上位 2 件がどちらも自己参照だった</td>
            </tr>
            <tr>
              <td>
                自動生成した問いの妥当率が <strong>85%</strong> で目標 90% に届かなかった
              </td>
              <td>
                100 問を目視した。失敗が無作為でなく<strong>一つの型に集中</strong>していた。
                除外条件を組み直して 91%
              </td>
            </tr>
            <tr>
              <td>
                出荷物に <strong>22.48MB</strong> の要らない実行系が混ざっていた
              </td>
              <td>
                組み上がった束を検査していた。<strong>ローカルで起動しても動いてしまう</strong>ので
                触っても気づけない
              </td>
            </tr>
            <tr>
              <td>
                つまみのボタンが<strong>白背景に白文字</strong>で読めなくなっていた
              </td>
              <td>
                一度<strong>見落としました</strong>。画面が変だと気づいたのに、
                DOM を見て「文字はある」で済ませた。<strong>DOM は色を見ません</strong>。
                いまは前景色と背景色の明るさの比を機械で測っています
              </td>
            </tr>
            <tr>
              <td>
                照合器の <span className="mono">join(&quot;&quot;)</span> に<strong>見えない制御文字</strong>が紛れ、
                二実装照合が偽の不一致を出した
              </td>
              <td>
                ソースを開いても検索しても見えず、バイト単位で表示して初めて見えた。
                いまは制御文字の混入をテストで見張っています
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </>
  );
}
