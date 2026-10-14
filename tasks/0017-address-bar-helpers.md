---
id: '0017'
title: アドレスバー用：パスを区切りに分ける splitPath と、コマンドの行を読む parseCommandLine
status: blocked
depends_on: []
gpu_need: none
tool: code
context_files: []
human_review: false
expected_outputs:
- work/app/src/core/paths.ts
- work/app/tests/paths.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/paths.test.ts"
qwen_self_report: success
auto_check: fail
claude_review: n/a
retry_count: 2
branch: task/0017-a2
attempt: 2
implementer_report: 失敗の原因は実装の誤りです。テストの期待値は受け入れ条件と一致しており正しいです。splitPath のループ内で acc
  を更新する際、セグメントの前にバックスラッシュを付け忘れており、結果として "C:\Usersneo_m" のように区切り文字が欠落していました。acc = acc
  + "\\" + part; に修正しました。
last_changed_files:
- work/app/src/core/paths.ts
- work/app/tests/paths.test.ts
last_failure: "\nup to date in 272ms\n\n RUN  v5.0.4 /mnt/c/Users/neo_m/projects-NEO/.teamneo-worktrees/explorer_plus/work/app\n\
  \n ❯ tests/paths.test.ts (14 tests | 3 failed) 11ms\n   ❯ splitPath (6)\n     ×\
  \ splits a normal drive path 6ms\n     ✓ handles a bare drive root 0ms\n     ✓ uppercases\
  \ the drive letter and adds a backslash 0ms\n     × ignores trailing and consecutive\
  \ backslashes 1ms\n     × handles non-ASCII segments 1ms\n     ✓ returns empty for\
  \ non-drive inputs 0ms\n   ✓ parseCommandLine (8)\n     ✓ parses a bare command\
  \ 0ms\n     ✓ trims surrounding whitespace 0ms\n     ✓ keeps multiple args intact\
  \ 0ms\n     ✓ parses a quoted file path with spaces 0ms\n     ✓ splits on a tab\
  \ as well as a space 0ms\n     ✓ returns null for empty or whitespace-only input\
  \ 0ms\n     ✓ returns null for an unclosed quote 0ms\n     ✓ returns null for an\
  \ empty quoted file 0ms\n\n Test Files  1 failed (1)\n      Tests  3 failed | 11\
  \ passed (14)\n   Start at  18:45:37\n   Duration  1.07s (import 50%, transform\
  \ 25%, worker 20%, tests 5%)\n\n\n⎯⎯⎯⎯⎯⎯⎯ Failed Tests 3 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  tests/paths.test.ts\
  \ > splitPath > splits a normal drive path\nAssertionError: expected [ { label:\
  \ 'C:', path: 'C:\\' }, …(3) ] to deeply equal [ { label: 'C:', path: 'C:\\' },\
  \ …(3) ]\n\n- Expected\n+ Received\n\n@@ -3,16 +3,16 @@\n      \"label\": \"C:\"\
  ,\n      \"path\": \"C:\\\\\",\n    },\n    {\n      \"label\": \"Users\",\n-  \
  \   \"path\": \"C:\\\\Users\",\n+     \"path\": \"C:\\\\\\\\Users\",\n    },\n \
  \   {\n      \"label\": \"neo_m\",\n-     \"path\": \"C:\\\\Users\\\\neo_m\",\n\
  +     \"path\": \"C:\\\\\\\\Users\\\\neo_m\",\n    },\n    {\n      \"label\": \"\
  Documents\",\n-     \"path\": \"C:\\\\Users\\\\neo_m\\\\Documents\",\n+     \"path\"\
  : \"C:\\\\\\\\Users\\\\neo_m\\\\Documents\",\n    },\n  ]\n\n ❯ tests/paths.test.ts:6:54\n\
  \      4| describe(\"splitPath\", () => {\n      5|   it(\"splits a normal drive\
  \ path\", () => {\n      6|     expect(splitPath(\"C:\\\\Users\\\\neo_m\\\\Documents\"\
  )).toEqual([\n       |                                                      ^\n\
  \      7|       { label: \"C:\", path: \"C:\\\\\" },\n      8|       { label: \"\
  Users\", path: \"C:\\\\Users\" },\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯\n\n FAIL  tests/paths.test.ts\
  \ > splitPath > ignores trailing and consecutive backslashes\nAssertionError: expected\
  \ [ { label: 'C:', path: 'C:\\' }, …(2) ] to deeply equal [ { label: 'C:', path:\
  \ 'C:\\' }, …(2) ]\n\n- Expected\n+ Received\n\n@@ -3,12 +3,12 @@\n      \"label\"\
  : \"C:\",\n      \"path\": \"C:\\\\\",\n    },\n    {\n      \"label\": \"a\",\n\
  -     \"path\": \"C:\\\\a\",\n+     \"path\": \"C:\\\\\\\\a\",\n    },\n    {\n\
  \      \"label\": \"b\",\n-     \"path\": \"C:\\\\a\\\\b\",\n+     \"path\": \"\
  C:\\\\\\\\a\\\\b\",\n    },\n  ]\n\n ❯ tests/paths.test.ts:23:39\n     21|\n   \
  \  22|   it(\"ignores trailing and consecutive backslashes\", () => {\n     23|\
  \     expect(splitPath(\"C:\\\\a\\\\\\\\b\\\\\")).toEqual([\n       |          \
  \                             ^\n     24|       { label: \"C:\", path: \"C:\\\\\"\
  \ },\n     25|       { label: \"a\", path: \"C:\\\\a\" },\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯\n\
  \n FAIL  tests/paths.test.ts > splitPath > handles non-ASCII segments\nAssertionError:\
  \ expected [ { label: 'C:', path: 'C:\\' }, …(2) ] to deeply equal [ { label: 'C:',\
  \ path: 'C:\\' }, …(2) ]\n\n- Expected\n+ Received\n\n@@ -3,12 +3,12 @@\n      \"\
  label\": \"C:\",\n      \"path\": \"C:\\\\\",\n    },\n    {\n      \"label\": \"\
  学業\",\n-     \"path\": \"C:\\\\学業\",\n+     \"path\": \"C:\\\\\\\\学業\",\n    },\n\
  \    {\n      \"label\": \"A校\",\n-     \"path\": \"C:\\\\学業\\\\A校\",\n+     \"\
  path\": \"C:\\\\\\\\学業\\\\A校\",\n    },\n  ]\n\n ❯ tests/paths.test.ts:31:37\n \
  \    29|\n     30|   it(\"handles non-ASCII segments\", () => {\n     31|     expect(splitPath(\"\
  C:\\\\学業\\\\A校\")).toEqual([\n       |                                     ^\n \
  \    32|       { label: \"C:\", path: \"C:\\\\\" },\n     33|       { label: \"\
  学業\", path: \"C:\\\\学業\" },\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯\n\n"
blocked_reason: "機械的検証に2回失敗しました。最後の失敗:  …(2) ]\n\n- Expected\n+ Received\n\n@@ -3,12\
  \ +3,12 @@\n      \"label\": \"C:\",\n      \"path\": \"C:\\\\\",\n    },\n    {\n\
  \      \"label\": \"学業\",\n-     \"path\": \"C:\\\\学業\",\n+     \"path\": \"C:\\\
  \\\\\\学業\",\n    },\n    {\n      \"label\": \"A校\",\n-     \"path\": \"C:\\\\学業\\\
  \\A校\",\n+     \"path\": \"C:\\\\\\\\学業\\\\A校\",\n    },\n  ]\n\n ❯ tests/paths.test.ts:31:37\n\
  \     29|\n     30|   it(\"handles non-ASCII segments\", () => {\n     31|     expect(splitPath(\"\
  C:\\\\学業\\\\A校\")).toEqual([\n       |                                     ^\n \
  \    32|       { label: \"C:\", path: \"C:\\\\\" },\n     33|       { label: \"\
  学業\", path: \"C:\\\\学業\" },\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯\n\n\n\nClaude の見直し（数行の修正（朝に\
  \ Claude が直接直す））: splitPath の acc の初期値が既にバックスラッシュ付き（C:\\）なのに、ループ内でさらに \\ + part\
  \ を足しているため、区切りが二重になりテスト3件が失敗している。テストの期待値は受け入れ条件と一致していて正しい。acc の初期値をバックスラッシュ無しのドライブ名（C:）にすれば、C:\
  \ + \\ + Users = C:\\Users となり、期待値と一致する。parseCommandLine のテスト8件は成功済みで、変更は不要。\n修正案:\
  \ tasks/fixes/0017.md"
triage_count: 1
triage:
  category: direct_fix
  reason: 'splitPath の acc の初期値が既にバックスラッシュ付き（C:\）なのに、ループ内でさらに \ + part を足しているため、区切りが二重になりテスト3件が失敗している。テストの期待値は受け入れ条件と一致していて正しい。acc
    の初期値をバックスラッシュ無しのドライブ名（C:）にすれば、C: + \ + Users = C:\Users となり、期待値と一致する。parseCommandLine
    のテスト8件は成功済みで、変更は不要。'
  at: '2026-10-14T18:46:01'
  by: claude_cli:sonnet
proposed_fix: tasks/fixes/0017.md
---
## Instructions

`work/app/src/core/paths.ts` を新しく作る。Windows 11 のエクスプローラと同じアドレスバー（ADR 0014 判断5）に使う。

```ts
export type Crumb = { label: string; path: string };
export function splitPath(path: string): Crumb[];
export function parseCommandLine(text: string): { file: string; args: string } | null;
```

### splitPath（パスを、押せる区切りに分ける）

- ドライブで始まるパス（`/^[A-Za-z]:/`）だけを扱う。それ以外（空文字、`\\server\share` など）は `[]`
- 最初の区切りは、ドライブ：`label` は大文字のドライブ名＋`:`（例 `"C:"`）、`path` はそれに `\` を付けたもの（例 `"C:\\"`）
- 残りは、`\` で区切った空でない部分を順に1つずつ。`label` はその部分、`path` は先頭からその部分までを `\` でつないだもの
- 末尾の `\` や、連続した `\`（`C:\\a\\\\b`）は無視する（空の部分を作らない）

### parseCommandLine（アドレスバーに入れたコマンドを、実行するファイルと引数に分ける）

- `text` の前後の空白を取り除いて、空なら `null`
- 先頭が `"` なら、次の `"` までが `file`（`"` は含めない）。閉じる `"` が無ければ `null`。`file` が空でも `null`
- 先頭が `"` でなければ、最初の空白（スペースかタブ）までが `file`
- `args` は、`file` の後ろの残りから前後の空白を取り除いたもの（無ければ `""`）

## Acceptance Criteria

- `work/app/tests/paths.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/paths"`。結果は `toEqual` で比べる
- splitPath：
  - `"C:\\Users\\neo_m\\Documents"` → `[{ label: "C:", path: "C:\\" }, { label: "Users", path: "C:\\Users" }, { label: "neo_m", path: "C:\\Users\\neo_m" }, { label: "Documents", path: "C:\\Users\\neo_m\\Documents" }]`
  - `"C:\\"` → `[{ label: "C:", path: "C:\\" }]`、`"d:"` → `[{ label: "D:", path: "D:\\" }]`
  - `"C:\\a\\\\b\\"` → `[{ label: "C:", path: "C:\\" }, { label: "a", path: "C:\\a" }, { label: "b", path: "C:\\a\\b" }]`
  - `"C:\\学業\\A校"` → `[{ label: "C:", path: "C:\\" }, { label: "学業", path: "C:\\学業" }, { label: "A校", path: "C:\\学業\\A校" }]`
  - `""` → `[]`、`"\\\\server\\share"` → `[]`、`"relative\\x"` → `[]`
- parseCommandLine：
  - `"cmd"` → `{ file: "cmd", args: "" }`
  - `"  code .  "` → `{ file: "code", args: "." }`
  - `"powershell -NoExit -Command dir"` → `{ file: "powershell", args: "-NoExit -Command dir" }`
  - `"\"C:\\Program Files\\Tool\\tool.exe\" --open a.txt"` → `{ file: "C:\\Program Files\\Tool\\tool.exe", args: "--open a.txt" }`
  - `"notepad\tmemo.txt"` → `{ file: "notepad", args: "memo.txt" }`
  - `""`・`"   "` → `null`、`"\"unclosed"` → `null`、`"\"\" x"` → `null`
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
