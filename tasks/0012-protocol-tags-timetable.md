---
id: '0012'
title: parseModMessage にタグ・時間割の呼び出し（tags.* と timetable.*）を足す
status: todo
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
auto_check: fail
claude_review: n/a
retry_count: 1
branch: task/0012-a1
attempt: 1
implementer_report: protocol.ts の import に TAG_ASSIGN_MAX_ITEMS と TAG_NAME_MAX を追加し、parseCallParams
  の switch の default 直前に tags.list/timetable.get/timetable.current、tags.create、tags.update、tags.delete、tags.assign、tags.entries、timetable.set
  の case を追加した。受け入れ条件の全成功・失敗ケースを検証する tests/protocol-tags.test.ts を新規作成した。
last_changed_files:
- work/app/tests/protocol-tags.test.ts
- work/app/src/core/protocol.ts
last_failure: 'nd name ''it''. Do you need to install type definitions for a test
  runner? Try `npm i --save-dev @types/jest` or `npm i --save-dev @types/mocha` and
  then add ''jest'' or ''mocha'' to the types field in your tsconfig.

  tests/protocol-tags.test.ts(205,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(207,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(208,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(212,3): error TS2593: Cannot find name ''it''. Do you
  need to install type definitions for a test runner? Try `npm i --save-dev @types/jest`
  or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha'' to the types
  field in your tsconfig.

  tests/protocol-tags.test.ts(214,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(216,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(217,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(222,1): error TS2593: Cannot find name ''describe''.
  Do you need to install type definitions for a test runner? Try `npm i --save-dev
  @types/jest` or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha''
  to the types field in your tsconfig.

  tests/protocol-tags.test.ts(223,3): error TS2593: Cannot find name ''it''. Do you
  need to install type definitions for a test runner? Try `npm i --save-dev @types/jest`
  or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha'' to the types
  field in your tsconfig.

  tests/protocol-tags.test.ts(225,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(227,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(229,9): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(234,3): error TS2593: Cannot find name ''it''. Do you
  need to install type definitions for a test runner? Try `npm i --save-dev @types/jest`
  or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha'' to the types
  field in your tsconfig.

  tests/protocol-tags.test.ts(236,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(238,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(239,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(244,1): error TS2593: Cannot find name ''describe''.
  Do you need to install type definitions for a test runner? Try `npm i --save-dev
  @types/jest` or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha''
  to the types field in your tsconfig.

  tests/protocol-tags.test.ts(245,3): error TS2593: Cannot find name ''it''. Do you
  need to install type definitions for a test runner? Try `npm i --save-dev @types/jest`
  or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha'' to the types
  field in your tsconfig.

  tests/protocol-tags.test.ts(247,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(249,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(251,9): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(256,3): error TS2593: Cannot find name ''it''. Do you
  need to install type definitions for a test runner? Try `npm i --save-dev @types/jest`
  or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha'' to the types
  field in your tsconfig.

  tests/protocol-tags.test.ts(258,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(260,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(262,9): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(267,3): error TS2593: Cannot find name ''it''. Do you
  need to install type definitions for a test runner? Try `npm i --save-dev @types/jest`
  or `npm i --save-dev @types/mocha` and then add ''jest'' or ''mocha'' to the types
  field in your tsconfig.

  tests/protocol-tags.test.ts(269,5): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(271,7): error TS2304: Cannot find name ''expect''.

  tests/protocol-tags.test.ts(272,7): error TS2304: Cannot find name ''expect''.

  '
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
