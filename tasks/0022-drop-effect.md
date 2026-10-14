---
id: "0022"
title: ドラッグで落としたときに移動かコピーかを決める dropEffect と、並べ替えの moveItem
status: todo
depends_on: []
gpu_need: none
tool: code
context_files: []
human_review: false
expected_outputs:
  - work/app/src/core/drop.ts
  - work/app/tests/drop.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/drop.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/drop.ts` を新しく作る。ドラッグ＆ドロップ（ADR 0015 判断2・3）で使う。

```ts
export function isSameOrInside(path: string, folder: string): boolean;
export function dropEffect(sources: readonly string[], dest: string, keys: { ctrl: boolean; shift: boolean }): "move" | "copy" | null;
export function moveItem<T>(list: readonly T[], from: number, to: number): T[];
```

パスは Windows のパス（`C:\a\b` の形）。大文字と小文字は区別しない（`toLowerCase()` で比べる）。

### isSameOrInside（path が folder そのもの、または folder の中か）

- 両方の末尾の `\` を取り除いてから比べる（ただし `C:\` のようなドライブの直下は、`C:` にしてから比べる）
- `path` と `folder` が同じなら `true`
- `path` が `folder + "\"` で始まるなら `true`（`C:\ab` は `C:\a` の中ではない）
- それ以外は `false`

### dropEffect（Win11 と同じ決まり）

1. `sources` が空 → `null`
2. `sources` のどれかについて、`isSameOrInside(dest, source)` が `true`（自分自身や、自分の中のフォルダへ落とそうとしている）→ `null`
3. `sources` のどれかについて、`source` の親のフォルダ（最後の `\` より前。ドライブの直下なら `C:\` の形）が `dest` と同じ（すでにそこにある）で、かつ `keys.ctrl` が偽 → `null`
4. `keys.ctrl` が真 → `"copy"`
5. `keys.shift` が真 → `"move"`
6. `sources[0]` のドライブ（先頭の1文字を大文字にしたもの）と `dest` のドライブが同じ → `"move"`、違う → `"copy"`

### moveItem（タブの並べ替え）

- `list` を書き換えず、`from` 番目の要素を取り出して、`to` 番目に入れた新しい配列を返す（`to` は取り出した後の配列での位置）
- `from` か `to` が 0 未満、または `list.length` 以上なら、`list` のコピーをそのまま返す

## Acceptance Criteria

- `work/app/tests/drop.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/drop"`
- isSameOrInside：
  - `("C:\\a", "C:\\a")` → true、`("C:\\a\\b", "C:\\a")` → true、`("c:\\A\\B", "C:\\a")` → true、`("C:\\a\\", "C:\\a")` → true
  - `("C:\\ab", "C:\\a")` → false、`("C:\\a", "C:\\a\\b")` → false、`("D:\\a", "C:\\a")` → false、`("C:\\x", "C:\\")` → true
- dropEffect（`k = { ctrl: false, shift: false }`、`ctrl = { ctrl: true, shift: false }`、`shift = { ctrl: false, shift: true }`）：
  - `(["C:\\a\\f.txt"], "C:\\b", k)` → `"move"`
  - `(["C:\\a\\f.txt"], "D:\\b", k)` → `"copy"`
  - `(["C:\\a\\f.txt"], "C:\\b", ctrl)` → `"copy"`
  - `(["C:\\a\\f.txt"], "D:\\b", shift)` → `"move"`
  - `(["C:\\a\\f.txt"], "C:\\a", k)` → `null`（すでにそこにある）
  - `(["C:\\a\\f.txt"], "C:\\a", ctrl)` → `"copy"`（同じ場所への複製は Ctrl なら許す）
  - `(["C:\\a"], "C:\\a\\sub", k)` → `null`（自分の中へ）
  - `(["C:\\a"], "C:\\a", ctrl)` → `null`（自分自身へ）
  - `([], "C:\\b", k)` → `null`
  - `(["C:\\x.txt"], "C:\\", k)` → `null`（`C:\x.txt` の親は `C:\`）
- moveItem：
  - `(["a", "b", "c", "d"], 0, 2)` → `["b", "c", "a", "d"]`
  - `(["a", "b", "c", "d"], 3, 0)` → `["d", "a", "b", "c"]`
  - `(["a", "b", "c"], 1, 1)` → `["a", "b", "c"]`
  - `(["a", "b"], 5, 0)` → `["a", "b"]`、`(["a", "b"], 0, -1)` → `["a", "b"]`
  - 引数の配列が変わっていない
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
