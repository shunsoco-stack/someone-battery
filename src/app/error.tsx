"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="fallback-page">
      <p className="eyebrow">LET’S TAKE A BREATH</p>
      <h1>うまく読み込めませんでした。</h1>
      <p>
        少し待って、もう一度お試しください。エラーをデモデータで置き換えることはありません。
      </p>
      <button className="button button-primary" onClick={reset}>
        もう一度読み込む
      </button>
    </main>
  );
}
