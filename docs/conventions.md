# 運営ルール・規約：explorer_plus

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
python3 -m orchestrator status  /mnt/c/Users/neo_m/projects-NEO/explorer_plus                  # タスクの状態一覧
python3 -m orchestrator run     /mnt/c/Users/neo_m/projects-NEO/explorer_plus tasks/<ファイル名>  # 1件だけ最後まで流す
python3 -m orchestrator loop    /mnt/c/Users/neo_m/projects-NEO/explorer_plus --until 07:00    # 自律運用（複数プロジェクト可）
python3 -m orchestrator approve /mnt/c/Users/neo_m/projects-NEO/explorer_plus <タスクID>         # 人間の最終承認 → main へマージ
python3 -m orchestrator retry   /mnt/c/Users/neo_m/projects-NEO/explorer_plus <タスクID> --note "やり直しの指示"
python3 -m orchestrator triage  /mnt/c/Users/neo_m/projects-NEO/explorer_plus <タスクID>        # 止まったタスクを Claude に見直させる
python3 -m orchestrator resolve /mnt/c/Users/neo_m/projects-NEO/explorer_plus <タスクID> --note "何をどう直したか"  # main で直接直して完了にする
```

## 朝の確認（Claude が発案者と一緒に行う）

- `logs/run-report_*.md`（実行レポート）を読み、`verifying`（確認待ち）と
  `blocked`（止まっている）タスクを発案者に報告する
- `verifying` はブランチの差分を確認し、発案者の了承を得て `approve` する
- `blocked` は原因を読み、タスクの指示を直して `retry` するか、タスクを分解し直す

## teamNeo のお知らせ

`/mnt/c/Users/neo_m/projects-NEO/teamNeo/docs/changes.md` を確認済みの日付：2026-10-22

## このプロジェクト固有の規約

- アプリは `work/app/`（Tauri 2 ＋ Vite ＋ TypeScript。ADR 0006）。Rust は `work/app/src-tauri/`
- 置き場所：MOD の API の型 `src/api/`（Claude が書く正本）、画面に依存しない純粋なロジック `src/core/`（Qwen に任せる中心）、
  本体の画面 `src/host/`、MOD の中で動くランタイム `src/runtime/`、標準のビュー `views/<id>/`、テスト `tests/`
- テストは Vitest。タスクの `test_command` は、そのタスクのテストのファイルだけを流す：
  `bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx vitest run tests/<名前>.test.ts"`
- MOD の API の約束事は `docs/design/mod-api-v1.md`。API に触れるタスクは、これと `work/app/src/api/types.ts` を `context_files` に入れる
- 開発用のデスクトップ PC は Wi-Fi が無く、位置情報が取れない。位置情報は BYOD のノート PC で確かめる
- `test_command` には型チェックも入れる（Vitest は型を検査しないため。0003 で、テストは合格したが `tsc` で落ちた）：
  `bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/<名前>.test.ts"`
