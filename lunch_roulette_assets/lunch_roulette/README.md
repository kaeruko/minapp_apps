# 昼めしルーレット — 画像素材パック

参照スクリーンショットの昭和レトロ調に合わせて生成したアプリ用イラスト素材です。各 PNG は透過背景です（一部アイコン・木目・地図は内部に背景があります）。

## Flutter での使用例

`assets/lunch_roulette/` に PNG を配置し、`pubspec.yaml` に以下を追加します。

```yaml
flutter:
  assets:
    - assets/lunch_roulette/
```

```dart
Image.asset('assets/lunch_roulette/food_ramen.png', width: 64)
```

## 分担のおすすめ

- **画像で配置**: 料理イラスト10種、木槌、ブランドアイコン、中央のラーメンマーク、木目テクスチャ。
- **Flutter で描画**: ルーレットの回転、当選扇形、料理名テキスト、選択状態、ボタン、予算、地図、画面レイアウト。
- `roulette_frame.png`, `roulette_segments.png`, `roulette_pointer.png` はデザイン検討用。実際に回す場合は円盤と針を分離し、円盤の表示だけをアニメーションさせるのが確実です。
- `map_placeholder.png` は静止画の仮画像です。実際の店舗地図には地図 SDK を使ってください。
- `background_wood.png` は短い木目サンプルです。`background_wood_repeatable.png` は周辺を鏡面反転させてつないだ繰り返し用テクスチャです。
- ボタンの PNG は文言が画像内に入っています。表示内容を可変にするなら Flutter の文字・ボタンコンポーネントを使ってください。

`asset_sheet_original.png` は、生成された素材一覧の原画です。別々のパーツは上記の PNG を使ってください。生成AI素材のため、特に小さい日本語・細線は実機での表示確認をおすすめします。
