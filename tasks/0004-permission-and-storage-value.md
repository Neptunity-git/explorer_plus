---
id: '0004'
title: 宣言の確認と、保存する値の検査（checkPermission / checkStorageValue）
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/src/core/permission.ts
- work/app/tests/permission.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx vitest run tests/permission.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0004-a1
attempt: 1
implementer_report: permission.ts と permission.test.ts を新規作成した。checkPermission は METHOD_REQUIRES
  を参照し、必要な use が宣言されていれば null、なければ not-declared を返す。checkStorageValue は JSON.stringify
  の例外・undefined を invalid、UTF-8 バイト数が上限を超えれば too-large、ちょうど上限なら null を返す。受け入れ条件の各ケースを
  Vitest テストで検証している。
last_changed_files:
- work/app/src/core/permission.ts
- work/app/tests/permission.test.ts
review_reason: 受け入れ条件をすべて満たしており、12個のテストがすべて成功。実装が仕様に正確に対応し、テストが条件を実際に検証している。
---
## Instructions

`work/app/src/core/permission.ts` を新しく作り、2つの関数を書く。型と定数は `work/app/src/api/types.ts` から import する
（`types.ts` は変更しない）。

```ts
import { METHOD_REQUIRES, STORAGE_VALUE_MAX_BYTES, type ApiError, type CallMethod, type Use } from "../api/types";

export function checkPermission(uses: readonly Use[], method: CallMethod): ApiError | null;
export function checkStorageValue(value: unknown): ApiError | null;
```

### checkPermission（MOD が宣言した uses で、その method を呼べるか）

- `METHOD_REQUIRES[method]` が `null` なら `null`（呼べる）
- そうでなく、`uses` にその名前が含まれていれば `null`
- 含まれていなければ `{ code: "not-declared", message }`。`message` は、要る名前を含む英語の文
  （例：`method "getTree" requires "tree" in manifest uses`）

### checkStorageValue（MOD が保存しようとしている値が、保存できる形・大きさか）

- `JSON.stringify(value)` を試す
  - 例外が出た（循環参照、BigInt など）→ `{ code: "invalid", message }`
  - 結果が `undefined`（`value` が `undefined`・関数・Symbol のとき）→ `{ code: "invalid", message }`
- 結果の文字列を UTF-8 にしたバイト数（`new TextEncoder().encode(json).length`）が `STORAGE_VALUE_MAX_BYTES` より大きい
  → `{ code: "too-large", message }`
- それ以外は `null`（ちょうど `STORAGE_VALUE_MAX_BYTES` バイトは保存できる）
- `message` は自由（英語）

## Acceptance Criteria

- `work/app/tests/permission.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で次を確かめる。
  import は `from "../src/core/permission"`（拡張子なし）。エラーは `code` だけ比べる（`message` は比べない）
- checkPermission：
  - `([], "ready")` → `null`、`([], "storage.set")` → `null`、`([], "trash")` → `null`
  - `([], "getTree")` → code `"not-declared"`、`(["entries"], "getTree")` → code `"not-declared"`、`(["tree"], "getTree")` → `null`
  - `(["entries", "size"], "resolve")` → code `"not-declared"`、`(["links"], "resolve")` → `null`
  - `([], "getTree")` の `message` に `"tree"` という文字列が含まれる
- checkStorageValue：
  - `{ a: [1, 2, "x"] }` → `null`、`null` → `null`、`0` → `null`、`""` → `null`
  - `undefined` → code `"invalid"`、`() => 1` → code `"invalid"`、`10n` → code `"invalid"`
  - 自分自身を指すオブジェクト（`const o: any = {}; o.self = o;`）→ code `"invalid"`
  - JSON にすると**ちょうど** `STORAGE_VALUE_MAX_BYTES` バイトになる文字列（`"x".repeat(STORAGE_VALUE_MAX_BYTES - 2)`。前後の `"` で +2）→ `null`
  - それより1バイト多い文字列（`"x".repeat(STORAGE_VALUE_MAX_BYTES - 1)`）→ code `"too-large"`
  - `"あ".repeat(400000)`（UTF-8 で 1 文字 3 バイトなので約 1.2MB）→ code `"too-large"`
- `test_command` が成功する
