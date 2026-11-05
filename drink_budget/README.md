# 晩酌予算

みんアプ工房向けの静的Webアプリです。月の予算と1回あたりの目安を設定し、日付・金額・メモを記録すると、選択月の支出・残額・あと何回分かを確認できます。

## 保存

認証済みのHosted Runtime `minapp.userState`（本人専用）を使います。共有 `minapp.state` や削除されうる `localStorage` へ自動的に切り替えません。初回の `state_not_found` だけ空の予算帳を作ります。通信・データ形式のエラー時は編集を停止し、元のエラーを表示します。

月予算と1回の目安は全月共通、支出は日付ごとに各月へ集計します。記録は最大500件です。削除する前には確認が出ます。

## 配布・検証

`index.html`・`app.js`・`budget.js`・`minapp-package.json` を配布します。工房へのGitHub Actions自動公開は `../deploy/kobo/README.md` を参照してください。GitHub Actions Secretsの初回設定が済むまでは工房に自動反映されません。

計算と保存データ検証のテスト：

```sh
node test_budget.js
```

工房の個人保存APIがない通常のWebページでは編集を開始しません。実際の保存と再起動後の復元は工房のWebView内で確認してください。