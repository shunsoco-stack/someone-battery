# リリース検証記録

実行日: 2026-08-27（Asia/Tokyo）

この記録は「実装済み」「実行成功」「未実行」を区別します。未確認の本番接続や外部設定を、ローカルのテスト成功から推測しません。

公開先: [誰かの充電](https://someone-battery.vercel.app)。初回VercelデプロイはREADY、公開モードはFirebase未設定の明示デモです。公開E2Eは通常操作19件とPWA専用1件が成功し、公開URLのスクリーンショット5枚を取得・目視確認しました。以下は確認できた実行結果であり、最終Git履歴スキャンを先に成功扱いにはしていません。

## 機械的な検証

| 検証 | コマンド / 方法 | 状態 | 証跡・備考 |
| --- | --- | --- | --- |
| Secret Scanの自己テスト | `node scripts/secret-scan.mjs --self-test` | 成功 | 15種類の陽性例、6つの安全な例、行番号・出力の非機密性・公開禁止パスを検証 |
| Secret Scan | `npm run secret-scan` | 作業ツリー成功・最終再実行待ち | 公開前の作業ツリー67ファイル、index 0件、history 0件で検出なし。最終ステージ内容とコミット後の到達可能履歴は再実行待ち |
| Lint | `npm run lint` | 成功 | アプリ全体のESLint検査成功 |
| TypeScript | `npm run typecheck` | 成功 | Next.js型生成と`tsc --noEmit`成功 |
| Unit tests | `npm test` | 成功 | 5ファイル、150 / 150件成功 |
| Firestore Rules / SDK | `npm run test:rules` | 成功 | 2ファイル、43 / 43件成功。Java 21 + ローカルエミュレーター。本番DB未使用 |
| ローカルE2E | `npm run test:e2e` | 成功 | Chromium、19 / 19件成功。デモで実行 |
| 公開E2E | 公開URLを`PLAYWRIGHT_BASE_URL`に指定 | 成功 | 通常操作19 / 19件成功（19.9秒）。公開されたデモで実行 |
| 公開PWA | `PLAYWRIGHT_TEST_PWA=1`で`tests/e2e/pwa.spec.ts`を実行 | 成功 | 1 / 1件成功（4.0秒）。通常のローカル開発サーバーではこの専用テストはskip |
| アクセシビリティ自動検査 | E2E内のaxe | 成功 | ダーク／ライト × トップ・低残量・投稿・完了の8状態、検出違反0件 |
| Production build | `npm run build` | 成功 | Next.js 16.3.3の本番ビルド成功 |
| GitHub Actions | `.github/workflows/ci.yml` | 実装済み・未実行 | 公開後にworkflow runで確認 |
| 本番依存の脆弱性照会 | `npm audit --omit=dev --audit-level=high` | 成功 | npm公式レジストリへ照会し、0 vulnerabilities（開発依存はこの結果に含めない） |

## 画面・動作の確認

| 検証 | 状態 | 証跡・備考 |
| --- | --- | --- |
| トップ、ランダム表示、相対時刻 | ローカル・公開成功 | E2Eでデモの明示、残量表示、相対時刻を確認 |
| 低残量の心配演出・100%の称賛 | ローカル・公開成功 | 8%／100%のデモ状態をE2Eで確認 |
| 投稿・範囲外入力拒否・完了画面 | ローカル・公開成功 | 0／100の投稿、負数・100超・小数・空入力の拒否、ブラウザー内デモ完了を確認 |
| デモ表示と実データの分離 | ローカル・公開成功 | E2Eとユニットテスト。デモ操作でFirebase通信0件、本番Firebase接続は未検証 |
| 空データ・設定不備・通信失敗 | ロジック検証成功 | ユニットテストで空・不備・失敗を区別。実Firebaseに接続した画面は未検証 |
| 履歴の端末内保存・削除 | ローカル・公開成功 | 再読み込み後の保存・削除、24時間後の表示／履歴除外をE2Eで確認 |
| 共有・共有キャンセル | ローカル・公開成功 | コピー代替、デモ文言、クエリーを含めないURL、キャンセル、手動コピー案内を確認 |
| ダークモード・モバイル表示 | ローカル・公開成功 | テーマの保存、320px／390pxでの横はみ出しなしを確認 |
| キーボード・フォーカス・コントラスト | ローカル・公開成功 | スライダー端点、ダイアログ内フォーカス、Esc復帰、axe検査。自動検査でアクセシビリティ全体を保証するものではない |
| reduced motion | 実装済み・設定下でE2E成功 | E2Eは`reducedMotion: reduce`で実行。動きの快適さを含む人による評価は別途必要 |
| manifest・アイコン・OG画像 | ローカル・公開成功 | manifestの項目・アイコンとOG等の配信をE2Eで確認 |
| サービスワーカー・オフライン | 公開成功 | SWのactivated／ページ制御、オフライン遷移時の`offline.html`表示、オンライン復帰と履歴保持を確認 |

公開PWA検査では、CacheStorageが`/favicon.svg`、`/icon-192.png`、`/icon-512.png`、`/offline.html`の4静的資産のみであることを確認しました。トップページの取得、Analytics APIへのPOST（202 / `no-store`）とGET（405）、オフライン／オンライン遷移の後も、API・投稿・認証・HTMLドキュメントのキャッシュはありません。計測APIへのPOSTは検査のための直接リクエストであり、停止中のブラウザー計測やVercelでのイベント収集を意味しません。

上記E2Eの「投稿成功」はブラウザー内のデモ投稿です。Firestore Emulatorの成功も、インターネット上のFirebaseプロジェクトへ送信したことを示しません。

## 公開状態

| 項目 | 状態 | 証跡・備考 |
| --- | --- | --- |
| GitHub公開リポジトリ | 作成成功・初回push待ち | [shunsoco-stack/someone-battery](https://github.com/shunsoco-stack/someone-battery)。コードの公開とActions実行確認は未完了 |
| Vercel公開アプリ | 初回デプロイ成功 | [someone-battery.vercel.app](https://someone-battery.vercel.app)、READY |
| 公開URLのE2E / PWA | 成功 | 通常操作19件＋PWA専用1件、合計20件成功 |
| 本番Firebase | 未接続・外部制約 | GCPの新規プロジェクト作成上限により作成できず。既存の別アプリのプロジェクトは流用せず、公開版は明示デモ |
| Firestore TTL | 設定手順のみ | 本番プロジェクトへ設定した証跡がなければ有効化済みとしない |
| Vercel Analytics | 実装済み・収集停止 | Hobbyはカスタムイベント非対応。`NEXT_PUBLIC_ANALYTICS_ENABLED=false`が既定で、クライアントfetchとサーバー中継を停止。プラン変更・課金有効化なし |
| 公開URLからのスクリーンショット5枚 | 取得・目視確認済み | `public/screenshots/`の`01-top.png`、`02-someone-battery.png`、`03-low-battery.png`、`04-post.png`、`05-complete.png`。READMEに埋め込み |
| Tsukutta掲載 | 未掲載 | 投稿文の作成と実際の掲載を区別 |

## 完了していない外部設定と公開確認

- GitHubへの初回コードpushと公開後のGitHub Actions runの確認。
- 最終ステージ内容／コミット履歴を含むSecret Scan。
- 新規Firebaseプロジェクト、匿名認証、Firestore Rules適用、TTL、別ブラウザー間の実投稿送受信。
- Analytics対応プラン、ダッシュボードの有効化、計測フラグ`true`での再デプロイ、実際の受信確認。

`/api/analytics`の202やSDKの`track()`完了は、Vercelでのイベント収集成功を示しません。現在は収集そのものを無効にしています。FirebaseやAnalyticsの実運用開始には、所有者による外部設定・費用の確認が必要です。

Secret Scanの検出範囲と限界は [SECURITY.md](SECURITY.md) を参照してください。

Secret Scanは検出パターンの範囲で秘密情報が見つからなかったことを示し、漏えいゼロの保証ではありません。本番依存の脆弱性照会も実行時点の結果であり、開発依存や将来の検出結果は含みません。
