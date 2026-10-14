---
id: '0005'
title: ファイルの大きさを読みやすい文字列にする formatSize
status: done
depends_on: []
gpu_need: none
tool: code
context_files: []
human_review: false
expected_outputs:
- work/app/src/core/format.ts
- work/app/tests/format.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx vitest run tests/format.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0005-a1
attempt: 1
implementer_report: format.ts と format.test.ts を新規作成しました。1024倍の単位変換、小数第1位/整数の四捨五入、末尾
  .0 の除去、1024 到達でも単位を上げない挙動、TB 上限、不正入力で "" を返す挙動を実装し、受け入れ条件の全ケースを検証する Vitest テストを書きました。
last_changed_files:
- work/app/src/core/format.ts
- work/app/tests/format.test.ts
review_reason: 実装が仕様を完全に満たしており、全テストケース（19項目）が正しく検証されている。小数処理、単位上限、不正入力の処理いずれも正確。
---
## Instructions

`work/app/src/core/format.ts` を新しく作り、バイト数を読みやすい文字列にする関数を書く。

```ts
export function formatSize(bytes: number): string;
```

### 決まり

- 単位は `B`・`KB`・`MB`・`GB`・`TB`。1つ上の単位は 1024 倍
- `bytes` が 0 以上の整数でない（負の数、小数、`NaN`、`Infinity`）なら `""` を返す
- `bytes` が 1024 未満なら `"<bytes> B"`（例：`"0 B"`、`"1023 B"`）
- それ以外は、値が 1 以上になる一番大きい単位（TB まで）で表す。`v = bytes / 1024^k` として：
  - `v < 10` なら小数第1位まで四捨五入（`Math.round(v * 10) / 10`）し、末尾が `.0` なら取る
  - `v >= 10` なら整数に四捨五入（`Math.round(v)`）
  - 数と単位の間に半角スペース1つ（例：`"1.5 KB"`）
  - 四捨五入で 1024 になっても、単位は上げない（例：`1048575` → `"1024 KB"`）
- 1024 TB 以上も TB のまま表す（例：`1024 ** 5` → `"1024 TB"`）

## Acceptance Criteria

- `work/app/tests/format.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で次を確かめる。
  import は `from "../src/core/format"`（拡張子なし）
- 次の入力 → 出力になる：
  - `0` → `"0 B"`、`1` → `"1 B"`、`1023` → `"1023 B"`
  - `1024` → `"1 KB"`、`1536` → `"1.5 KB"`、`1075` → `"1 KB"`（1.0498… → 1.0 → `.0` を取る）、`10239` → `"10 KB"`（9.999… → 10.0 → `.0` を取る）、`10240` → `"10 KB"`
  - `1048575` → `"1024 KB"`、`1048576` → `"1 MB"`、`123456789` → `"118 MB"`
  - `1073741824` → `"1 GB"`、`5 * 1024 ** 3 + 300 * 1024 ** 2` → `"5.3 GB"`
  - `1024 ** 4` → `"1 TB"`、`1024 ** 5` → `"1024 TB"`
  - `-1` → `""`、`1.5` → `""`、`NaN` → `""`、`Infinity` → `""`
- `test_command` が成功する
