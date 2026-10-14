---
id: '0003'
title: MOD から届くメッセージを検査する parseModMessage
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- docs/design/mod-api-v1.md
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/src/core/protocol.ts
- work/app/tests/protocol.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx vitest run tests/protocol.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0003-a1
attempt: 1
implementer_report: Created work/app/src/core/protocol.ts with parseModMessage function
  and work/app/tests/protocol.test.ts with comprehensive Vitest tests covering all
  acceptance criteria.
last_changed_files:
- work/app/src/core/protocol.ts
- work/app/tests/protocol.test.ts
review_reason: 実装が仕様のすべてのルール（1-4）とmethod別のparams検証を正しく実装している。テストが受け入れ条件の全ケース（成功4、失敗16、境界値2）をカバーし、error.codeとidの検証も正確。自動検証24/24合格、コードに明らかな破綻がない。
---
## Instructions

`work/app/src/core/protocol.ts` を新しく作り、MOD（iframe）から `postMessage` で届いた値を検査する関数を書く。
MOD は他人が書いたプログラムなので、どんな値が届いても例外を投げずに結果を返すこと。仕様の背景は
`docs/design/mod-api-v1.md` の「本体と MOD のあいだのメッセージ」。型は `work/app/src/api/types.ts` から import する
（`types.ts` は変更しない）。

```ts
import { METHOD_REQUIRES, RESOLVE_MAX_REFS, TREE_DEPTH, type ApiError, type ModToHostMessage } from "../api/types";

export type ParseResult =
  | { ok: true; message: ModToHostMessage }
  | { ok: false; id: number | null; error: ApiError };

export function parseModMessage(data: unknown): ParseResult;
```

### 決まり

失敗のときの `error.code` は常に `"invalid"`。`error.message` は自由（英語）。

1. `data` が普通のオブジェクトでない（`null`・配列・文字列など）、または `data.ep !== 1` → `{ ok: false, id: null, error }`
2. `data.kind === "key"`：`key` が空でない文字列、`ctrl`・`shift`・`alt` がすべて真偽値なら
   `{ ok: true, message: { ep: 1, kind: "key", key, ctrl, shift, alt } }`（他の項目はコピーしない）。そうでなければ `id: null` で失敗
3. `data.kind === "call"`：
   - `id` が正の整数（`Number.isInteger(id) && id > 0`）でなければ `id: null` で失敗
   - ここから先の失敗は、`id` にその値を入れて返す（本体が MOD に「失敗」を返事できるように）
   - `method` が `METHOD_REQUIRES` のキーのどれでもなければ失敗
   - `params` が普通のオブジェクトでなければ失敗
   - method ごとに params を調べる（下の表）。成功なら `{ ok: true, message: { ep: 1, kind: "call", id, method, params: 調べた後の params } }`。
     調べた後の params には、表に書いた項目だけを入れる（知らない項目はコピーしない。省略可能な項目は、無ければキーを作らない）
4. `kind` がそれ以外 → `id: null` で失敗

| method | params の決まり |
|---|---|
| `ready`・`navigateUp`・`storage.keys` | 中身は見ない。調べた後の params は `{}` |
| `open` | `id`・`path` が空でない文字列。`from` は省略可能。あれば Rect |
| `navigate` | `path` が空でない文字列 |
| `trash` | `items` が、1件以上 100件以下の ref の配列。`from` は省略可能。あれば Rect |
| `storage.get`・`storage.delete` | `key` が 1〜100 文字（`key.length`）の文字列 |
| `storage.set` | `key` は上と同じ。`value` のキーが params にある（`"value" in params`。値は何でもよく、`undefined` でもよい。大きさは別の関数で調べる） |
| `getTree` | `depth` が整数で、`TREE_DEPTH.min` 以上 `TREE_DEPTH.max` 以下 |
| `resolve` | `refs` が、1件以上 `RESOLVE_MAX_REFS` 件以下の ref の配列 |

- ref：普通のオブジェクトで、`id`・`path` が空でない文字列。調べた後は `{ id, path }` だけ
- Rect：普通のオブジェクトで、`x`・`y`・`width`・`height` がすべて有限の数（`Number.isFinite`）、`width`・`height` は 0 以上。調べた後は `{ x, y, width, height }` だけ

## Acceptance Criteria

- `work/app/tests/protocol.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で次を確かめる。
  import は `from "../src/core/protocol"`（拡張子なし）。成功の結果は `toEqual` で丸ごと比べる
- `{ ep: 1, kind: "call", id: 7, method: "open", params: { id: "a:b", path: "C:\\x.txt", from: { x: 1, y: 2, width: 3, height: 4, z: 9 }, extra: true } }`
  → `{ ok: true, message: { ep: 1, kind: "call", id: 7, method: "open", params: { id: "a:b", path: "C:\\x.txt", from: { x: 1, y: 2, width: 3, height: 4 } } } }`
- `{ ep: 1, kind: "call", id: 1, method: "open", params: { id: "a:b", path: "C:\\x.txt" } }` → 成功で、params が `{ id: "a:b", path: "C:\\x.txt" }`（`from` のキーが無い）
- `{ ep: 1, kind: "call", id: 3, method: "ready", params: { anything: 1 } }` → 成功で、params が `{}`
- `{ ep: 1, kind: "call", id: 4, method: "storage.set", params: { key: "k", value: undefined } }` → 成功で、params が `{ key: "k", value: undefined }`
- `{ ep: 1, kind: "call", id: 4, method: "storage.set", params: { key: "k" } }` → `{ ok: false, id: 4, error: { code: "invalid", ... } }`（`error.code` だけ比べる）
- `{ ep: 1, kind: "key", key: "t", ctrl: true, shift: false, alt: false, extra: 1 }` → `{ ok: true, message: { ep: 1, kind: "key", key: "t", ctrl: true, shift: false, alt: false } }`
- 次はすべて `ok: false`・`id: null`・`error.code === "invalid"`：
  `null`、`"hello"`、`[]`、`{ ep: 2, kind: "call", id: 1, method: "ready", params: {} }`、`{ ep: 1, kind: "event" }`、
  `{ ep: 1, kind: "call", id: 0, method: "ready", params: {} }`、`{ ep: 1, kind: "call", id: 1.5, method: "ready", params: {} }`、
  `{ ep: 1, kind: "key", key: "", ctrl: true, shift: false, alt: false }`
- 次はすべて `ok: false`・`id: 9`・`error.code === "invalid"`（すべて `ep: 1, kind: "call", id: 9`）：
  - `method: "deleteEverything", params: {}`
  - `method: "ready"`（params が無い）
  - `method: "navigate", params: { path: "" }`
  - `method: "open", params: { id: "a", path: "p", from: { x: 0, y: 0, width: -1, height: 1 } }`
  - `method: "open", params: { id: "a", path: "p", from: { x: Infinity, y: 0, width: 1, height: 1 } }`
  - `method: "trash", params: { items: [] }`
  - `method: "trash", params: { items: [{ id: "a" }] }`
  - `method: "storage.get", params: { key: "x".repeat(101) }`
  - `method: "getTree", params: { depth: 0 }`、`{ depth: 6 }`、`{ depth: 2.5 }`
  - `method: "resolve", params: { refs: [] }`
  - `method: "resolve", params: { refs: 101 件の { id: "a", path: "p" } }`
- `method: "trash", params: { items: 100 件の { id: "a", path: "p" } }` は成功、`method: "getTree", params: { depth: 5 }` は成功
- `test_command` が成功する
