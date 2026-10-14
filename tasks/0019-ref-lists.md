---
id: 0019
title: クイックアクセスと最近使った項目の一覧を操作する関数
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
- work/app/src/core/tags.ts
human_review: false
expected_outputs:
- work/app/src/core/ref-lists.ts
- work/app/tests/ref-lists.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/ref-lists.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0019-a1
attempt: 1
implementer_report: ref-lists.ts と ref-lists.test.ts を作成しました。pinRefs・unpinRefs・pushRecent
  はすべて引数の配列を書き換えず新しい配列を返します。sameRef は ./tags から import しています。
last_changed_files:
- work/app/src/core/ref-lists.ts
- work/app/tests/ref-lists.test.ts
review_reason: 受け入れ条件をすべて満たしている。関数の仕様が正確に実装され、テストはすべてのケース（重複排除、パス更新、max 制限、引数の不変性）を検証している。
---
## Instructions

`work/app/src/core/ref-lists.ts` を新しく作る。クイックアクセス（ピン留めしたフォルダ）と、最近使った項目（ADR 0014 判断2・3）の一覧は、
どちらも `EntryRef` の配列で持つ。それを変える関数を書く。**どの関数も、引数の配列を書き換えず、新しい配列を返す。**
`sameRef` は `./tags` から import する（`tags.ts`・`types.ts` は変更しない）。

```ts
import type { EntryRef } from "../api/types";
import { sameRef } from "./tags";

export function pinRefs(list: readonly EntryRef[], refs: readonly EntryRef[]): EntryRef[];
export function unpinRefs(list: readonly EntryRef[], refs: readonly EntryRef[]): EntryRef[];
export function pushRecent(list: readonly EntryRef[], ref: EntryRef, max: number): EntryRef[];
```

- **pinRefs**：`refs` の各 ref を順に、`list` に同じもの（sameRef）が無ければ最後に足す。あれば、その位置のまま ref を引数のものに置き換える（パスを新しくするため）。
  `refs` の中で重なっているもの（sameRef）は、最初の1つだけを扱う
- **unpinRefs**：`refs` のどれかと sameRef が真になる要素を除く
- **pushRecent**：`list` から ref と sameRef が真になる要素を除き、ref を**先頭**に置き、長さが `max` を超えたら後ろを切る（`max` 個まで残す）

## Acceptance Criteria

- `work/app/tests/ref-lists.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/ref-lists"`。結果は `toEqual` で比べる
- 使う ref：`a = { id: "1:a", path: "C:\\a" }`、`b = { id: "1:b", path: "C:\\b" }`、`c = { id: "1:c", path: "C:\\c" }`、`aMoved = { id: "1:a", path: "D:\\a" }`、
  `e1 = { id: "", path: "E:\\X" }`、`e2 = { id: "", path: "e:\\x" }`
- pinRefs：
  - `([], [a, b])` → `[a, b]`
  - `([a, b], [c, a])` → `[a, b, c]`
  - `([a, b], [aMoved])` → `[aMoved, b]`（位置はそのまま、パスが新しくなる）
  - `([], [e1, e2])` → `[e1]`（パスの大文字小文字だけが違うので同じもの）
  - 引数の `list` が変わっていない
- unpinRefs：`([a, b, c], [b])` → `[a, c]`、`([a, b], [aMoved])` → `[b]`、`([a], [c])` → `[a]`
- pushRecent：
  - `([], a, 3)` → `[a]`
  - `([a, b, c], c, 3)` → `[c, a, b]`
  - `([a, b, c], aMoved, 3)` → `[aMoved, b, c]`
  - `([a, b, c], { id: "1:d", path: "C:\\d" }, 3)` → `[{ id: "1:d", path: "C:\\d" }, a, b]`
  - 引数の `list` が変わっていない
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
