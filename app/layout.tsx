import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "典拠ラボ — RAG の解剖台",
  description:
    "RAG の検索パイプラインを段ごとに開き、つまみを回して指標の動きをその場で測る実験台。法令 26 本・13,600 チャンク。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <nav className="top">
          <div>
            <strong>典拠ラボ</strong>
            <a href="/">はじめに</a>
            <a href="/hiku/">引く</a>
            <a href="/kizamu/">刻む</a>
            <a href="/hakaru/">測る</a>
            <a href="/kiita/">効いた・効かなかった</a>
            <a href="/tsukurikata/">作り方</a>
          </div>
        </nav>
        <main>{children}</main>
        <div className="attrib">
          <p>出典:「e-Gov 法令検索」(デジタル庁)https://laws.e-gov.go.jp/</p>
          <p>
            上記コンテンツを条・項の単位に分割し、検索用の索引を作成する加工を行っています。
            加工は本サイトの作成者によるものであり、国が作成したものではありません。
          </p>
          <p>
            本サイトは検索技術の実験台です。<strong>掲載する条文は法的助言ではありません。</strong>
            条文の内容は取得時点のものです。
          </p>
        </div>
        {/* fleet: fixed footer */}
        <footer className="fleet">
          <span>MIT License © 2026 坂田哲朗</span>
          <a href="https://github.com/twill3c/tenkyo-lab" target="_blank" rel="noopener">GitHub</a>
          <a href="https://claude.ai/code/artifact/f7cc1a9c-1236-4425-b9f6-b99087f6a7fc" target="_blank" rel="noopener">典拠ラボの歩き方</a>
          <a href="https://claude.ai/code/artifact/7295b03e-9c89-4faf-9780-011515639650" target="_blank" rel="noopener">典拠ラボの設計図</a>
          <a href="https://app-menu-amber.vercel.app/" target="_blank" rel="noopener">App Menu</a>
        </footer>
      </body>
    </html>
  );
}
