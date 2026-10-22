# explorer_plus

**ワクワクするエクスプローラ** — Windows 用のファイラー（ファイルを見て操作するアプリ）です。

> **English summary**: explorer_plus is a Windows file explorer built with Tauri 2 + TypeScript (Rust for the Windows-specific parts).
> Its core idea is *one data, many views*: files, timetable, notes and tags are kept in one place, and each view just draws them.
> Views are plain folders (`manifest.json` + `index.js`) that anyone can write and share as "MODs".
> The project is in early development (pre-release), Windows only, and the documentation is written in Japanese.
> Licensed under MIT. See [CONTRIBUTING.md](CONTRIBUTING.md) to help out.

状態：**開発中（試験版）**。最新版は [Releases](https://github.com/Neptunity-git/explorer_plus/releases) から入れられます。

## 何ができるか

2本の柱があります。

1. **便利さ**：時間割と位置情報から「今必要なフォルダ」を先回りして出します。ファイルの種類・サイズ・メモ・タグが一目で分かります。
2. **ワクワク**：同じデータを、いろいろな見せ方（ビュー）で眺められます。ビューは、あなたが MOD として作って足せます。

設計の芯は **「1つのデータ、たくさんのビュー」** です。ファイル・時間割・メモ・タグの情報は1か所にまとめ、ビューはそれを読んで描くだけにしています。

いま使える機能：

- タブ、Win11 と同じキーでの操作、フォルダの変更を見て自動で表示し直す
- ビュー：Win11 風（詳細・大アイコン）、ホーム、ノート（フォルダごとの1枚の平面に付箋・矢印・図形を置く）、タグ、時間割
- 時間割と位置情報で「今のフォルダ」へ一発で移動
- 7-Zip が入っていれば、右クリックから圧縮・展開
- MOD：ビューを追加する仕組み。zip で配れて、保存するとすぐ反映される（ホットリロード）。同梱の MOD に樹形図ビュー（[work/mods/neo.tree](work/mods/neo.tree)）があります

これからの予定（3D のボクセルビュー、共有相手のベン図など）は [docs/proposal.md](docs/proposal.md) にあります。

## 入れて使う

1. [Releases](https://github.com/Neptunity-git/explorer_plus/releases) から `explorer_plus_*_x64-setup.exe` をダウンロードして実行します
2. まだ署名（配布元の証明）をしていないので、「Windows によって PC が保護されました」と出ます。「詳細情報」→「実行」で進めてください

## ソースから動かす

必要なもの：Windows、[Node.js](https://nodejs.org/)、[Rust](https://rustup.rs/)（edition 2024 に対応した新しい版）、[Tauri 2 の前提](https://v2.tauri.app/start/prerequisites/)（Visual Studio Build Tools と WebView2）

```powershell
cd work/app
npm install
npm run tauri dev     # アプリを開発用に起動
npm test              # テスト（Vitest）
npm run build         # 型の検査（tsc）と画面のビルド
```

## MOD を作る

MOD は、`manifest.json` と `index.js` を入れたフォルダ1つです。ビルドは要りません。

- 説明書：[work/app/mod-docs/guide.md](work/app/mod-docs/guide.md)（アプリのホーム →「MOD 開発ガイド」でも開けます）
- 初めての人向けの手引き：[work/app/mod-docs/beginner.md](work/app/mod-docs/beginner.md)（IDE をほとんど使ったことがない人が、AI に手伝ってもらって最初の MOD を作るまで。よくある質問つき）
- 作った MOD を公開して共有する手引き：[work/app/mod-docs/share.md](work/app/mod-docs/share.md)（GitHub が初めての人向け。ブラウザだけでできます）
- みんなの MOD の一覧：[explorer_plus-mods](https://github.com/Neptunity-git/explorer_plus-mods)（探す・載せる）
- ひな形：[work/app/mod-template/](work/app/mod-template/)（アプリのホーム →「ひな形から作る」でも作れます）
- 実例：[work/mods/neo.tree/](work/mods/neo.tree/)

## このリポジトリの歩き方

| 場所 | 中身 |
|---|---|
| `work/app/` | アプリ本体（`src/` が TypeScript、`src-tauri/` が Rust、`views/` が標準のビュー、`tests/` がテスト） |
| `work/mods/` | 同梱の MOD |
| `docs/decisions/` | 設計の判断の記録（ADR）。「なぜこう作ったか」はここに書いてあります |
| `docs/requirements.md` / `docs/proposal.md` | 要件と企画 |
| `docs/design/` | MOD API などの設計 |
| `spikes/` | 技術の試し書き（本体には使っていません） |

`tasks/`、`logs/`、`config.yaml`、`CLAUDE.md`、`docs/conventions.md`、`docs/direct-work.md` は、作者が開発を進めるための自動化の仕組み（ローカルの AI に作業を任せる「teamNeo」）が使うファイルです。使う人・貢献する人は**無視して構いません**。

## 貢献する

Issue や Pull Request を歓迎します。進め方は [CONTRIBUTING.md](CONTRIBUTING.md) を見てください。

## ライセンス

[MIT License](LICENSE)
