# GitHub → Cloudflare Workers 自動デプロイ

対象: kuma885/tdnet-radar の main → 既存Worker tdnet-monitor。

## 最初の1回だけ必要な設定

GitHubの [Actions Secrets](https://github.com/kuma885/tdnet-radar/settings/secrets/actions) に、次の2つを「New repository secret」で登録します。

| Name | Secretへ入れる値 |
| --- | --- |
| CLOUDFLARE_ACCOUNT_ID | tdnet-monitorがあるCloudflareアカウントの32桁のAccount ID |
| CLOUDFLARE_API_TOKEN | 下記の権限で作ったCloudflare APIトークン |

トークンはCloudflareのAPI Tokensで作成します。カスタムトークンで Account → Workers Scripts → Edit、Account Resourcesはtdnet-monitorがあるアカウントだけを指定します。Global API Keyは使いません。今回の処理にKVデータの編集権限は不要です。
トークンの値はチャットやリポジトリのファイルへ貼らず、GitHub Secret欄へ直接入力してください。既存OneSignalのSecretをコピーする必要はありません。

登録後は [Actions](https://github.com/kuma885/tdnet-radar/actions/workflows/deploy-worker.yml) → Test and deploy TDnet Worker → Run workflow → main。
初回は既に同じコードなら再アップロードを省略し、認証・既存コード・設定・Cron・公開応答を検証します。
この登録・初回実行が成功するまでは、自動デプロイは有効化完了ではありません。

## 以降の動き

mainへのpushごとに、26テストが成功してから本番を更新します。PRではテストのみで、Secretや本番Workerにはアクセスしません。
HTMLや説明書だけの変更もワークフローは起動しますが、Workerコードが同じなら書き込みは省略します。
GitHub Pagesの既存公開処理は引き続き独立して動作します。

## 既存環境を保持する仕組み

Cloudflare公式の `PUT /accounts/{account_id}/workers/scripts/tdnet-monitor/content` を使用します。このAPIは設定やメタデータを変更せず、コードだけを更新します。

- KV、環境変数、Secret、互換日付、Cron、ドメイン、課金プランを変更するAPIは呼びません。
- 更新前に既存Workerのコード・設定・Cronを読み取ります。KVと通知用変数、Cronがなければ停止します。
- 更新後にコード一致・設定保持・Cron保持・公開URLのJSON応答を確認。
- 公開後検証が失敗した場合は直前のコードへ戻します。途中で別の人がコードを変更した場合は自動で上書きしません。
- 認証未登録や403では書き込み前に停止。PUTの通信タイムアウトは反映の有無が不確かなため自動で再送しません。Cloudflareの履歴を確認してください。
- トークン、API応答本文、設定値、旧コードはログや成果物に出しません。旧コードは実行中のメモリだけに保持します。

現行の単一JavaScriptモジュール構成専用です。将来複数モジュールにする場合はデプロイ処理の変更が必要です。
動作確認はHTTPでの読取です。Cronを手動起動したり、テストPushを送信したりしません。実機の受信確認は別途必要です。
並行デプロイは直列化し、古いコミットの実行は省略します。ただしCloudflareダッシュボードからの手動更新とは完全な排他制御ではないため、デプロイ実行中の手動編集は避けてください。

## 無料範囲

この公開リポジトリでは標準GitHubホストのubuntu-latestを使用します。GitHub公式の公開リポジトリ無料枠対象です。有料ランナー・キャッシュ・成果物保存・新規有料サービスは使いません。
Cloudflareは既存Workerと既存契約のままです。各サービスの利用上限そのものを変更したり、課金プランへ切り替えたりしません。

## テストと復旧

Node.js 24で `node --test tests/tdnet.test.cjs tests/deploy-worker.test.mjs`。
既存16件と、自動デプロイの模擬APIテスト10件を実行します。
内容: 正常更新、設定に書き込まないこと、認証不足、同一コード、省略対象の古いコミット、競合、ロールバック、KV/Cron不足、multipartの読取。

任意の旧版へ戻す場合はGitHubでcloudflare/worker.jsの変更をRevertしてmainへ反映します。自動デプロイが動かない場合は、Cloudflare側の直前の正常なデプロイへ戻せます。
止めたい場合はActions画面でこのワークフローをDisableします。既存の2分監視はそのまま続きます。

## 公式資料

- [Cloudflare コードだけの更新API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/update/)
- [コード取得API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/content/methods/get/)
- [既存設定の取得](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/)
- [GitHub Actionsの料金](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
