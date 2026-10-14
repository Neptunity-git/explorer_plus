---
id: "0009"
title: 時間割の検査 validateTimetable と、時刻の読み取り parseTime
status: todo
depends_on: []
gpu_need: none
tool: code
context_files:
  - work/app/src/api/types.ts
human_review: false
expected_outputs:
  - work/app/src/core/timetable.ts
  - work/app/tests/timetable.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npx vitest run tests/timetable.test.ts"
qwen_self_report: n/a
auto_check: n/a
claude_review: n/a
retry_count: 0
---
## Instructions

`work/app/src/core/timetable.ts` を新しく作る。時間割はユーザーが自由に設定し、MOD（時間割ビュー）から本体に保存を頼まれるので、
本体はどんな値が届いても例外を投げずに検査する。型は `work/app/src/api/types.ts` の `Timetable`・`TimetablePeriod`・`TimetableSlot`・
`TimetablePlace`・`EntryRef` を import する（`types.ts` は変更しない）。

```ts
import type { EntryRef, Timetable, TimetablePeriod, TimetablePlace, TimetableSlot } from "../api/types";

export function parseTime(s: unknown): number | null;
export function emptyTimetable(): Timetable;
export type TimetableResult = { ok: true; timetable: Timetable } | { ok: false; errors: string[] };
export function validateTimetable(raw: unknown): TimetableResult;
```

### parseTime

- `s` が文字列で、正規表現 `/^([01]\d|2[0-3]):([0-5]\d)$/` に一致すれば、0時0分からの分（`時 * 60 + 分`）を返す。それ以外は `null`

### emptyTimetable

- `{ days: [1, 2, 3, 4, 5], periods: [], slots: [], place: null }` を返す（呼ぶたびに新しいオブジェクト）

### validateTimetable

- `raw` が普通のオブジェクトでない（`null`・配列・文字列など）→ `{ ok: false, errors: ["timetable: must be an object"] }`
- それ以外は、下の項目を**この順に全部**調べ、誤りをすべて `errors` に入れる。誤りの文字列は、必ず下の表の「誤りの頭」で始め、その後に `": "` と自由な英語を続ける
  （例：`"periods[0].start: must be HH:MM"`）。`[i]` は配列の何番目か（0 から）
- 誤りが無ければ `{ ok: true, timetable }`。`timetable` には下の項目だけを入れ（知らない項目はコピーしない）、`days` は重なりを除いて小さい順に並べる

| 項目 | 正しい値 | 誤りの頭 |
|---|---|---|
| `days` | 配列 | `days` |
| `days` の各要素 | 0〜6 の整数（`Number.isInteger`） | `days[i]` |
| `periods` | 配列で、長さ 20 以下 | `periods` |
| `periods` の各要素 | 普通のオブジェクト | `periods[i]` |
| `periods[i].id` | 文字列で、長さ（`.length`）1〜32。それより前の要素と同じ id は誤り | `periods[i].id` |
| `periods[i].label` | 文字列で、長さ 1〜20 | `periods[i].label` |
| `periods[i].start`・`.end` | `parseTime` が `null` でない | `periods[i].start`・`periods[i].end` |
| start と end の関係 | 両方読めたとき、`parseTime(start) < parseTime(end)` | `periods[i]` |
| `slots` | 配列で、長さ 140 以下 | `slots` |
| `slots` の各要素 | 普通のオブジェクト | `slots[i]` |
| `slots[i].day` | 0〜6 の整数 | `slots[i].day` |
| `slots[i].periodId` | 文字列で、`periods` のどれかの `id` と同じ（`periods` の要素のうち、id が正しく読めたもので比べる） | `slots[i].periodId` |
| `slots[i].title` | 文字列で、長さ 0〜60 | `slots[i].title` |
| `slots[i].folders` | 配列で長さ 0〜5。各要素は普通のオブジェクトで、`id` が文字列（空文字でもよい）、`path` が空でない文字列 | `slots[i].folders` |
| 同じコマの重なり | `day` と `periodId` の組が、それより前の要素と同じなら誤り | `slots[i]` |
| `place` | 無い（`undefined`）か `null` なら `null` として扱う。それ以外は普通のオブジェクトで、`latitude` が -90〜90、`longitude` が -180〜180、`radius` が 0 より大きく 100000 以下の有限の数（`Number.isFinite`） | `place` |

- 出力の各要素は、表に書いた項目だけを持つ：period は `{ id, label, start, end }`、slot は `{ day, periodId, title, folders }`、folders の各要素は `{ id, path }`、place は `{ latitude, longitude, radius }` か `null`

## Acceptance Criteria

- `work/app/tests/timetable.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/timetable"`（拡張子なし）
- parseTime：`"09:00"` → 540、`"00:00"` → 0、`"23:59"` → 1439、`"9:00"` → null、`"24:00"` → null、`"12:60"` → null、`"12:00 "` → null、`930` → null、`null` → null
- emptyTimetable：`toEqual({ days: [1, 2, 3, 4, 5], periods: [], slots: [], place: null })`、2回呼んだ結果が別のオブジェクト（`not.toBe`）
- 正しい入力：
  ```ts
  { days: [5, 1, 3, 1], extra: 1,
    periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30", x: 1 }, { id: "p2", label: "2限", start: "10:40", end: "12:10" }],
    slots: [{ day: 2, periodId: "p2", title: "線形代数", folders: [{ id: "a:b", path: "C:\\授業\\線形代数", z: 1 }], memo: "x" }] }
  ```
  → `{ ok: true, timetable: { days: [1, 3, 5], periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30" }, { id: "p2", label: "2限", start: "10:40", end: "12:10" }], slots: [{ day: 2, periodId: "p2", title: "線形代数", folders: [{ id: "a:b", path: "C:\\授業\\線形代数" }] }], place: null } }`（`toEqual` で比べる）
- 上と同じで `place: { latitude: 36.4, longitude: 139.1, radius: 300 }` → 出力の `place` が `{ latitude: 36.4, longitude: 139.1, radius: 300 }`
- 誤り（`ok` が false で、`errors` に、書いた頭で始まるものがある）。土台は上の正しい入力で、1か所だけ変える：
  - `null`・`[]`・`"x"` → `errors` が `["timetable: must be an object"]`
  - `days: [1, 7]` → `"days[1]: "`、`days: [1.5]` → `"days[0]: "`、`days` を消す → `"days: "`
  - periods の 0番目の start を `"9:00"` → `"periods[0].start: "`
  - periods の 0番目を `{ id: "p1", label: "1限", start: "10:30", end: "09:00" }` → `"periods[0]: "`
  - periods の 1番目の id を `"p1"` → `"periods[1].id: "`
  - periods の 0番目の label を `""` → `"periods[0].label: "`
  - periods を 21 個の要素（id は `"p0"`〜`"p20"`、label `"x"`、start `"09:00"`、end `"10:00"`）にする → `"periods: "`
  - slots の 0番目の periodId を `"p9"` → `"slots[0].periodId: "`
  - slots の 0番目の day を `7` → `"slots[0].day: "`
  - slots の 0番目の title を `"x".repeat(61)` → `"slots[0].title: "`
  - slots の 0番目の folders を `[{ id: "a", path: "" }]` → `"slots[0].folders: "`
  - slots を `[{ day: 2, periodId: "p2", title: "a", folders: [] }, { day: 2, periodId: "p2", title: "b", folders: [] }]` → `"slots[1]: "`
  - `place: { latitude: 91, longitude: 0, radius: 100 }` → `"place: "`、`place: { latitude: 0, longitude: 0, radius: 0 }` → `"place: "`
- 2か所が同時に誤り（periods の 0番目の end を `"25:00"` にし、かつ `days: [9]`）→ `errors` に `"days[0]: "` で始まるものと `"periods[0].end: "` で始まるものの両方がある
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
