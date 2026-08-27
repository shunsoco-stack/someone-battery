# Security & privacy

## アプリが扱う情報

「誰かの充電」は、利用者が自分で入力した 0〜100 の整数だけを投稿するアプリです。Battery Status API、位置情報API、端末フィンガープリントを利用しません。Firestore の投稿ドキュメントに許可するフィールドは次の4つだけです。

| フィールド | 内容 |
| --- | --- |
| `percentage` | 手入力された 0〜100 の整数 |
| `createdAt` | 投稿時刻 |
| `expiresAt` | 有効期限（投稿から24時間） |
| `anonymousName` | 位置情報と無関係な自動生成の呼び名 |

氏名、メールアドレス、位置、端末情報、認証UIDを投稿データに含めません。直近の閲覧履歴はそのブラウザ内に保存され、デモと実データを分離します。共有は利用者が操作したときだけ行います。

Firebase Authentication の匿名認証は、投稿データとは別にFirebase側の匿名アカウントを作ります。「アプリが個人情報を保存しない」ことと、「インフラ事業者が通信の運用情報を一切処理しない」ことは同義ではありません。ホスティング・認証・計測事業者による通信情報の処理について、アプリ側だけでゼロと保証することはできません。

計測はブラウザにVercelの計測スクリプトを入れず、同一オリジンのサーバー経由にします。許可したイベント名とモードだけを受け取り、訪問者のIP・User-Agent・CookieをVercel Analyticsへ転送しない設計です。投稿者の呼び名、認証UID、充電残量、個人情報をイベントに含めません。閲覧・投稿・共有のイベント数を計測する用途に限定します。Vercel Analytics の標準収集項目や保持方針は[公式プライバシー資料](https://vercel.com/docs/analytics/privacy-policy)を確認してください。

## データ境界

- Firebaseの設定が一切ないときのみ、明示されたデモモードでサンプルを表示します。
- Firebaseの設定不足・認証エラー・通信障害・空データは別の状態です。実データ取得失敗を偽の投稿で埋めません。
- 投稿の入力検証はUIだけに依存させず、Firestore Security Rulesでも型・値域・許可フィールド・匿名名・時刻を制約します。
- 投稿の24時間制限は、表示クエリと読み取り後の検証で守ります。TTLによる物理削除のタイミングとは分けます。TTL処理前の古いドキュメントに対する直接読み取りの遮断を保証する構成ではありません。
- TTLの設定、Firestore Rulesのデプロイ、匿名認証の有効化は、実Firebaseプロジェクトへ切り替える前に運用者が行います。詳しくはREADMEを参照してください。

## 公開する設定と秘密情報

Firebase Webアプリの公開設定はブラウザから読める値です。Firebase API keyを認可の秘密として扱わず、Rulesによってアクセスを制御します。ただしFirebase用途だけに制限された専用のキーを使い、有料の他サービスやGemini APIへ共用しないでください。[FirebaseのAPI keyに関する公式説明](https://firebase.google.com/docs/projects/api-keys)も参照してください。

一方、サービスアカウントJSON、管理者SDK用の鍵、OAuthトークン、GitHub/Vercelのアクセストークンは公開禁止です。`NEXT_PUBLIC_` の付いた環境変数はブラウザのJavaScriptへ埋め込まれるため、これらの秘密を決して配置しないでください。

`.env.example` は空値や説明用のプレースホルダーだけにします。実際の `.env.local`、秘密鍵ファイル、CLIの認証情報はGit対象外です。本番設定はVercelの環境変数管理を利用し、公開設定を変更した場合も再ビルドしてください。

## Secret Scan

```bash
node scripts/secret-scan.mjs --self-test
npm run secret-scan
```

`scripts/secret-scan.mjs` はネットワークも追加依存も不要なヒューリスティックスキャナーです。このアプリ自体がGitリポジトリのルートであることを確認し、親フォルダの別プロジェクトを走査しません。

スキャン対象:

1. Git追跡ファイルと、Gitで無視されていない未追跡ファイルの現在の内容。
2. Git indexにあるステージ済み内容。ローカルで消しただけの秘密を見落とさないためです。
3. ローカルにある全ブランチ・remote-tracking ref・タグから到達できるGitオブジェクト。過去のファイル内容、コミットメッセージ、タグメッセージを含みます。同一内容の再検査は省略します。

秘密鍵、サービスアカウント形式、代表的なGitHub/GitLab/AWS/Slack/Google OAuth/Stripe/AI provider/npm/Vercelトークン、JWT、認証付きURL、高エントロピーな機密変数の直接代入をチェックします。`.env.local` や秘密鍵など、公開禁止パスが追跡・ステージされている場合も失敗します。ログには検出値を出さず、場所・行番号・ルール名だけを出します。

ロックファイル、ドキュメント、テスト、画像を一括除外しません。生のバイナリ内にある文字列も検査します。UTF-16のBOMがあるファイルもデコードします。16 MiBを超えるファイル、未取得の履歴オブジェクト、shallow clone、submoduleは黙って飛ばさず失敗し、個別確認を求めます。

限界:

- Gitで無視されている未追跡ファイル、到達不能・未取得の過去の履歴、Git LFSの外部オブジェクト、外部サービスの設定は対象外です。
- 圧縮・暗号化されたデータは展開しません。画像の文字はOCRしません。未知の形式や短いパスワードをすべて検出できるわけではありません。
- Firebase Web用の `NEXT_PUBLIC_FIREBASE_API_KEY` は一般的な機密代入の判定から除きます。秘密鍵や既知トークンの形式はこの名前であっても除外しません。
- 成功は「設定済みの検出パターンで見つからなかった」という意味です。漏えいゼロ・脆弱性ゼロの保証ではなく、GitHubのSecret scanningや手動レビューを置き換えません。

## CI

GitHub Actionsでlint、typecheck、unit tests、production build、Secret Scan、Firestore Rulesのエミュレーターテストを実行します。Node.js 22とJava 21を使用し、Firebaseの本番認証情報は渡しません。Actions権限は `contents: read` に限定し、checkoutによる認証情報の永続化を無効にします。外部Actionsは確認した公式リリースの完全なコミットSHAで固定しています。

- [actions/checkout v7.0.1](https://github.com/actions/checkout/releases/tag/v7.0.1)
- [actions/setup-node v7.0.0](https://github.com/actions/setup-node/releases/tag/v7.0.0)
- [actions/setup-java v6.0.0](https://github.com/actions/setup-java/releases/tag/v6.0.0)

## 運用前に理解しておく制約

匿名認証とSecurity Rulesは、アカウント作り直しや分散した不正リクエストを完全には防げません。クライアント側の連続投稿制限がある場合も、それだけを強固なレート制限とは扱いません。公開規模を拡大する場合は、利用量アラート・API制限・App Check・バックエンド側の濫用対策を、収集データとプライバシーへの影響も含めて設計してください。課金上限をUIの制限だけに依存させないでください。

## 問題を見つけたとき

実際の秘密情報や個人情報を、公開Issue・スクリーンショット・ログへ貼らないでください。まず対象の鍵・トークンを失効し、影響範囲を確認します。ファイルを消すだけではGit履歴や既存のデプロイから消えないため、履歴と配布済み成果物を別途確認してください。GitHubのPrivate vulnerability reportingが利用可能であれば、非公開の報告経路を利用してください。
