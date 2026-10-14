---
id: "0015"
title: 時間割のオンデマンドの枠（ondemand）を検査する
status: todo
depends_on: []
gpu_need: none
tool: code
context_files:
  - work/app/src/core/timetable.ts
  - work/app/src/api/types.ts
human_review: false
expected_outputs:
  - work/app/tests/timetable-ondemand.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/timetable.test.ts tests/timetable-ondemand.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/timetable.ts` の `validateTimetable` 関数を **edits で** 直す（全文を書き直さない。`parseTime`・`emptyTimetable` と `types.ts` は変えない）。
時間割に、曜日・時限の無い「オンデマンド」の授業の一覧 `ondemand` が加わった（ADR 0012 判断2。型は `types.ts` の `TimetableOndemand`。`Timetable` の `ondemand?` は既に足してある）。

### 決まり

- `raw.ondemand` が `undefined`（無い）なら、今までどおり。出力の `timetable` に `ondemand` のキーを作らない（既存のテストがそのまま通るように）
- あれば、`place` の検査の**後に**、次を調べる。誤りの文字列は、ほかの項目と同じく「誤りの頭」＋ `": "` ＋ 自由な英語

| 項目 | 正しい値 | 誤りの頭 |
|---|---|---|
| `ondemand` | 配列で、長さ 50 以下 | `ondemand` |
| 各要素 | 普通のオブジェクト | `ondemand[i]` |
| `ondemand[i].id` | 文字列で長さ 1〜32。それより前の要素と同じ id は誤り | `ondemand[i].id` |
| `ondemand[i].title` | 文字列で長さ 1〜60 | `ondemand[i].title` |
| `ondemand[i].folders` | `slots[i].folders` と同じ決まり（配列で 0〜5 個、各要素は `id` が文字列（空文字可）、`path` が空でない文字列） | `ondemand[i].folders` |

- 誤りが無ければ、出力に `ondemand: [{ id, title, folders: [{ id, path }, …] }, …]` を入れる（知らない項目はコピーしない）

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/timetable-ondemand.test.ts` を作る（既存の `tests/timetable.test.ts` は変えない）。
  Vitest（`import { describe, it, expect } from "vitest"`）で、import は `from "../src/core/timetable"`。
  土台は `{ days: [1], periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30" }], slots: [], place: null }`
- 土台そのまま → `ok: true` で、出力の `timetable` に `ondemand` のキーが無い
- 土台に `ondemand: [{ id: "o1", title: "情報倫理", folders: [{ id: "a:b", path: "C:\\情報倫理", x: 1 }], memo: "x" }]` → `ok: true` で、
  出力の `timetable.ondemand` が `[{ id: "o1", title: "情報倫理", folders: [{ id: "a:b", path: "C:\\情報倫理" }] }]`（`toEqual`）
- 土台に `ondemand: []` → `ok: true` で、`timetable.ondemand` が `[]`
- 誤り（`ok: false` で、`errors` に、書いた頭で始まるものがある）：
  - `ondemand: "x"` → `"ondemand: "`
  - `ondemand: [null]` → `"ondemand[0]: "`
  - `ondemand: [{ id: "", title: "a", folders: [] }]` → `"ondemand[0].id: "`
  - `ondemand: [{ id: "o1", title: "a", folders: [] }, { id: "o1", title: "b", folders: [] }]` → `"ondemand[1].id: "`
  - `ondemand: [{ id: "o1", title: "", folders: [] }]` → `"ondemand[0].title: "`
  - `ondemand: [{ id: "o1", title: "x".repeat(61), folders: [] }]` → `"ondemand[0].title: "`
  - `ondemand: [{ id: "o1", title: "a", folders: [{ id: "a", path: "" }] }]` → `"ondemand[0].folders: "`
  - `ondemand` を 51 個の要素（id は `"o0"`〜`"o50"`、title `"a"`、folders `[]`）にする → `"ondemand: "`
- 既存の `tests/timetable.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
