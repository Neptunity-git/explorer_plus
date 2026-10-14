---
id: 0008
title: parseModMessage に rename・createFolder・showMenu を足し、ref の id に空文字を許す
status: blocked
depends_on:
- '0003'
gpu_need: none
tool: code
context_files:
- work/app/src/core/protocol.ts
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/tests/protocol-additions.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/protocol.test.ts tests/protocol-additions.test.ts"
qwen_self_report: failure
auto_check: fail
claude_review: n/a
retry_count: 2
branch: task/0008-a2
attempt: 2
implementer_report: 'work/app/src/core/protocol.ts への edits を適用しても、ファイルが1文字も変わりません（replace
  が search と同じ）。足す・直す内容を replace に書くこと。何も書き込んでいません（書き直させても直りませんでした。1回目の問題: edits の
  1 番目（work/app/src/core/protocol.ts）：search に一致する箇所がありません（インデント・改行を含め、ファイルの文字列と一字一句同じにすること）。search
  の先頭: ''function parseRef(value: unknown): { ok: true; ref: { id: string; path: string
  }''）'
last_changed_files:
- work/app/tests/protocol-additions.test.ts
- work/app/src/core/protocol.ts
last_failure: '実装担当の失敗: work/app/src/core/protocol.ts への edits を適用しても、ファイルが1文字も変わりません（replace
  が search と同じ）。足す・直す内容を replace に書くこと。何も書き込んでいません（書き直させても直りませんでした。1回目の問題: edits の
  1 番目（work/app/src/core/protocol.ts）：search に一致する箇所がありません（インデント・改行を含め、ファイルの文字列と一字一句同じにすること）。search
  の先頭: ''function parseRef(value: unknown): { ok: true; ref: { id: string; path: string
  }''）'
blocked_reason: '機械的検証に2回失敗しました。最後の失敗: 実装担当の失敗: work/app/src/core/protocol.ts への edits
  を適用しても、ファイルが1文字も変わりません（replace が search と同じ）。足す・直す内容を replace に書くこと。何も書き込んでいません（書き直させても直りませんでした。1回目の問題:
  edits の 1 番目（work/app/src/core/protocol.ts）：search に一致する箇所がありません（インデント・改行を含め、ファイルの文字列と一字一句同じにすること）。search
  の先頭: ''function parseRef(value: unknown): { ok: true; ref: { id: string; path: string
  }''）'
---
## Instructions

`work/app/src/core/protocol.ts` を、edits で直す（全文を書き直さない）。`types.ts` は変更しない（新しい method・定数は既に足してある）。
MOD の API に、名前の変更・新しいフォルダ・右クリックのメニューの3つの呼び出しが加わった（`docs/design/mod-api-v1.md`、ADR 0009）。

### 直すこと

1. **`parseRef` 関数**：`id` は「空でない文字列」ではなく「文字列（空文字 `""` でもよい）」なら受け付ける。`path` は今までどおり空でない文字列。
   （ファイルID の無い USB メモリなどのファイルは `id` が `""` になるため）
2. **`parseCallParams` 関数の `switch`**：`default` の前に、次の3つの `case` を足す。`types.ts` の `MENU_MAX_ITEMS`・`MENU_MAX_EXTRA`・
   `MENU_LABEL_MAX` を import して使う

| method | params の決まり | 調べた後の params |
|---|---|---|
| `rename` | `id` は文字列（空文字でもよい）、`path` は空でない文字列、`newName` は文字列で `newName.length` が 1 以上 255 以下 | `{ id, path, newName }` |
| `createFolder` | 中身は見ない | `{}` |
| `showMenu` | `x`・`y` は有限の数（`Number.isFinite`）。`items` は ref の配列で 0 件以上 `MENU_MAX_ITEMS` 件以下（0 件は「何も選んでいない所で右クリック」）。`extra` は省略可能。あれば配列で 0 件以上 `MENU_MAX_EXTRA` 件以下、各要素は普通のオブジェクトで、`id` は `id.length` が 1〜64 の文字列、`label` は `label.length` が 1〜`MENU_LABEL_MAX` の文字列 | `{ x, y, items }`。`extra` が渡されたときだけ `extra: [{ id, label }, …]`（各要素も `id`・`label` だけ） |

- `items` の ref は、今ある `parseRef`（直した後のもの）で調べる。0 件を許すため、`parseRefArray(items, 0, MENU_MAX_ITEMS)` の形で呼んでよい
- どれかの決まりを守っていなければ、他の method と同じく失敗（`{ ok: false }`）にする

## Acceptance Criteria

- 新しいテストのファイル `work/app/tests/protocol-additions.test.ts` を作る（既存の `tests/protocol.test.ts` は変えない）。
  Vitest で、import は `from "../src/core/protocol"`（拡張子なし）。成功は `toEqual` で丸ごと比べ、失敗は `ok`・`id`・`error.code` を比べる。
  以下はすべて `{ ep: 1, kind: "call", id: 5, method: …, params: … }` の形で渡す
- 成功：
  - `rename`, `{ id: "a:b", path: "C:\\x.txt", newName: "y.txt", extra: 1 }` → params が `{ id: "a:b", path: "C:\\x.txt", newName: "y.txt" }`
  - `rename`, `{ id: "", path: "E:\\x.txt", newName: "y.txt" }` → params が `{ id: "", path: "E:\\x.txt", newName: "y.txt" }`
  - `createFolder`, `{ name: "x" }` → params が `{}`
  - `showMenu`, `{ x: 10, y: 20.5, items: [] }` → params が `{ x: 10, y: 20.5, items: [] }`（`extra` のキーが無い）
  - `showMenu`, `{ x: 0, y: 0, items: [{ id: "a", path: "p", z: 1 }], extra: [{ id: "pin", label: "チェストに入れる", icon: "x" }] }`
    → params が `{ x: 0, y: 0, items: [{ id: "a", path: "p" }], extra: [{ id: "pin", label: "チェストに入れる" }] }`
  - `open`, `{ id: "", path: "E:\\x.txt" }` → 成功で params が `{ id: "", path: "E:\\x.txt" }`（ref の id の空文字を許す）
- 失敗（すべて `ok: false`・`id: 5`・`error.code === "invalid"`）：
  - `rename`：`{ id: "a", path: "p", newName: "" }`、`{ id: "a", path: "p", newName: "x".repeat(256) }`、`{ id: "a", path: "", newName: "n" }`、`{ id: 1, path: "p", newName: "n" }`
  - `showMenu`：`{ y: 0, items: [] }`（x が無い）、`{ x: NaN, y: 0, items: [] }`、`{ x: 0, y: 0 }`（items が無い）、
    `{ x: 0, y: 0, items: [], extra: [{ id: "", label: "a" }] }`、`{ x: 0, y: 0, items: [], extra: [{ id: "a", label: "x".repeat(61) }] }`、
    `{ x: 0, y: 0, items: [], extra: 21 件の { id: "a", label: "b" } }`、`{ x: 0, y: 0, items: [], extra: "pin" }`
  - `open`：`{ id: 3, path: "p" }`（id が文字列でない）
- 既存の `tests/protocol.test.ts` も、変えずに合格する
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
