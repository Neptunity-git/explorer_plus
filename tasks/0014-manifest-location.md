---
id: "0014"
title: manifest の location（フォルダと関係するか）を検査する
status: todo
depends_on: []
gpu_need: none
tool: code
context_files:
  - work/app/src/core/manifest.ts
  - work/app/src/api/types.ts
human_review: false
expected_outputs:
  - work/app/tests/manifest-location.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/manifest.test.ts tests/manifest-entry.test.ts tests/manifest-location.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/manifest.ts` を **edits で** 直す（全文を書き直さない。`types.ts` は変更しない。`Manifest` 型に `location?: "folder" | "none"` は既に足してある）。

manifest に省略可能な項目 `location` が加わった（ADR 0014 判断1）。

1. `checkDescription` 関数の後ろに、次の関数を足す：
   - 名前は `checkLocation(raw: unknown, errors: string[]): "folder" | "none" | undefined`
   - `raw` が `undefined` なら `undefined` を返す（誤りではない）
   - `raw` が `"folder"` か `"none"` ならそれを返す
   - それ以外は `errors` に `"location: must be \"folder\" or \"none\""` を足して `undefined` を返す
2. `validateManifest` の中で、`const description = checkDescription(raw.description, errors);` の次の行に
   `const location = checkLocation(raw.location, errors);` を足す
3. 成功のとき `manifest` を作る所で、`description` と同じように、`location` が `undefined` でなければ `manifest.location = location;` を足す
   （`location` が無い manifest の出力には、`location` のキーを作らない。既存のテストがそのまま通るように）

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/manifest-location.test.ts` を作る（既存の `tests/manifest.test.ts`・`tests/manifest-entry.test.ts` は変えない）。
  Vitest（`import { describe, it, expect } from "vitest"`）で、import は `from "../src/core/manifest"`。
  土台は `{ id: "neo.view", name: "View", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: [] }`
- 土台そのまま → `ok: true` で、`manifest` に `location` のキーが無い（`"location" in manifest` が false）
- `location: "none"` を足す → `ok: true` で `manifest.location` が `"none"`
- `location: "folder"` を足す → `ok: true` で `manifest.location` が `"folder"`
- `location: "global"`・`location: 1`・`location: null` → それぞれ `ok: false` で、`errors` に `"location: "` で始まるものがちょうど1つある
- 既存の `tests/manifest.test.ts`・`tests/manifest-entry.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
