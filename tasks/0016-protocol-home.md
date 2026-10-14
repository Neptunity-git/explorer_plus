---
id: '0016'
title: parseModMessage に、ホーム・クイックアクセスなどの呼び出しを足し、createFolder に name を通す
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/core/protocol.ts
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/tests/protocol-home.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/protocol.test.ts tests/protocol-additions.test.ts
  tests/protocol-tags.test.ts tests/protocol-open-newtab.test.ts tests/protocol-home.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0016-a1
attempt: 1
implementer_report: protocol.ts を edits で修正し、新しいテストファイル work/app/tests/protocol-home.test.ts
  を作成した。createFolder の name 検証、timetable.delete/views.list/quickAccess.list/recent.list
  の空 params、tabs.open の viewId/path/replace 検証、quickAccess.pin/unpin の items 検証を実装した。
last_changed_files:
- work/app/tests/protocol-home.test.ts
- work/app/src/core/protocol.ts
review_reason: すべての受け入れ条件を満たしている。インポート追加、createFolder/timetable.delete/views.list/quickAccess.list/recent.list/tabs.open/quickAccess.pin/quickAccess.unpin
  のロジック実装が仕様通り。新しいテストファイルは成功・失敗ケースをすべてカバーし、自動検証で95テスト合格。指示範囲内の変更のみ（protocol.ts と新しいテストファイル）。
---
## Instructions

`work/app/src/core/protocol.ts` を **edits で** 直す（全文を書き直さない。`types.ts` は変更しない。method と定数は既に足してある）。
**このタスクで直すのは protocol.ts と、新しいテストのファイルだけ。既存のテストのファイルは変えない**
（`tests/protocol-additions.test.ts` の createFolder のテストは、新しい仕様に合わせて既に直してある）。

### 直すこと

1. 1行目の `import { … } from "../api/types";` に `QUICK_ACCESS_MAX_ITEMS` を足す
2. `parseCallParams` の `case "createFolder":` を、次の決まりに置き換える：
   `name` が無い（`undefined`）なら `{}`。あれば、文字列で長さ（`.length`）1〜255 なら `{ name }`、それ以外は `{ ok: false }`。ほかの項目はコピーしない
3. `default:` の**直前**に、次の case を足す（既存の case は変えない）

| method | params の決まり | 調べた後の params |
|---|---|---|
| `timetable.delete`・`views.list`・`quickAccess.list`・`recent.list` | 中身は見ない | `{}` |
| `tabs.open` | `viewId` は空でない文字列で長さ 64 以下。`path` は省略可能で、あれば空でない文字列。`replace` は省略可能で、あれば真偽値（`typeof replace === "boolean"`） | `{ viewId }` に、渡されたときだけ `path`・`replace` を足したもの |
| `quickAccess.pin`・`quickAccess.unpin` | `items` は ref の配列で 1〜`QUICK_ACCESS_MAX_ITEMS` 件（今ある `parseRefArray` で調べる） | `{ items }` |

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/protocol-home.test.ts` を作る。Vitest（`import { describe, it, expect } from "vitest"`）で、
  import は `from "../src/core/protocol"` と `import type { CallMessage } from "../src/api/types"`。
  成功のときの params は **必ず** `(result.message as CallMessage).params` で取り出して `toEqual` で比べる（`result.message.params` と直接書くと型チェックで落ちる）。
  失敗は `ok`・`id`・`error.code` を比べる。以下はすべて `{ ep: 1, kind: "call", id: 5, method: …, params: … }` の形で渡す
- 成功：
  - `createFolder`, `{}` → `{}`。`createFolder`, `{ name: "線形代数" }` → `{ name: "線形代数" }`
  - `timetable.delete`, `{ a: 1 }` → `{}`。`views.list`, `{}` → `{}`。`quickAccess.list`, `{}` → `{}`。`recent.list`, `{}` → `{}`
  - `tabs.open`, `{ viewId: "builtin.notes" }` → `{ viewId: "builtin.notes" }`（`path` のキーが無い）
  - `tabs.open`, `{ viewId: "builtin.win11", path: "C:\\x", q: 1 }` → `{ viewId: "builtin.win11", path: "C:\\x" }`
  - `tabs.open`, `{ viewId: "builtin.win11", path: "C:\\x", replace: true }` → `{ viewId: "builtin.win11", path: "C:\\x", replace: true }`
  - `quickAccess.pin`, `{ items: [{ id: "1:a", path: "C:\\a", z: 1 }] }` → `{ items: [{ id: "1:a", path: "C:\\a" }] }`
  - `quickAccess.unpin`, `{ items: [{ id: "", path: "E:\\a" }] }` → `{ items: [{ id: "", path: "E:\\a" }] }`
- 失敗（すべて `ok: false`・`id: 5`・`error.code === "invalid"`）：
  - `createFolder`：`{ name: "" }`、`{ name: "x".repeat(256) }`、`{ name: 3 }`
  - `tabs.open`：`{}`、`{ viewId: "" }`、`{ viewId: "x".repeat(65) }`、`{ viewId: "a", path: "" }`、`{ viewId: "a", path: 1 }`、`{ viewId: "a", replace: "yes" }`
  - `quickAccess.pin`：`{ items: [] }`、`{}`、`{ items: 101 件の { id: "a", path: "p" } }`
- 既存の `tests/protocol.test.ts`・`tests/protocol-additions.test.ts`・`tests/protocol-tags.test.ts`・`tests/protocol-open-newtab.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
