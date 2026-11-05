# 町中華メモ

みんアプ工房向けの、町中華の食べ歩き記録帳です。

## できること

- 行った店・場所・日付・料理・金額（任意）・5段階評価・ひとことメモを記録
- 記録を編集、削除、「また行きたい」の切り替え
- 店名・場所・料理・メモから検索、また行きたいだけ表示、日付順・評価順に並び替え
- 訪問回数、訪れた店舗数、また行きたい件数の集計

ひと皿単位の記録なので、同じ店の複数回の訪問も残せます。サンプルデータは保存しません。

## 保存と安全性

工房の認証済み `window.minapp.userState` のみを使い、個人専用に保存します。共有 `minapp.state` やブラウザの `localStorage` には切り替えません。読み込み時は `state_not_found` のキーだけ空ページとみなし、それ以外の失敗は停止します。

1キー16KiBのHosted保存上限より余裕を持たせ、独立した8キー（`chuka_memo_v1_0`～`chuka_memo_v1_7`）に1キー最大12KiBで分散します。記録は最大180件。保存容量を超えた場合は勝手に削除や縮小をせず、画面にエラーを表示します。入力時の不正データは保存せず、保存・読み込み失敗時は編集を停止します。未登録のページキーは保存する必要が出るまで作りません。

## 配布・テスト

`index.html`・`app.js`・`memo.js`・`minapp-package.json` が工房への配布対象です。

```sh
node chinese_food_memo/test_memo.js
node --check chinese_food_memo/app.js
node --check chinese_food_memo/memo.js
python deploy/kobo/publish.py --app chinese_food_memo --check
```

工房へのGitHub Actions自動公開は [../deploy/kobo/README.md](../deploy/kobo/README.md) を参照してください。GitHub Actions Secrets設定までは工房への配信は行われません。
