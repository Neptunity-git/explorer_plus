---
id: "0020"
title: 時間割のコマとオンデマンドの授業の memo（短いメモ）を検査する
status: todo
depends_on: []
gpu_need: none
tool: code
context_files:
  - work/app/src/core/timetable.ts
  - work/app/src/api/types.ts
human_review: false
expected_outputs:
  - work/app/tests/timetable-memo.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/timetable.test.ts tests/timetable-ondemand.test.ts tests/timetable-memo.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/timetable.ts` の `validateTimetable` 関数を **edits で** 直す（全文を書き直さない。`types.ts` は変更しない。`TimetableSlot` と
`TimetableOndemand` に `memo?: string` は既に足してある）。**このタスクで変えるのは timetable.ts と、新しいテストのファイルだけ。既存のテストのファイルは変えない。**

コマとオンデマンドの授業に、短いメモ `memo` が加わった（ADR 0015 判断4）。

- `slots[i].memo`：無い（`undefined`）なら今までどおり（出力に `memo` のキーを作らない）。あれば、文字列で長さ（`.length`）0〜200。
  守っていなければ `"slots[i].memo: "` で始まる誤り（`i` は番号）。正しければ、出力のその slot に `memo` を入れる
- `ondemand[i].memo`：同じ決まりで、誤りの頭は `"ondemand[i].memo: "`

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/timetable-memo.test.ts` を作る。Vitest（`import { describe, it, expect } from "vitest"`）で、import は `from "../src/core/timetable"`。
  土台は次の値（テストの中で作る）：
  ```ts
  const base = {
    days: [1],
    periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30" }],
    slots: [{ day: 1, periodId: "p1", title: "英語", folders: [] }],
    place: null,
    ondemand: [{ id: "o1", title: "情報倫理", folders: [] }],
  };
  ```
- 土台そのまま → `ok: true` で、出力の `slots[0]` と `ondemand[0]` に `memo` のキーが無い
- `slots[0]` に `memo: "301教室"` → `ok: true` で、出力の `slots[0]` が `{ day: 1, periodId: "p1", title: "英語", folders: [], memo: "301教室" }`（`toEqual`）
- `ondemand[0]` に `memo: "毎週金曜まで"` → `ok: true` で、出力の `ondemand[0]` が `{ id: "o1", title: "情報倫理", folders: [], memo: "毎週金曜まで" }`
- `slots[0]` に `memo: ""` → `ok: true` で、出力の `slots[0].memo` が `""`
- `slots[0]` に `memo: "x".repeat(200)` → `ok: true`
- 誤り（`ok: false` で、`errors` に、書いた頭で始まるものがある）：
  - `slots[0]` に `memo: "x".repeat(201)` → `"slots[0].memo: "`
  - `slots[0]` に `memo: 3` → `"slots[0].memo: "`
  - `ondemand[0]` に `memo: null` → `"ondemand[0].memo: "`
- 既存の `tests/timetable.test.ts`・`tests/timetable-ondemand.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
