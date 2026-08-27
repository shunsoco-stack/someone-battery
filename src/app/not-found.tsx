import Link from "next/link";
import { Battery } from "lucide-react";

export default function NotFound() {
  return (
    <main className="fallback-page">
      <Battery size={72} aria-hidden="true" />
      <p className="eyebrow">404 / A LITTLE DETOUR</p>
      <h1>ここには、充電がないみたい。</h1>
      <p>ひとつ戻って、誰かの残量に会いにいきましょう。</p>
      <Link className="button button-primary" href="/">
        誰かの充電へ戻る
      </Link>
    </main>
  );
}
