---
id: "0017"
title: アドレスバー用：パスを区切りに分ける splitPath と、コマンドの行を読む parseCommandLine
status: todo
depends_on: []
gpu_need: none
tool: code
context_files: []
human_review: false
expected_outputs:
  - work/app/src/core/paths.ts
  - work/app/tests/paths.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/paths.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
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
