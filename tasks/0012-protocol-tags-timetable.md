---
id: '0012'
title: parseModMessage にタグ・時間割の呼び出し（tags.* と timetable.*）を足す
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/core/protocol.ts
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/tests/protocol-tags.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/protocol.test.ts tests/protocol-additions.test.ts
  tests/protocol-tags.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 1
branch: task/0012-a2
attempt: 2
implementer_report: 失敗の原因はテスト側の型定義不足です。protocol.ts の実装は受け入れ条件を満たしており、types.ts も既に
  TAG_ASSIGN_MAX_ITEMS・TAG_NAME_MAX を export 済みです。前回のテストファイルは vitest の describe/it/expect
  を import していなかったため、tsc --noEmit で TS2304/TS2593 が発生していました。テストファイルの先頭に `import {
  describe, expect, it } from "vitest";` を1行足すだけで型チェックが通ります。実装（protocol.ts）は既に正しく、変更は不要です。
last_changed_files:
- work/app/tests/protocol-tags.test.ts
- work/app/src/core/protocol.ts
review_reason: 受け入れ条件をすべて満たしています。protocol.ts は edits で 2 か所修正（import に TAG_ASSIGN_MAX_ITEMS
  と TAG_NAME_MAX を追加、parseCallParams の switch に tags・timetable メソッド 7 種類の case を追加）。types.ts
  は変更なし。テストファイル protocol-tags.test.ts は vitest imports を含み、成功・失敗ケース 23 個をカバー。自動検証で
  67 test すべて pass、型チェックも通過。
---
## Instructions

`work/app/src/core/protocol.ts` を、**edits で1回だけ**直す（全文を書き直さない）。`types.ts` は変更しない（method と定数は既に足してある）。

直すのは2か所だけ：

1. 1行目の `import { … } from "../api/types";` に、`TAG_ASSIGN_MAX_ITEMS` と `TAG_NAME_MAX` を足す
2. `parseCallParams` 関数の `switch` の `default:` の**直前**に、下の表の `case` を足す（既存の case は変えない）

文字列の長さは `.length` で数える。「id」は「空でない文字列で、長さ 64 以下」のこと。ref の配列は、今ある `parseRefArray(値, 最小, 最大)` で調べる。

| method | params の決まり | 調べた後の params |
|---|---|---|
| `tags.list`・`timetable.get`・`timetable.current` | 中身は見ない | `{}` |
| `tags.create` | `name` は文字列で長さ 1〜`TAG_NAME_MAX`、`color` は文字列で長さ 1〜16（色の細かい検査は別の関数が行う） | `{ name, color }` |
| `tags.update` | `id` は id。`name` は省略可能で、あれば文字列で長さ 1〜`TAG_NAME_MAX`。`color` は省略可能で、あれば文字列で長さ 1〜16。`name` と `color` の**少なくとも一方**がある | `{ id }` に、渡された `name`・`color` だけを足したもの |
| `tags.delete` | `id` は id | `{ id }` |
| `tags.assign` | `items` は ref の配列で 1〜`TAG_ASSIGN_MAX_ITEMS` 件、`tagId` は id、`on` は真偽値（`typeof on === "boolean"`） | `{ items, tagId, on }` |
| `tags.entries` | `tagId` は id | `{ tagId }` |
| `timetable.set` | `"timetable" in params`（値の中身は見ない。別の関数で検査する） | `{ timetable }` |

決まりを守っていなければ、他の method と同じく `{ ok: false }`。

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/protocol-tags.test.ts` を作る（既存の `tests/protocol.test.ts`・`tests/protocol-additions.test.ts` は変えない）。
  Vitest（`import { describe, it, expect } from "vitest"`）で、import は `from "../src/core/protocol"`（拡張子なし）と
  `import type { CallMessage } from "../src/api/types"`。成功のときの params は `(result.message as CallMessage).params` で取り出して `toEqual` で比べる
  （`result.message.params` と直接書くと、型チェックで落ちる）。失敗は `ok`・`id`・`error.code` を比べる。
  以下はすべて `{ ep: 1, kind: "call", id: 5, method: …, params: … }` の形で渡す
- 成功：
  - `tags.list`, `{ a: 1 }` → params `{}`。`timetable.get`, `{}` → `{}`。`timetable.current`, `{}` → `{}`
  - `tags.create`, `{ name: "重要", color: "#ff0000", x: 1 }` → `{ name: "重要", color: "#ff0000" }`
  - `tags.update`, `{ id: "tag-1", color: "#00ff00" }` → `{ id: "tag-1", color: "#00ff00" }`（`name` のキーが無い）
  - `tags.update`, `{ id: "tag-1", name: "a", color: "#000000" }` → `{ id: "tag-1", name: "a", color: "#000000" }`
  - `tags.delete`, `{ id: "tag-1" }` → `{ id: "tag-1" }`
  - `tags.assign`, `{ items: [{ id: "1:a", path: "C:\\a", q: 1 }], tagId: "tag-1", on: false }` → `{ items: [{ id: "1:a", path: "C:\\a" }], tagId: "tag-1", on: false }`
  - `tags.entries`, `{ tagId: "tag-1" }` → `{ tagId: "tag-1" }`
  - `timetable.set`, `{ timetable: { days: [1] } }` → `{ timetable: { days: [1] } }`。`timetable.set`, `{ timetable: null }` → `{ timetable: null }`
- 失敗（すべて `ok: false`・`id: 5`・`error.code === "invalid"`）：
  - `tags.create`：`{ name: "", color: "#ff0000" }`、`{ name: "x".repeat(41), color: "#ff0000" }`、`{ name: "a" }`、`{ name: "a", color: "x".repeat(17) }`
  - `tags.update`：`{ id: "tag-1" }`（name も color も無い）、`{ id: "", color: "#000000" }`、`{ id: "x".repeat(65), color: "#000000" }`、`{ id: "tag-1", name: "" }`
  - `tags.delete`：`{}`
  - `tags.assign`：`{ items: [], tagId: "tag-1", on: true }`、`{ items: [{ id: "a", path: "p" }], tagId: "tag-1", on: "yes" }`、`{ items: [{ id: "a", path: "p" }], on: true }`
  - `tags.entries`：`{ tagId: 3 }`
  - `timetable.set`：`{}`
- 既存の `tests/protocol.test.ts`・`tests/protocol-additions.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
