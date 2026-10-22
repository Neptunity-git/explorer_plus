# 貢献のしかた

explorer_plus に興味を持ってくれてありがとうございます。バグの報告、案の相談、Pull Request（変更の提案）、MOD の共有を歓迎します。
このリポジトリの文書は日本語ですが、Issue や PR は英語でもかまいません。

## まず Issue で相談してほしいもの

- 新しい機能や、見た目・操作の大きな変更
- 本体のしくみ（MOD の API、データの置き場所など）に関わる変更

設計の判断は `docs/decisions/` に ADR（判断の記録）として残しています。新しい機能の前に、関係する ADR を読むと、
「なぜ今の形なのか」が分かります。大きな判断をしたときは、PR に ADR の下書き（`docs/decisions/TEMPLATE.md` の形）を添えてもらえると助かります。

誤字、小さなバグ修正、テストの追加は、相談なしでそのまま PR にしてください。

## 開発環境

[README の「ソースから動かす」](README.md#ソースから動かす) のとおりです。アプリ本体は `work/app/` にあります。

```powershell
cd work/app
npm install
npm test          # テスト（Vitest）。PR の前に通してください
npm run build     # 型の検査（tsc）とビルド。こちらも通してください
```

- ロジックは `work/app/src/core/` に TypeScript で書き、テストは `work/app/tests/` に置きます。Windows の機能を呼ぶ部分だけ Rust（`work/app/src-tauri/`）です
- 画面の見た目は、`npm run tauri dev` で動かして確かめてください

## Pull Request

- 1つの PR は、1つの目的に絞ってください（小さいほど早く見られます）
- 変更したロジックには、テストを足してください
- コミットメッセージは、何を変えたかが分かる短い文にしてください（日本語・英語どちらでも）
- 作者の開発の自動化は `work/` の下を直接書き換えることがあります。大きな PR は、最新の `main` に合わせてから出してもらえると衝突が減ります

## MOD を作ったとき

MOD（ビューを足すフォルダ）は、本体に入れなくても、zip で配れます。作り方は [MOD 開発ガイド](work/app/mod-docs/guide.md) を見てください。
同梱してほしい MOD があれば、Issue で教えてください。

## `tasks/`・`logs/` などについて

`tasks/`、`logs/`、`config.yaml`、`CLAUDE.md`、`docs/conventions.md`、`docs/direct-work.md` は、作者が使う開発の自動化の仕組み（teamNeo）のファイルです。
外の方が読んだり、PR で触ったりする必要はありません。

## ライセンス

貢献した内容は、このリポジトリと同じ [MIT License](LICENSE) で公開されることに同意したものとして扱います。
