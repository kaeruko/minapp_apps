# 工房アプリのGitHub自動公開

個別Webアプリの原本は `kaeruko/minapp_apps` に置きます。`main` にpushした後、`.github/workflows/publish-kobo.yml` がテスト・ZIP生成・既存Hosted APIへのアップロード・公開・ショップ掲載を行います。`kaeruko/minapp` のFlutterビルドやTerraformデプロイは不要です。

## 初回設定（リポジトリ管理者が一度だけ実施）

GitHubの `kaeruko/minapp_apps` → **Settings → Secrets and variables → Actions → Repository secrets** に、次の4つを登録してください。

| Secret | 内容 |
| --- | --- |
| `KOBO_API_BASE_URL` | **工房版**のHosted APIのHTTPSオリジン。パスなし（Girls版と取り違えない） |
| `KOBO_LOGIN_ID` | 工房に登録済みの、公開専用アカウントのログインID |
| `KOBO_PASSWORD` | 上記アカウントのパスワード |
| `KOBO_GROUP_ID` | そのアカウントが参加している、公開先グループの32桁のID |

公開専用アカウントを使い、誰かの個人ログイン情報は登録しないでください。初回のアカウント・グループ登録は工房上で行います。APIへの接続先が未設定、認証できない、参加グループが不一致の場合は処理を止めます。**Secretsがない間は自動公開されません**。GitHubコネクタからSecretsを代理設定する処理はありません。

## 登録済みアプリの公開

1. `drink_budget/` または `chinese_food_memo/` を編集して `main` にpushします。
2. GitHub Actionsの `Publish Kobo apps` がアプリ別のNodeテストと自動公開スクリプトの単体テストを実行します。両アプリを個別に検証・公開します。
3. `minapp-package.json` の安定した `package_id` により、同じアプリを再アップロードすると原則同じ `app_id` が更新されます。内容が同じときは新しいsource revisionは作成されません。
4. 更新内容をHosted APIで公開し、「みんなのアプリ」に掲載します。すでに同じsource revisionが公開済みなら重複公開しません。

確認だけなら `python deploy/kobo/publish.py --app drink_budget --check`、認証情報を環境変数に設定して手元で公開する場合は `--publish` を指定します。Python 3.12以降の標準ライブラリで実行できます。シークレットの値はコマンド引数に含めず、環境変数で渡してください。

実際に使うファイルは `deploy/kobo/apps.json` の `files` に列挙します。`README.md` やテストは配布ZIPに含めません。`shop_visibility` は `listed`（ショップ掲載）または `unlisted`（グループ内の公開のみ）の明示設定です。

## アプリを増やす場合

アプリごとに独立ディレクトリを作り、`index.html` と、**アプリ固有で変更しない** `minapp-package.json`（`{"schema_version":1,"package_id":"32桁の小文字16進数"}`）を入れます。`deploy/kobo/apps.json` にタイトル・ファイル一覧・ショップ掲載設定を追加し、ワークフローの `paths`・テスト・`--app` の実行対象にも追加してください。

公開時の認可、ZIP検証、保存は工房本体の既存APIに委ねます。アップロード・公開は別操作なので、途中で失敗したらGitHub Actionsが失敗し、勝手に別のAPI・保存先・アカウントへ切り替わりません。次のpushまたは手動再実行で、同じアプリの状態を確認して続きから進められます。Hosted APIはアプリあたり公開バージョン数上限（現行20版）があるため、上限到達時は原因を調べてから対応してください。
