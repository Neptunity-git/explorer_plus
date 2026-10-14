---
id: '0021'
title: parseModMessage に clipboard.*・drag.* を足す
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/core/protocol.ts
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/tests/protocol-transfer.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/protocol.test.ts tests/protocol-additions.test.ts
  tests/protocol-home.test.ts tests/protocol-transfer.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0021-a1
attempt: 1
implementer_report: protocol.ts を edits で修正し、clipboard/drag 系の case を追加した。新しいテストファイル
  protocol-transfer.test.ts も作成した。
last_changed_files:
- work/app/tests/protocol-transfer.test.ts
- work/app/src/core/protocol.ts
review_reason: 受け入れ条件をすべて満たしています。import に TRANSFER_MAX_ITEMS と DROP_TARGETS_MAX を追加、parseDropTarget/parseDropTargets
  補助関数を実装、parseCallParams に 6 つの新しい case を追加（default:の直前）。20 個のテストケースで成功例と失敗例をすべてカバーし、既存テストも変更なく合格しています。
---
## Instructions

`work/app/src/core/protocol.ts` を **edits で** 直す（全文を書き直さない。`types.ts` は変更しない。method と定数・`DropTarget` 型は既に足してある）。
**このタスクで変えるのは protocol.ts と、新しいテストのファイルだけ。既存のテストのファイルは変えない。**

### 直すこと

1. 1行目の `import { … } from "../api/types";` に `TRANSFER_MAX_ITEMS` と `DROP_TARGETS_MAX` を足す
2. `parseCallParams` の `switch` の `default:` の**直前**に、次の case を足す（既存の case は変えない）

| method | params の決まり | 調べた後の params |
|---|---|---|
| `clipboard.copy`・`clipboard.cut` | `items` は ref の配列で 1〜`TRANSFER_MAX_ITEMS` 件（今ある `parseRefArray` で調べる） | `{ items }` |
| `clipboard.paste` | 中身は見ない | `{}` |
| `drag.start` | `items` は ref の配列で 1〜`TRANSFER_MAX_ITEMS` 件。`x`・`y` は有限の数（`Number.isFinite`）。`targets` は落とせる場所の配列で 0〜`DROP_TARGETS_MAX` 件 | `{ items, x, y, targets }` |
| `drag.targets` | `targets` は落とせる場所の配列で 0〜`DROP_TARGETS_MAX` 件 | `{ targets }` |
| `drag.move` | `x`・`y` は有限の数。`ctrl`・`shift` は真偽値（`typeof … === "boolean"`） | `{ x, y, ctrl, shift }` |
| `drag.end` | `x`・`y` は有限の数。`ctrl`・`shift`・`cancel` は真偽値 | `{ x, y, ctrl, shift, cancel }` |

- 落とせる場所（`targets` の各要素）：普通のオブジェクトで、`id` は文字列（空文字でもよい）、`path` は空でない文字列、`x`・`y`・`width`・`height` は有限の数で、`width`・`height` は 0 以上。
  調べた後は `{ id, path, x, y, width, height }` だけ（知らない項目はコピーしない）。1つでも守っていなければ、その呼び出しは失敗（`{ ok: false }`）
- そのための補助の関数（例：`parseDropTargets(value: unknown)`）を、`parseRefArray` の近くに足してよい

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/protocol-transfer.test.ts` を作る。Vitest（`import { describe, it, expect } from "vitest"`）で、
  import は `from "../src/core/protocol"` と `import type { CallMessage } from "../src/api/types"`。
  成功のときの params は **必ず** `(result.message as CallMessage).params` で取り出して `toEqual` で比べる（`result.message.params` と直接書くと型チェックで落ちる）。
  失敗は `ok`・`id`・`error.code` を比べる。以下はすべて `{ ep: 1, kind: "call", id: 5, method: …, params: … }` の形で渡す
- 成功：
  - `clipboard.copy`, `{ items: [{ id: "1:a", path: "C:\\a", z: 1 }] }` → `{ items: [{ id: "1:a", path: "C:\\a" }] }`
  - `clipboard.cut`, `{ items: [{ id: "", path: "E:\\a" }] }` → `{ items: [{ id: "", path: "E:\\a" }] }`
  - `clipboard.paste`, `{ a: 1 }` → `{}`
  - `drag.start`, `{ items: [{ id: "1:a", path: "C:\\a" }], x: 10, y: 20.5, targets: [{ id: "1:f", path: "C:\\f", x: 0, y: 30, width: 400, height: 28, q: 1 }] }`
    → `{ items: [{ id: "1:a", path: "C:\\a" }], x: 10, y: 20.5, targets: [{ id: "1:f", path: "C:\\f", x: 0, y: 30, width: 400, height: 28 }] }`
  - `drag.start`, `{ items: [{ id: "1:a", path: "C:\\a" }], x: 0, y: 0, targets: [] }` → `{ items: [{ id: "1:a", path: "C:\\a" }], x: 0, y: 0, targets: [] }`
  - `drag.targets`, `{ targets: [{ id: "", path: "E:\\f", x: 1, y: 2, width: 3, height: 4 }] }` → `{ targets: [{ id: "", path: "E:\\f", x: 1, y: 2, width: 3, height: 4 }] }`
  - `drag.move`, `{ x: -5, y: 300.5, ctrl: true, shift: false, q: 1 }` → `{ x: -5, y: 300.5, ctrl: true, shift: false }`
  - `drag.end`, `{ x: 1, y: 2, ctrl: false, shift: true, cancel: false }` → `{ x: 1, y: 2, ctrl: false, shift: true, cancel: false }`
- 失敗（すべて `ok: false`・`id: 5`・`error.code === "invalid"`）：
  - `clipboard.copy`：`{ items: [] }`、`{}`、`{ items: 1001 件の { id: "a", path: "p" } }`
  - `drag.start`：`{ items: [], x: 0, y: 0, targets: [] }`、`{ items: [{ id: "a", path: "p" }], x: NaN, y: 0, targets: [] }`、`{ items: [{ id: "a", path: "p" }], x: 0, y: 0 }`（targets が無い）、
    `{ items: [{ id: "a", path: "p" }], x: 0, y: 0, targets: [{ id: "a", path: "", x: 0, y: 0, width: 1, height: 1 }] }`、
    `{ items: [{ id: "a", path: "p" }], x: 0, y: 0, targets: [{ id: "a", path: "p", x: 0, y: 0, width: -1, height: 1 }] }`
  - `drag.targets`：`{}`、`{ targets: 501 件の { id: "a", path: "p", x: 0, y: 0, width: 1, height: 1 } }`
  - `drag.move`：`{ x: 0, y: 0, ctrl: false }`（shift が無い）、`{ x: Infinity, y: 0, ctrl: false, shift: false }`
  - `drag.end`：`{ x: 0, y: 0, ctrl: false, shift: false }`（cancel が無い）、`{ x: 0, y: 0, ctrl: false, shift: false, cancel: "no" }`
- 既存の `tests/protocol.test.ts`・`tests/protocol-additions.test.ts`・`tests/protocol-home.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
