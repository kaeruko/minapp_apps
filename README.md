# minapp_apps

みんアプで配布する個別アプリのソースを管理するリポジトリです。

`kaeruko/minapp` 本体からアプリ実装を分離し、このリポジトリをみんアプショップ等で配布する個別アプリの source of truth とします。

## Layout

- `memo_pad/` - 「マイメモ帳」シンプルな自動保存メモ
- `shiba_donguri/`
- `shiba_goshujin/`
- `shopping_town/`
- `ol_home/`
- `novel_starter/`
- `sing_along/` - 「うたってみよう」BGM付き録音アプリ
- `minappchi/` - 「みんあぷっち」シンプル育成アプリ
- `coordinate_book/` - 「わたしのコーデ帳」着せ替え＋コーデ日記アプリ
- `drink_budget/` - 「晩酌予算」月予算・支出・あと何回分を記録する工房向けアプリ
- `chinese_food_memo/` - 「町中華メモ」食べ歩きの料理・お店・評価・再訪したい記録

ビルトインとして本体へ同梱するアプリは `kaeruko/minapp` 側で別途管理します。このリポジトリ全体を submodule として本体へ組み込む前提にはしません。
