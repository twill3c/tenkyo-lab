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
      </body>
    </html>
  );
}
