---
id: "0013"
title: parseModMessage の open に、省略可能な newTab を通す
status: todo
depends_on: ["0012"]
gpu_need: none
tool: code
context_files:
  - work/app/src/core/protocol.ts
human_review: false
expected_outputs:
  - work/app/tests/protocol-open-newtab.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/protocol.test.ts tests/protocol-additions.test.ts tests/protocol-open-newtab.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/protocol.ts` の `parseCallParams` 関数の `case "open": { … }` の中だけを、**edits で1回だけ**直す（他の case と関数は変えない）。

タグビュー・時間割ビューから「フォルダを新しいタブで開く」ために、`open` の params に省略可能な `newTab` が加わった（ADR 0009 判断3）。

- `newTab` が無い（`undefined`）なら、今までどおり（調べた後の params に `newTab` のキーを作らない）
- `newTab` があれば、真偽値（`typeof newTab === "boolean"`）でなければ失敗（`{ ok: false }`）。真偽値なら、調べた後の params に `newTab` を入れる
- `id`・`path`・`from` の扱いは今までどおり

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/protocol-open-newtab.test.ts` を作る（既存のテストのファイルは変えない）。
  Vitest（`import { describe, it, expect } from "vitest"`）で、import は `from "../src/core/protocol"` と `import type { CallMessage } from "../src/api/types"`。
  成功のときの params は `(result.message as CallMessage).params` で取り出して `toEqual` で比べる。すべて `{ ep: 1, kind: "call", id: 5, method: "open", params: … }` の形で渡す
- `{ id: "a", path: "C:\\x", newTab: true }` → params が `{ id: "a", path: "C:\\x", newTab: true }`
- `{ id: "a", path: "C:\\x", newTab: false }` → params が `{ id: "a", path: "C:\\x", newTab: false }`
- `{ id: "a", path: "C:\\x" }` → params が `{ id: "a", path: "C:\\x" }`（`newTab` のキーが無い）
- `{ id: "a", path: "C:\\x", newTab: true, from: { x: 1, y: 2, width: 3, height: 4 } }` → params が `{ id: "a", path: "C:\\x", from: { x: 1, y: 2, width: 3, height: 4 }, newTab: true }`
- `{ id: "a", path: "C:\\x", newTab: "yes" }` → `{ ok: false, id: 5, error: { code: "invalid", … } }`（`ok`・`id`・`error.code` を比べる）
- 既存の `tests/protocol.test.ts`・`tests/protocol-additions.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
