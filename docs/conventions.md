# 運営ルール・規約：explorer3D

チーム共通の規約（開発プロセス、ADR形式、タスクのステータス設計、リトライ規則、
ブランチ運用、自律運用）は `/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/conventions.md` に従う。

## Qwen への作業依頼（Claude が行う）

- Qwen（ローカル実装担当）への指示は、**発案者が直接行わない**。Claude が
  タスク分解・実行・結果確認までを代行する
- タスクは `tasks/` に、`/mnt/c/Users/neo_m/projects-NEO/teamNeo/templates/task.md` の形式で1タスク1ファイル
  で作る。Qwen が1回で完結できる小さい粒度（数分で終わる程度）に分解する
- GPU を実際に使う処理（レンダリング、ライトマップベイク、EEVEE 等）は
  `gpu_need: exclusive`、それ以外は `gpu_need: none` にする
- Qwen に読ませたい docs は `context_files` に書き、**コミットしておく**
  （Qwen は main にコミット済みの内容を見る）
- `work/` は Qwen の作業場所。人が `work/` を直接編集したら、自律運用を始める前に
  コミットしておく（未コミットだと Qwen の成果物のマージと衝突するため、ループが
  このプロジェクトをスキップする）

## コマンド（WSL の bash で、teamNeo のディレクトリに移動してから）

```bash
cd /mnt/c/Users/neo_m/projects-NEO/teamNeo
python3 -m orchestrator status  /mnt/c/Users/neo_m/projects-NEO/explorer3D                  # タスクの状態一覧
python3 -m orchestrator run     /mnt/c/Users/neo_m/projects-NEO/explorer3D tasks/<ファイル名>  # 1件だけ最後まで流す
python3 -m orchestrator loop    /mnt/c/Users/neo_m/projects-NEO/explorer3D --until 07:00    # 自律運用（複数プロジェクト可）
python3 -m orchestrator approve /mnt/c/Users/neo_m/projects-NEO/explorer3D <タスクID>         # 人間の最終承認 → main へマージ
python3 -m orchestrator retry   /mnt/c/Users/neo_m/projects-NEO/explorer3D <タスクID> --note "やり直しの指示"
python3 -m orchestrator triage  /mnt/c/Users/neo_m/projects-NEO/explorer3D <タスクID>        # 止まったタスクを Claude に見直させる
python3 -m orchestrator resolve /mnt/c/Users/neo_m/projects-NEO/explorer3D <タスクID> --note "何をどう直したか"  # main で直接直して完了にする
```

## 朝の確認（Claude が発案者と一緒に行う）

- `logs/run-report_*.md`（実行レポート）を読み、`verifying`（確認待ち）と
  `blocked`（止まっている）タスクを発案者に報告する
- `verifying` はブランチの差分を確認し、発案者の了承を得て `approve` する
- `blocked` は原因を読み、タスクの指示を直して `retry` するか、タスクを分解し直す

## teamNeo のお知らせ

`/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/changes.md` を確認済みの日付：2026-10-13（プロジェクトの作成日。それ以前のお知らせは反映済み）

## このプロジェクト固有の規約
