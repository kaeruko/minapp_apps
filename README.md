# minapp_apps

みんアプで配布する個別アプリのソースを管理するリポジトリです。

`kaeruko/minapp` 本体からアプリ実装を分離し、このリポジトリをみんアプショップ等で配布する個別アプリの source of truth とします。

## Layout

- `shiba_donguri/`
- `shiba_goshujin/`
- `shopping_town/`
- `ol_home/`
- `novel_starter/`
- `sing_along/` - 「うたってみよう」BGM付き録音アプリ

ビルトインとして本体へ同梱するアプリは `kaeruko/minapp` 側で別途管理します。このリポジトリ全体を submodule として本体へ組み込む前提にはしません。
