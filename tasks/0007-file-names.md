---
id: '0007'
title: ファイル名の検査と、重ならない名前づくり（validateFileName / uniqueName）
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/src/core/names.ts
- work/app/tests/names.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/names.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0007-a1
attempt: 1
implementer_report: work/app/src/core/names.ts と work/app/tests/names.test.ts を新規作成しました。validateFileName
  は指示の6つのチェックを上から順に行い、uniqueName は大文字小文字を区別せずに既存名と衝突しない名前を返します。受け入れ条件のテストケースをすべて含めています。
last_changed_files:
- work/app/src/core/names.ts
- work/app/tests/names.test.ts
review_reason: 受け入れ条件をすべて満たしています。指示の6つのチェック項目が順序通り実装され、指定されたテストケースがすべて含まれ、テストが全て合格しています。型定義も正しく、指示の範囲外の変更はありません。
---
## Instructions

`work/app/src/core/names.ts` を新しく作り、2つの関数を書く。名前の変更（F2）と新しいフォルダの作成（Ctrl+Shift+N）で使う。
型は `work/app/src/api/types.ts` から import する（`types.ts` は変更しない）。

```ts
import type { ApiError } from "../api/types";

export function validateFileName(name: string): ApiError | null;
export function uniqueName(base: string, existing: readonly string[]): string;
```

### validateFileName（Windows で使える名前か）

上から順に調べ、最初に当てはまったら `{ code: "invalid", message }` を返す（`message` は自由な英語）。どれにも当てはまらなければ `null`。

1. `name.trim()` が空（空文字・空白だけ）
2. `name.length` が 255 より大きい
3. `\` `/` `:` `*` `?` `"` `<` `>` `|` のどれかを含む
4. 文字コードが 0〜31 の文字（制御文字。`name.charCodeAt(i) < 32`）を含む
5. 最後の文字が空白 `" "` か `.`
6. 予約された名前：`name` の最初の `.` より前の部分（`.` が無ければ全体）から末尾の空白を取り除き、大文字にしたものが、
   `CON`・`PRN`・`AUX`・`NUL`・`COM1`〜`COM9`・`LPT1`〜`LPT9` のどれかと一致する

### uniqueName（フォルダの中で重ならない名前）

- `existing`（今のフォルダにある名前の一覧）に、`base` と大文字小文字を区別せずに（`toLowerCase()` で比べて）一致するものが無ければ、`base` を返す
- あれば、`n = 2, 3, 4, …` の順に `` `${base} (${n})` `` を作り、`existing` のどれとも（大文字小文字を区別せずに）一致しない最初のものを返す

## Acceptance Criteria

- `work/app/tests/names.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で次を確かめる。
  import は `from "../src/core/names"`（拡張子なし）。エラーは `code` だけ比べる
- validateFileName：
  - `null` になる：`"report.docx"`、`"新しいフォルダー"`、`"a"`、`".gitignore"`、`"CONSOLE"`、`"con2"`、`"COM0"`、`"my con.txt"`、`"a".repeat(255)`
  - `"invalid"` になる：`""`、`"   "`、`"a".repeat(256)`、`"a/b"`、`"a\\b"`、`"a:b"`、`"a*b"`、`"a?b"`、`"a\"b"`、`"a<b"`、`"a>b"`、`"a|b"`、
    `"a\tb"`（タブは制御文字）、`"a\u0000b"`、`"name "`、`"name."`、`"CON"`、`"con"`、`"Con.txt"`、`"nul.tar.gz"`、`"COM1"`、`"lpt9.log"`、`"AUX .txt"`
- uniqueName：
  - `("新しいフォルダー", [])` → `"新しいフォルダー"`
  - `("新しいフォルダー", ["a.txt", "b"])` → `"新しいフォルダー"`
  - `("新しいフォルダー", ["新しいフォルダー"])` → `"新しいフォルダー (2)"`
  - `("新しいフォルダー", ["新しいフォルダー", "新しいフォルダー (2)", "新しいフォルダー (4)"])` → `"新しいフォルダー (3)"`
  - `("Folder", ["folder"])` → `"Folder (2)"`（大文字小文字を区別しない）
  - `("Folder", ["FOLDER", "folder (2)"])` → `"Folder (3)"`
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
