---
id: '0011'
title: タグの保存内容を扱う関数（作る・変える・消す・付ける・外す・調べる）
status: todo
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/src/core/tags.ts
- work/app/tests/tags.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/tags.test.ts"
qwen_self_report: success
auto_check: fail
claude_review: n/a
retry_count: 1
branch: task/0011-a1
attempt: 1
implementer_report: work/app/src/core/tags.ts と work/app/tests/tags.test.ts を新規作成しました。すべての関数は引数の
  store を変更せず新しい store を返します。受け入れ条件の各ケースを Vitest テストで検証しています。
last_changed_files:
- work/app/src/core/tags.ts
- work/app/tests/tags.test.ts
last_failure: "\nup to date in 303ms\n\n RUN  v5.0.4 /mnt/c/Users/neo_m/projects-NEO/.teamneo-worktrees/explorer_plus/work/app\n\
  \n ❯ tests/tags.test.ts (20 tests | 1 failed) 9ms\n   ✓ normalizeColor (2)\n   \
  \  ✓ lowercases valid hex 1ms\n     ✓ rejects invalid 1ms\n   ✓ sameRef (2)\n  \
  \   ✓ compares by id when both present 0ms\n     ✓ compares by path (case-insensitive)\
  \ when id empty 0ms\n   ✓ emptyTagStore (1)\n     ✓ returns fresh object each call\
  \ 1ms\n   ❯ createTag (6)\n     ✓ creates a tag and does not mutate input 0ms\n\
  \     ✓ invalid name 0ms\n     ✓ invalid color 0ms\n     × exists by name (case-insensitive)\
  \ 4ms\n     ✓ invalid on duplicate id 0ms\n     ✓ too-large at 200 tags 0ms\n  \
  \ ✓ updateTag (6)\n     ✓ updates color only 0ms\n     ✓ updates name only 0ms\n\
  \     ✓ same name as self is ok 0ms\n     ✓ exists on other tag name 0ms\n     ✓\
  \ not-found 0ms\n     ✓ invalid color 0ms\n   ✓ assignTag / tagsOf / refsWithTag\
  \ / deleteTag (3)\n     ✓ full flow 0ms\n     ✓ not-found for assign and delete\
  \ 0ms\n     ✓ tagsOf on empty store 0ms\n\n Test Files  1 failed (1)\n      Tests\
  \  1 failed | 19 passed (20)\n   Start at  15:29:38\n   Duration  1.25s (transform\
  \ 40%, import 37%, worker 19%, tests 3%)\n\n\n⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n\
  \ FAIL  tests/tags.test.ts > createTag > exists by name (case-insensitive)\nAssertionError:\
  \ expected true to be false // Object.is equality\n\n- Expected\n+ Received\n\n\
  - false\n+ true\n\n ❯ tests/tags.test.ts:88:61\n     86|     const s = twoTagStore();\n\
  \     87|     expect(createTag(s, \"重要\", \"#000000\", \"tag-9\").ok).toBe(false);\n\
  \     88|     expect(createTag(s, \" report \", \"#000000\", \"tag-9\").ok).toBe(false…\n\
  \       |                                                             ^\n     89|\
  \   });\n     90|   it(\"invalid on duplicate id\", () => {\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯\n\
  \n"
---
## Instructions

`work/app/src/core/tags.ts` を新しく作る。タグ（ADR 0010）はアプリ全体で1つの保存内容（TagStore）に入っている。ここでは、その保存内容を
変える関数を書く。**どの関数も、引数の store を書き換えず、新しい store を返す**（配列やオブジェクトをコピーしてから変える）。
型と定数は `work/app/src/api/types.ts` から import する（`types.ts` は変更しない）。

```ts
import { TAG_NAME_MAX, TAGS_MAX, type ApiError, type EntryRef, type Tag } from "../api/types";

export type TagLink = { ref: EntryRef; tagIds: string[] };
export type TagStore = { tags: Tag[]; links: TagLink[] };
export type StoreResult = { ok: true; store: TagStore } | { ok: false; error: ApiError };
export type TagResult = { ok: true; store: TagStore; tag: Tag } | { ok: false; error: ApiError };

export function emptyTagStore(): TagStore;
export function normalizeColor(color: unknown): string | null;
export function sameRef(a: EntryRef, b: EntryRef): boolean;
export function createTag(store: TagStore, name: string, color: string, id: string): TagResult;
export function updateTag(store: TagStore, id: string, patch: { name?: string; color?: string }): TagResult;
export function deleteTag(store: TagStore, id: string): StoreResult;
export function assignTag(store: TagStore, refs: readonly EntryRef[], tagId: string, on: boolean): StoreResult;
export function tagsOf(store: TagStore, ref: EntryRef): string[];
export function refsWithTag(store: TagStore, tagId: string): EntryRef[];
```

失敗のときの `error.message` は自由（英語）。`error.code` は下に書いたもの。

- **emptyTagStore**：`{ tags: [], links: [] }`（呼ぶたびに新しいオブジェクト）
- **normalizeColor**：文字列で `/^#[0-9a-fA-F]{6}$/` に一致すれば、小文字にして返す。それ以外は `null`
- **sameRef**：`a.id` と `b.id` が**両方とも空でない**なら、`a.id === b.id`。それ以外（どちらかが空）は、`a.path.toLowerCase() === b.path.toLowerCase()`
- **createTag**：上から順に調べる
  1. `name.trim()` が空、または `name.trim().length > TAG_NAME_MAX` → `invalid`
  2. `normalizeColor(color)` が `null` → `invalid`
  3. `store.tags` に同じ `id` がある → `invalid`
  4. `store.tags` に、`name.trim()` と大文字小文字を区別せずに同じ名前（`toLowerCase()` で比べる）がある → `exists`
  5. `store.tags.length >= TAGS_MAX` → `too-large`
  6. 成功：`tag = { id, name: name.trim(), color: normalizeColor(color) }` を `tags` の最後に足した store と、その tag を返す
- **updateTag**：
  1. `store.tags` に `id` のタグが無い → `not-found`
  2. `patch.name` があれば、createTag の 1 と同じ検査（`invalid`）と、**自分以外の**タグとの重なりの検査（`exists`）
  3. `patch.color` があれば、`normalizeColor` が `null` → `invalid`
  4. 成功：そのタグの name（trim したもの）・color（小文字にしたもの）を、patch にあるものだけ変えた store と、変えた後の tag を返す。タグの順番は変えない
- **deleteTag**：`id` のタグが無い → `not-found`。成功：そのタグを `tags` から除き、すべての link の `tagIds` からその id を除き、`tagIds` が空になった link を `links` から除いた store
- **assignTag**：`tagId` のタグが無い → `not-found`。成功：`refs` の各 ref について順に
  - `links` の中で `sameRef(link.ref, ref)` が真になる link を探す
  - `on` が真：link があれば、`tagIds` に `tagId` が無ければ最後に足し、`link.ref` を引数の `ref` で置き換える（パスを新しくするため）。link が無ければ `{ ref, tagIds: [tagId] }` を `links` の最後に足す
  - `on` が偽：link があれば `tagIds` から `tagId` を除き、空になったら link を除く。link が無ければ何もしない
- **tagsOf**：`sameRef(link.ref, ref)` が真になる最初の link の `tagIds` を、**`store.tags` の並び順に**並べ直して返す（`store.tags` に無い id は含めない）。link が無ければ `[]`
- **refsWithTag**：`tagIds` に `tagId` を含む link の `ref` を、`links` の順に返す

## Acceptance Criteria

- `work/app/tests/tags.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/tags"`（拡張子なし）。
  失敗は `error.code` だけ比べる
- normalizeColor：`"#FF8800"` → `"#ff8800"`、`"#abcdef"` → `"#abcdef"`、`"FF8800"` → null、`"#ff880"` → null、`"#gg0000"` → null、`123` → null
- sameRef：`({ id: "a", path: "C:\\x" }, { id: "a", path: "D:\\y" })` → true、`({ id: "a", path: "C:\\x" }, { id: "b", path: "C:\\x" })` → false、
  `({ id: "", path: "E:\\X.txt" }, { id: "", path: "e:\\x.txt" })` → true、`({ id: "a", path: "C:\\x" }, { id: "", path: "c:\\X" })` → true
- createTag：
  - `(emptyTagStore(), "  重要  ", "#FF0000", "tag-1")` → ok で、`tag` が `{ id: "tag-1", name: "重要", color: "#ff0000" }`、`store.tags` がその1つだけ
  - 引数の store が変わっていない（呼ぶ前と `toEqual` で同じ）
  - 名前 `""`・`"   "`・`"x".repeat(41)` → `invalid`。色 `"red"` → `invalid`
  - 「重要」がある store に `"重要"` → `exists`。`"Report"` がある store に `" report "` → `exists`
  - 同じ id `"tag-1"` で2つ目 → `invalid`
  - タグが 200 個ある store（id `"t0"`〜`"t199"`、名前 `"n0"`〜`"n199"`）に新しい名前 → `too-large`
- updateTag：「重要」(tag-1, #ff0000) と「レポート」(tag-2, #00ff00) がある store で
  - `("tag-1", { color: "#0000FF" })` → `tag` が `{ id: "tag-1", name: "重要", color: "#0000ff" }`、`store.tags` の順は tag-1, tag-2 のまま
  - `("tag-1", { name: "最重要" })` → name が `"最重要"`、color は `"#ff0000"` のまま
  - `("tag-1", { name: "重要" })` → ok（自分自身と同じ名前は重なりではない）
  - `("tag-1", { name: "レポート" })` → `exists`、`("tag-9", { name: "x" })` → `not-found`、`("tag-1", { color: "blue" })` → `invalid`
- assignTag・tagsOf・refsWithTag・deleteTag：上の store で、`a = { id: "1:a", path: "C:\\a.txt" }`、`b = { id: "1:b", path: "C:\\b.txt" }` として
  - `assignTag(store, [a, b], "tag-2", true)` の後に `assignTag(…, [a], "tag-1", true)` → `tagsOf(…, a)` が `["tag-1", "tag-2"]`（store.tags の順）、`tagsOf(…, b)` が `["tag-2"]`
  - その後 `refsWithTag(…, "tag-2")` → `[a, b]`、`refsWithTag(…, "tag-1")` → `[a]`
  - その後 `assignTag(…, [{ id: "1:a", path: "C:\\moved\\a.txt" }], "tag-1", true)` → `refsWithTag(…, "tag-1")` が `[{ id: "1:a", path: "C:\\moved\\a.txt" }]`（パスが新しくなる）、`links` の数は 2 のまま
  - その後 `assignTag(…, [b], "tag-2", false)` → `tagsOf(…, b)` が `[]`、`links` の数が 1
  - その後 `deleteTag(…, "tag-2")` → `store.tags` が tag-1 だけ、`tagsOf(…, a)` が `["tag-1"]`
  - その後 `deleteTag(…, "tag-1")` → `links` が `[]`
  - `assignTag(store, [a], "tag-9", true)` → `not-found`、`deleteTag(store, "tag-9")` → `not-found`
  - `tagsOf(emptyTagStore(), a)` → `[]`
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
