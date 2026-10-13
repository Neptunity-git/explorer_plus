# 技術の確認（ADR 0006 判断2）の結果

- 日付: 2026-10-13
- 環境: 開発用のデスクトップ PC（Windows 11、有線 LAN のみ・Wi-Fi なし）、Rust 1.99、Tauri 2、windows クレート 0.62、trash クレート 5.2
- 動かし方: `npm install` → `npm run tauri dev`。起動すると全項目を自動で確かめ、`%TEMP%\explorer3d-spike\report.json` に書き出す

| # | 項目 | 結果 | メモ |
|---|---|---|---|
| 1 | Windows の位置情報 | **未確認** | 許可は「Allow」で通るが、位置の取得が時間切れ（0x800705B4）。この PC は Wi-Fi がないデスクトップ機のため。BYOD のノート PC で試す |
| 2 | ファイルID | OK | `GetFileInformationByHandleEx(FileIdInfo)`。ファイルの名前変更・別フォルダへの移動、フォルダの名前変更で値が変わらない |
| 3 | ごみ箱へ送る | OK | `trash` クレート。元の場所から消え、ごみ箱の一覧に現れる（試験用のファイルは後でごみ箱からも消した） |
| 4 | 標準アイコン | OK | `SHGetFileInfoW` ＋ `SHGetImageList(SHIL_JUMBO)`。拡張子だけから 256×256 のアイコンを取れる（docx・pptx・xlsx・pdf・txt・exe・json・zip） |
| 5 | 既定のアプリで開く | OK | `tauri-plugin-opener` の `open_path`。.txt がメモ帳で開いた |
| 6 | MOD の閉じ込め | OK（条件付き） | 下記 |

## 6. MOD の閉じ込めの詳細

`sandbox="allow-scripts"`（`allow-same-origin` なし）の iframe に、MOD に見立てたスクリプトを入れて試した。

| 試したこと | CSP なし | CSP あり（`default-src 'none'; script-src 'unsafe-inline'` など） |
|---|---|---|
| 親の画面に触る | 遮断 | 遮断 |
| Tauri のコマンドを呼ぶ（`__TAURI_INTERNALS__.invoke`） | 遮断（Tauri が送り元 `null` を拒否） | 遮断（通信を CSP が止め、返事が来ない） |
| Tauri の通信口へ直接送る（`http://ipc.localhost`） | **届く**（500 で拒否される） | 遮断 |
| インターネット | **通る** | 遮断 |
| localStorage | 使えない | 使えない |

分かったこと：

- **sandbox と CSP の両方が要る**。sandbox だけではネットに出られる。Tauri のコマンドは送り元の確認で拒否されるが、
  それは Tauri 側の1枚の守りだけに頼ることになる
- **Tauri は iframe の中にも `__TAURI__` などを入れてくる**（呼んでも拒否されるので害はないが、MOD 作者が「使える」と
  誤解しないよう、本番では `withGlobalTauri` を切る・API の説明に書く）
- **MOD は localStorage が使えない**。MOD の保存は本体の API（ADR 0007 判断3「自分の構造を保存する」）で行う必要がある
- Tauri のアプリの exe は 4.4MB（リリースビルド、インストーラなし）
