# うたってみよう

`index.html` だけで動く、Web Audio の伴奏・メロディとマイク録音のアプリです。

## 月の光（ドビュッシー）

- 原曲: Claude Debussy, *Suite bergamasque*, III. *Clair de lune*, L.75 / CD 82。
- 参照楽譜: [Mutopia 1778](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1778)、Keith OHara による Public Domain の浄書。原資料は E. Fromont (1905)、plate E.1404 F。[LilyPond ソース](https://www.mutopiaproject.org/ftp/DebussyC/L75/debussy_Ste_Bergamesq_Clair/debussy_Ste_Bergamesq_Clair.ly) の冒頭 `rhUpRed`、第1〜4小節の上声を読み取る。参照した公開元 GitHub のソース blob SHA は `16d44595b18ad819016f3948a9b666f95e45aadd`。
- 原曲の変ニ長調・9/8拍子を維持し、メロディは1オクターブ下げる。冒頭の8分休符、内部のタイ、第3小節の二連符を保持する。4小節を2回繰り返し、最後に Db4 を付点4分音符で伸ばす。抜粋末尾から範囲外へ続くタイは切り、繰り返し・終止・簡略伴奏はこのアプリ用に作成する。
- MIDI note / 拍数の単位は既存曲と同じ「四分音符 = 1拍」。休符は `[null, 拍数]` として明示し、音を出さずに時間だけ進める。タイでつながる音は合計の長さを持つ1音にまとめる。原曲の二連符の8分音符は0.75拍として記録する。
- 練習用テンポは四分音符 = 72。合図は付点4分音符間隔で3回（`leadInBeats: 4.5`、`countInPulseBeats: 1.5`）。合図4.5拍 + 旋律37.5拍 + 余韻0.15秒で約35.15秒。曲末で録音も自動停止する。
- 市販の録音・現代の編曲・歌詞は取り込まない。メロディと伴奏は従来どおり oscillator で合成する。

## 交響曲第25番（モーツァルト）

- 原曲: Wolfgang Amadeus Mozart, *Symphony No.25 in G minor*, K.183/173dB, I. *Allegro con brio*。
- 参照: IMSLP の [作品ページと冒頭譜例](https://imslp.org/wiki/Symphony_No.25_(Mozart,_Wolfgang_Amadeus))。同ページの #00057 は *Mozarts Werke*, Serie VIII, Bd.2, No.25 (pp.39–57), Breitkopf & Härtel, 1880, plate W.A.M.183、Public Domain と記載されている。入力に使ったのは公開ページに表示される第1楽章の冒頭5小節の譜例であり、総譜全体を取り込んだものではない。
- 譜例の LilyPond 表記は `\relative c''' { \key g \minor g8 g4 g g g8 | d8 d4 d d d8 | es8 es4 es es es8 | fis,8 fis4 fis fis fis8 | g8 bes d g bes16( a g fis g4) | }`。最初の4小節は8分音符・4分音符×3・8分音符のシンコペーションを保持し、第5小節の上行分散和音と16分音符も保持する。
- メロディは原曲から1オクターブ下げる（最初の音 G5 → G4）。5小節を3回繰り返し、最後に G4 を4拍保持する。繰り返し方と終止、簡略伴奏はこのアプリ用に作成したもの。
- 4/4拍子、練習用テンポは四分音符 = 128。準備の合図4拍 + 旋律64拍 + 余韻0.15秒で約32.0秒。曲末で録音も自動停止する。
- 宝石の八神CMは利用箇所を示す参考。現代作品「HASSIN」の独自の音楽表現・録音・歌詞は取り込まず、モーツァルトの原曲譜例を入力元とする。メロディと伴奏は従来どおり oscillator で合成する。

## 木星（ホルスト）

- 原曲: Gustav Holst, *The Planets*, Op.32, IV. *Jupiter, the Bringer of Jollity*。
- 参照楽譜: Goodwin & Tabb, 1921 初版の Boosey & Hawkes リプリント。IMSLP の [作品ページ](https://imslp.org/wiki/The_Planets,_Op.32_(Holst,_Gustav)) のファイル #15436、[総譜 PDF](https://vmirror.imslp.org/files/imglnks/usimg/5/5f/IMSLP15436-Jupiter.pdf)。同ページで Public Domain と記載されている原曲の総譜を参照。
- 入力箇所: 印刷ページ 91 下段の第1ヴァイオリン、Andante maestoso 直前の G3・Bb3 の弱起から、ページ 92 最初の Eb4 まで。タイで結ばれた音は1音にまとめる。
- 変ホ長調・3/4拍子、テンポは練習用に四分音符 = 76 と設定。冒頭8小節の旋律を2回演奏する。折り返しでは8小節目の Eb4 を2拍として G3・Bb3 の弱起へ戻り、最後は Eb4 を3拍保持して終える。
- 準備の合図2拍 + 旋律49拍 + 余韻0.15秒で、約40.4秒。最後まで再生すると録音も自動で止まる。
- 伴奏はこのアプリ用に新たに簡略化した和音。メロディは triangle、伴奏と合図は sine の oscillator で合成する。音源ファイルの取得・同梱は行わない。
- 歌詞は付けず「ラララ」で歌う。現代の歌曲版の歌詞・編曲・録音は使わない。

録音後は曲の選択を固定し、再生時も録音時と同じ曲を使う。「とりなおす」で録音を消すと別の曲を選べます。録音時の声と伴奏の開始時刻の差も再生時に保ちます。

既存の「きらきらポップ」「放課後バラード」「アイドルステップ」は従来の60秒伴奏です。

## 確認

```sh
node --test sing_along/test_sing_along.js
```

Node のテストでは曲の長さ、音の予約時刻、休符・タイ・複拍子の合図、曲末の自動停止、既存伴奏、録音と再生、入力不正時の停止を確認します。実機のマイク・スピーカー品質と録音遅延は、配布先のブラウザ/WebViewで確認してください。

本リポジトリの変更は `kaeruko/minapp` 本体へ自動同梱されません。配布元は本リポジトリのルート README を参照してください。
