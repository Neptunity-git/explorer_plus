---
id: "0006"
title: manifest の entry の検査を、Rust 側の配信と同じ厳しさにする
status: todo
depends_on: ["0001"]
gpu_need: none
tool: code
context_files:
  - work/app/src/core/manifest.ts
  - work/app/src/api/types.ts
human_review: false
expected_outputs:
  - work/app/tests/manifest-entry.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx vitest run tests/manifest.test.ts tests/manifest-entry.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/manifest.ts` の `checkEntry` 関数だけを直す（edits で、その関数の中を置き換える）。他の関数と `types.ts` は変えない。

MOD のファイルを配る Rust 側（`src-tauri/src/mods.rs`）は、`./index.js` や `a//b.js`、`\` を含む entry を断る。
TypeScript の検査がそれらを「正しい」と判定すると、MOD の一覧で食い違いが出るので、TypeScript 側も同じ決まりにする。

### 直した後の entry の決まり（上から順に調べ、最初に当てはまった誤りを1つだけ `errors` に入れる。今の書き方と同じ）

1. 文字列でない → 誤り
2. `.js` で終わらない → 誤り
3. `/` で始まる → 誤り
4. `\` を**どこかに**含む → 誤り（今は「`\` で始まる」だけを断っているのを、どこにあっても断るように変える）
5. `:` を含む → 誤り
6. `/` で区切った部分のどれかが、空文字 `""`・`"."`・`".."` のどれか → 誤り（今は `..` だけを断っているのを、空と `.` も断るように変える。`\` では区切らない（4 で断っているため））

誤りの文字列は、今までどおり `"entry: "` で始める。

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/manifest-entry.test.ts` を作る（既存の `tests/manifest.test.ts` は変えない）。
  Vitest（`import { describe, it, expect } from "vitest"`）で、import は `from "../src/core/manifest"`（拡張子なし）。
  正しい manifest の土台として `{ id: "neo.view", name: "View", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: [] }` を使い、
  `entry` だけを差し替えて確かめる
- 次の entry は、それぞれ `ok: false` で、`errors` に `"entry: "` で始まるものがちょうど1つある：
  `"./index.js"`、`"a//b.js"`、`"lib/./a.js"`、`"lib\\a.js"`、`"lib/a.js\\"`（`.js` で終わらないので 2 の誤り）、`"a/"`、`"../a.js"`
- 次の entry は `ok: true`：`"index.js"`、`"dist/main.js"`、`"a/b/c.js"`、`"my.view.js"`、`"..js"`（区切った部分は `"..js"` で、`".."` ではない）
- 既存の `tests/manifest.test.ts` も、変えずに合格する
- `test_command` が成功する
