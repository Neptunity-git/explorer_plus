---
id: '0002'
title: 拡張子・アイコンの種類・並び順の関数（extOf / iconKindFor / sortEntries）
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/src/core/entries.ts
- work/app/tests/entries.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx vitest run tests/entries.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 1
branch: task/0002-a2
attempt: 2
implementer_report: 失敗の原因は実装の誤りでした。テストの期待値 `extOf(".gitignore") === "gitignore"` は受け入れ条件（`.gitignore`
  → `gitignore`）と一致しており正しいです。実装の `extOf` が `dot <= 0` で判定していたため、`.` が先頭（index 0）にある
  `.gitignore` を「拡張子なし」と誤判定していました。Windows エクスプローラに合わせ `.gitignore` のような先頭ドット名も拡張子とみなす必要があるため、条件を
  `dot < 0` に修正しました（`dot === name.length - 1` の `file.` 判定は維持）。テストは受け入れ条件どおりなので変更していません。
last_changed_files:
- work/app/src/core/entries.ts
- work/app/tests/entries.test.ts
review_reason: 受け入れ条件をすべて満たしている。extOf・iconKindFor・sortEntries の実装が指定通り。テストが各条件を正確に検証（テスト値を弱めていない）。指示の範囲外の変更がない。自動検証（テスト）合格。
---
## Instructions

`work/app/src/core/entries.ts` を新しく作り、ファイルの一覧に使う3つの関数を書く。型は `work/app/src/api/types.ts` から
import する（`types.ts` は変更しない）。

```ts
import type { Entry, IconKind } from "../api/types";

export function extOf(name: string): string;
export function iconKindFor(kind: "file" | "folder", ext: string): IconKind;
export function sortEntries(entries: readonly Entry[]): Entry[];
```

### extOf（ファイル名から拡張子）

- 名前の**最後の** `.` より後ろを、小文字にして返す。`.` が無い、または `.` が最後の文字なら `""`
- Windows のエクスプローラに合わせ、`.` で始まる名前（`.gitignore`）も、最初の `.` より後ろを拡張子とみなす

### iconKindFor（独自アイコンの種類。ADR 0003）

- `kind` が `"folder"` なら、`ext` に関係なく `"system"`
- `ext` が `exe`・`bat`・`cmd`・`lnk`・`msi` のどれかなら `"launch"`
- `ext` が `json`・`yaml`・`yml`・`toml`・`ini`・`cfg`・`conf`・`xml` のどれかなら `"config"`
- それ以外は `"system"`
- `ext` は小文字で渡される前提（大文字の `"EXE"` は `"system"` になってよい。大文字・小文字の変換はしない）

### sortEntries（Windows のエクスプローラと同じ並び順）

- 引数の配列は変更せず、並べ替えた**新しい配列**を返す
- フォルダ（`kind: "folder"`）が先、ファイルが後
- 同じ種類の中では、`new Intl.Collator("en", { numeric: true, sensitivity: "base" })` の `compare(a.name, b.name)` で並べる
  （大文字・小文字を区別せず、数字は数として比べるので `file2` が `file10` より前）
- `compare` が 0 のとき（`"a.txt"` と `"A.txt"` など）は、`a.name < b.name` なら前、`>` なら後、同じなら元の順を保つ

## Acceptance Criteria

- `work/app/tests/entries.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で次を確かめる。
  import は `from "../src/core/entries"`（拡張子なし）。テスト用の Entry は、`id`・`path`・`hidden`・`ext` も埋めた
  完全な形で作る（例：`{ id: "0:1", name: "a.txt", path: "C:\\a.txt", kind: "file", ext: "txt", hidden: false }`）
- extOf：
  - `"report.DOCX"` → `"docx"`、`"archive.tar.gz"` → `"gz"`、`"README"` → `""`、`"file."` → `""`、`".gitignore"` → `"gitignore"`、`""` → `""`
- iconKindFor：
  - `("file", "exe")` → `"launch"`、`("file", "lnk")` → `"launch"`、`("file", "yaml")` → `"config"`、`("file", "json")` → `"config"`
  - `("file", "docx")` → `"system"`、`("file", "")` → `"system"`、`("folder", "exe")` → `"system"`
- sortEntries：
  - 名前が `file10.txt`(file)・`b`(folder)・`file2.txt`(file)・`File1.txt`(file)・`A`(folder) の順の配列 →
    名前の並びが `["A", "b", "File1.txt", "file2.txt", "file10.txt"]`
  - 名前が `a.txt`(file)・`A.txt`(file) の順 → `["A.txt", "a.txt"]`（`"A" < "a"` なので A が前）
  - 元の配列の順番が変わっていない（並べ替える前と同じ）
  - 空の配列 → 空の配列
- `test_command` が成功する
