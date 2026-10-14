---
id: '0001'
title: MOD の manifest.json を検査する validateManifest
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- docs/design/mod-api-v1.md
- work/app/src/api/types.ts
human_review: false
expected_outputs:
- work/app/src/core/manifest.ts
- work/app/tests/manifest.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx vitest run tests/manifest.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0001-a1
attempt: 1
implementer_report: manifest.ts とテストを作成した。
last_changed_files:
- work/app/src/core/manifest.ts
- work/app/tests/manifest.test.ts
review_reason: 実装が仕様を完全に満たし、全ての受け入れ条件がテストで検証されている。エラーメッセージ形式、フィールド検証、uses重複除去、manifest生成のいずれも正確で、テストが13/13合格している。
---
## Instructions

`work/app/src/core/manifest.ts` を新しく作り、MOD の manifest.json（JSON を読み込んだ後の値）を検査する関数を書く。
仕様の背景は `docs/design/mod-api-v1.md` の「manifest.json」。型は `work/app/src/api/types.ts` から import する
（`types.ts` は変更しない）。

```ts
import { USES, SUPPORTED_API_VERSIONS, type Manifest, type Use } from "../api/types";

export type ManifestResult = { ok: true; manifest: Manifest } | { ok: false; errors: string[] };

export function validateManifest(raw: unknown, options?: { allowBuiltin?: boolean }): ManifestResult;
```

### 決まり

- `raw` が普通のオブジェクトでない（`null`、配列、文字列・数値など）なら、`{ ok: false, errors: ["manifest: must be an object"] }` を返す
- それ以外は、下の項目を**この順に全部**調べ、見つかった誤りをすべて `errors` に入れる（最初の誤りで止めない）
- 誤りの文字列は、必ず `"<項目名>: "` で始める（例：`"id: must match ..."`）。`: ` の後ろの文は自由（英語）
- 誤りが1つも無ければ `{ ok: true, manifest }`。`manifest` には下の項目だけを入れる（知らない項目は無視して、コピーしない）。
  `description` が無ければ、`manifest` に `description` のキーを作らない

| 項目 | 正しい値 |
|---|---|
| `id` | 文字列で、正規表現 `/^[a-z0-9][a-z0-9.-]{1,62}[a-z0-9]$/` に一致する（3〜64文字）。さらに、`builtin.` で始まる id は `options.allowBuiltin === true` のときだけ正しい |
| `name` | 文字列で、`name.trim()` が空でなく、`[...name].length` が 40 以下 |
| `version` | 文字列で、`/^\d+\.\d+\.\d+$/` に一致する |
| `apiVersion` | `Number.isInteger(apiVersion)` が真で、`SUPPORTED_API_VERSIONS.min` 以上 `SUPPORTED_API_VERSIONS.max` 以下 |
| `entry` | 文字列で、`.js` で終わり、`/` でも `\` でも始まらず、`:` を含まず、`/` と `\` で区切った部分に `..` が無い |
| `uses` | 配列で、要素がすべて `USES` に含まれる文字列。含まれない要素ごとに `"uses: unknown name \"<その値>\""` の形の誤りを1つ入れる。重複は最初の1つだけ残す（順番は保つ） |
| `description` | 無くてもよい。あれば文字列で、`[...description].length` が 200 以下 |

## Acceptance Criteria

- `work/app/tests/manifest.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で次を確かめる。
  import は `from "../src/core/manifest"`（拡張子なし）
- 次の入力 → 出力になる：
  - `{ id: "neo.voxel-chest", name: "ボクセルチェスト", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: ["entries", "size", "entries"], extra: 5 }`
    → `{ ok: true, manifest: { id: "neo.voxel-chest", name: "ボクセルチェスト", version: "1.0.0", apiVersion: 1, entry: "index.js", uses: ["entries", "size"] } }`
    （`toEqual` で比べる。`extra` と `description` のキーは無い）
  - 上と同じで `description: "説明"` を足す → `manifest.description` が `"説明"`
  - `null` → `{ ok: false, errors: ["manifest: must be an object"] }`
  - `[]` → `{ ok: false, errors: ["manifest: must be an object"] }`
  - `{}` → `ok` が false で、`errors` に `"id: "`・`"name: "`・`"version: "`・`"apiVersion: "`・`"entry: "`・`"uses: "` で始まるものが1つずつある（`description:` で始まるものは無い）
  - id が `"ab"`（2文字）、`"Neo.view"`（大文字）、`"neo.view."`（末尾が点）、`"-neo"`（先頭がハイフン） → それぞれ `errors` に `"id: "` で始まるものがある
  - id が `"builtin.win11"` → オプションなしでは `"id: "` の誤り。`{ allowBuiltin: true }` なら ok
  - name が `"   "` → `"name: "` の誤り。name が `"あ".repeat(40)` → ok。`"あ".repeat(41)` → `"name: "` の誤り
  - version が `"1.0"` → `"version: "` の誤り
  - apiVersion が `2`・`1.5`・`"1"` → それぞれ `"apiVersion: "` の誤り
  - entry が `"index.ts"`・`"/index.js"`・`"\\index.js"`・`"C:index.js"`・`"../index.js"`・`"lib\\..\\index.js"` → それぞれ `"entry: "` の誤り。`"dist/main.js"` → ok
  - uses が `["entries", "foo", "bar"]` → `errors` に `"uses: unknown name \"foo\""` と `"uses: unknown name \"bar\""` がある
  - uses が `"entries"`（配列でない） → `"uses: "` の誤り
  - description が `123` → `"description: "` の誤り
- `test_command` が成功する
