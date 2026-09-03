# TDnetレーダー 引き継ぎ書

作成日: 2026-09-03

このファイルは、TDnetレーダーを将来更新・修理するときに、ChatGPTや自分自身がすぐ状況を復元するための引き継ぎ書です。

---

## 1. このアプリの目的

TDnetの適時開示を自動監視し、重要な開示だけをAndroidスマホへ通知する個人用アプリ。

基本方針:
- AIは使わない
- ChatGPT Workを使わない
- Codexを使わない
- OpenAI APIを使わない
- 通常のプログラムだけで監視・分類・通知する
- できる限り無料枠で運用する

重要:
**コードの部分修正はなるべく避ける。**
更新時は、ChatGPT側で「完成版コード」を作り、ユーザーはコード全体を丸ごと置き換える方式を優先する。
カッコや一部分だけの削除・差し替えは事故の元なので、原則やらせない。

---

## 2. 全体構成

TDnet
↓
Cloudflare Worker「tdnet-monitor」
↓ 2分ごとに自動実行
TDnet当日分を全ページ取得
↓
Cloudflare KV「tdnet-state」と比較
↓
前回以降の新着だけ抽出
↓
タイトルをルール判定
↓
対象開示ならOneSignalへ送信
↓
Androidの「TDnetレーダー」にPush通知

---

## 3. GitHub / スマホアプリ側

GitHubユーザー:
- kuma885

GitHubリポジトリ:
- tdnet-radar

GitHub Pages URL:
- https://kuma885.github.io/tdnet-radar/

アプリ形式:
- PWA
- AndroidのChromeからホーム画面へインストール済み
- スマホ上では「TDnetレーダー」として使用

主なファイル:
- index.html
- manifest.json
- sw.js
- icon-192.png
- icon-512.png
- OneSignalSDKWorker.js

OneSignal用Service Worker:
- https://kuma885.github.io/tdnet-radar/OneSignalSDKWorker.js

OneSignal SDKはGitHub Pages側のアプリに組み込み済み。

### 画面を更新したい場合

GitHubの `tdnet-radar` を更新する。

推奨手順:
1. ChatGPTに「TDnetレーダーの画面を○○に変更したい」と伝える
2. ChatGPTに完成版ZIPを作らせる
3. GitHubの Add file → Upload files
4. 既存ファイルを丸ごと上書き
5. Commit changes
6. GitHub Pages反映後、Androidアプリを開き直す

---

## 4. Cloudflare Worker

Worker名:
- tdnet-monitor

役割:
- 2分ごとにTDnetを確認
- 当日のTDnet一覧を全ページ取得
- 新着のみ抽出
- タイトル分類
- 対象ならOneSignal APIへ通知

Cron:
- Every 2 minutes

Worker URL:
- https://tdnet-monitor.sanndora388.workers.dev/

注意:
本番では公開テスト用URL `/push-test-7k2m9` は削除済み。
再度テスト機能を付ける場合も、テスト後は必ず削除する。

---

## 5. Cloudflare KV

KV Namespace:
- tdnet-state

Worker Binding:
- TDNET_STATE

用途:
- 当日すでに見たTDnet開示を保存
- 前回との差分から新着だけ判定

保存キー形式:
- seen:YYYYMMDD

新しい日になると、その日の最初の実行で当日分を初期状態として記録する。

---

## 6. Cloudflare環境変数 / シークレット

Worker「tdnet-monitor」に以下を設定済み。

- ONESIGNAL_API_KEY
  - Secret
  - OneSignal APIキー本体
  - 値はこの引き継ぎ書には絶対に書かない

- ONESIGNAL_APP_ID
  - OneSignal App ID
  - Cloudflare側に登録済み

- ONESIGNAL_SUBSCRIPTION_ID
  - Android端末のOneSignal Subscription ID
  - Cloudflare側に登録済み

重要:
APIキーやSubscription IDなどの秘密値はChatGPTへ貼らない。
GitHubへも書かない。
CloudflareのSecretに保存する。

---

## 7. OneSignal

OneSignal App:
- TDnet Radar

用途:
- Cloudflare WorkerからAndroidへWeb Push通知

プラン:
- Free

Android:
- OneSignalにSubscribedとして登録済み
- 手動Pushテスト成功済み
- Cloudflare Workerからの自動Pushテスト成功済み

通知経路:
Cloudflare Worker
↓
OneSignal REST API
↓
ONESIGNAL_SUBSCRIPTION_IDでAndroid端末を直接指定
↓
Android通知

「Subscribed Users」セグメント送信ではなく、
**Subscription IDを直接指定する方式**を使う。

理由:
セグメント方式ではWorker経由の通知対象が0件になり、通知IDが返らなかったため。
Subscription ID直接指定で正常動作を確認済み。

---

## 8. 現在の通知対象

タイトルだけで確定できるものを中心に通知する。

### 好材料
- 上方修正
- 増配
- 自社株買い
- 大型受注
- 業務提携
- M&A
- TOB
- 株式分割

### 悪材料
- 下方修正
- 減配
- 赤字転落
- 希薄化

---

## 9. 現在の分類方針

通知を鳴らしすぎないことを重視。

最初のルールでは161件中63件ヒットして多すぎたため、
「決定した瞬間」や「新規材料」を中心に厳しくした。

調整後:
- 161件中2件程度まで絞れた日がある

主な除外例:

### 自社株買い
通知しない:
- 取得状況
- 取得結果
- 取得終了
- 取得実績

通知したい:
- 自己株式取得に係る事項の決定
- 自己株式の取得及び自己株式立会外買付取引 など

### 希薄化
通知しない:
- 月間行使状況
- 行使状況
- 行使結果
- 大量行使
- 発行状況
- 払込完了

通知したい:
- 第三者割当増資
- 第三者割当による新株・新株予約権発行
- 公募増資
- 行使価額修正条項付新株予約権
- MSワラント発行 など

### TOB
- 公開買付け開始
- 公開買付けに関する意見表明
- TOB
- 重要そうな訂正も現状は拾う方向

---

## 10. 現在の限界

現状は主に「TDnetのタイトル」で判定している。

そのため、以下のようなタイトルは判定できないことがある。

例:
- 「業績予想の修正に関するお知らせ」
- 「配当予想の修正に関するお知らせ」

タイトルだけでは、
- 上方修正か下方修正か
- 増配か減配か

が分からないため、現状は見逃す可能性がある。

将来の改善候補:
- 開示PDF本文を取得
- 前回予想と今回予想の数字を比較
- 上方 / 下方をAIなしで判定
- 配当の増配 / 減配も数字で判定

この改善もAI必須ではない。

---

## 11. 料金・利用枠の考え方

このアプリの重要方針。

現在の監視運用では:
- ChatGPT Work: 使わない
- Codex: 使わない
- OpenAI API: 使わない
- AI判定: 使わない

利用している外部サービス:
- GitHub Pages: 無料利用
- Cloudflare Workers: 無料枠
- Cloudflare KV: 無料枠
- OneSignal: Freeプラン

JPX公式TDnet API:
- 有料
- 個人利用には高額なため使っていない

現在はTDnetの無料閲覧ページをWorkerが読み取る方式。

注意:
これは公式TDnet APIではないため、TDnet側のHTML構造が変更された場合は修正が必要。

---

## 12. 通知が来なくなったときの確認順

### 1. Cloudflare Worker
`tdnet-monitor` の Observability / Logs を確認。

確認ポイント:
- 2分おきに scheduled が動いているか
- Success / Error
- TDnet取得エラーが出ていないか

### 2. TDnet取得
Worker URLをブラウザで開き、現在のTDnetデータが取得できるか確認。

### 3. KV
`TDNET_STATE` バインディングが消えていないか確認。

### 4. OneSignal
Audience / SubscriptionsでAndroidがSubscribedになっているか確認。

### 5. Android
TDnetレーダーの通知権限を確認。

### 6. Subscription ID
スマホ側の再登録やサイトデータ削除などでSubscription IDが変わった場合、
Cloudflareの
`ONESIGNAL_SUBSCRIPTION_ID`
を新しい値へ更新する。

---

## 13. アプリを更新するときの依頼文

将来ChatGPTがこの会話を覚えていない場合は、
このファイルを渡して以下のように依頼する。

例:

「これは自作しているTDnetレーダーの引き継ぎ書です。
内容を読んで現状を把握してください。
コードの部分修正は苦手なので、更新コードは完成版ZIPで丸ごと渡してください。」

これで再開する。

---

## 14. 絶対に守ること

1. APIキーをチャットへ貼らない
2. APIキーをGitHubへ書かない
3. 秘密値はCloudflare Secretに保存
4. 本番Workerに公開テスト送信URLを残さない
5. 大きなコード変更は部分修正ではなく完成版を丸ごと交換
6. 新しい有料サービスを使う場合は、料金と利用上限を先に確認
7. Work / Codex / OpenAI APIを使う変更の場合は、作業前に何を消費するか明示する

---

## 15. 現在の完成状態

2026-09-03時点:

- Android PWAインストール: 完了
- GitHub Pages公開: 完了
- Cloudflare Worker: 完了
- 2分Cron: 完了
- TDnet全ページ取得: 完了
- KV新着判定: 完了
- 重要開示分類: 完了（タイトルベース）
- OneSignal購読: 完了
- OneSignal手動通知: 成功
- Cloudflare → OneSignal → Android自動通知テスト: 成功
- 本番Workerへの切替: 完了
- AI: 不使用

つまり現在は、
**TDnetで条件に合う新着が出れば、原則として最大約2分程度でAndroidへ通知する状態。**

---

## 16. 次に改善するとしたら

優先順位候補:

1. 数日運用して誤通知・取りこぼしを確認
2. タイトル分類ルールの微調整
3. 「業績予想の修正」PDFを読んで上方 / 下方判定
4. 「配当予想の修正」PDFを読んで増配 / 減配判定
5. 保有株 / 監視株だけ通知を強調
6. 通知タップで該当TDnet開示を直接開く
7. アプリ画面に通知履歴を表示
8. 通知カテゴリごとのON/OFFを本番通知側と連動

---

このアプリは「無料で動く個人用TDnet監視レーダー」として維持する。
AIやWorkは、必要になった機能だけ後から明示的に追加する。
