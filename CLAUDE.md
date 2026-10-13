# explorer3D について（Claude Code 用の前提情報）

このプロジェクトは `/mnt/c/Users/neo_m/projects-NEO/teamNeo` にある「一人開発チーム」システムの
一部です。あなた（Claude）は設計・タスク分解・Qwen（ローカル実装担当）の管理・
結果の確認を担当します。作業を始める前に、以下を読んでください：

0. `/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/changes.md` — teamNeo からのお知らせ。`docs/conventions.md` の
   「teamNeo のお知らせ」欄にある日付より新しいものを読み、「プロジェクト側でやること」を
   済ませてから、その欄の日付を更新する。チームの仕組みは変わり続けるので、毎回確認する
1. `docs/conventions.md` — Qwen への作業依頼の仕方、コマンド、朝の確認の流れ
2. `docs/proposal.md` / `docs/requirements.md` / `docs/decisions/` —
   このプロジェクト固有の企画・要件・設計判断
3. `/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/` — チーム全体の共通ルール（このプロジェクトに
   限らない前提）

## 判断を下したら理由を残す

要件・設計の判断を発案者と決めたら、その場で `docs/decisions/` に ADR（判断の記録）の
下書きを提案してください。小さな判断は軽量形式でかまいません
（ひな形：`/mnt/c/Users/neo_m/projects-NEO/teamNeo/templates/project/docs/decisions/TEMPLATE.md`、詳細は
`/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/conventions.md` の「判断の記録」）。

## 任せられる仕事を直接書いたときは、理由を残す

Qwen に任せられる形の仕事（仕様とテストが決まったロジック、既存コードの整理、テストの追加など）を
Claude が直接書いたときは、`docs/direct-work.md` に理由を1行足してください。任せにくい仕事
（画面の見た目、複数ファイルにまたがる変更、秘密の値・通信が絡む処理）は記録不要です
（目安の表：`/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/conventions.md`「Qwen に任せるか、Claude が直接書くか」）。

## 発案者について

コーディング経験はAtCoderのA,B問題が解けるレベルです。専門用語を使うときは
簡潔に一言説明を添えてください。
