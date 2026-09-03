# minapp_apps

みんアプで配布する個別アプリのソースを管理するリポジトリです。

`kaeruko/minapp` 本体からアプリ実装を分離し、このリポジトリを個別アプリの source of truth とします。

## Layout

- `shiba_donguri/`
- `shiba_goshujin/`
- `shopping_town/`
- `ol_home/`
- `novel_starter/`

`kaeruko/minapp` からは `apps/mobile/assets/builtin` に submodule として配置して利用します。
