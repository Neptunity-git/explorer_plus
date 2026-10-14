---
id: '0010'
title: 今の授業を決める currentClass と、2点の距離 distanceMeters
status: todo
depends_on:
- 0009
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
- work/app/src/core/timetable.ts
human_review: false
expected_outputs:
- work/app/src/core/timetable-now.ts
- work/app/tests/timetable-now.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/timetable-now.test.ts"
qwen_self_report: success
auto_check: fail
claude_review: n/a
retry_count: 1
branch: task/0010-a1
attempt: 1
implementer_report: timetable-now.ts とテストを作成しました。
last_changed_files:
- work/app/src/core/timetable-now.ts
- work/app/tests/timetable-now.test.ts
last_failure: "\nup to date in 302ms\n\n RUN  v5.0.4 /mnt/c/Users/neo_m/projects-NEO/.teamneo-worktrees/explorer_plus/work/app\n\
  \n ❯ tests/timetable-now.test.ts (13 tests | 1 failed) 9ms\n   ✓ distanceMeters\
  \ (3)\n     ✓ same point is 0 1ms\n     ✓ 1 degree of longitude at equator 0ms\n\
  \     ✓ 1 degree of latitude 0ms\n   ❯ currentClass (10)\n     ✓ Tuesday 10:45 with\
  \ null here returns 線形代数 / p2 1ms\n     ✓ Tuesday 10:40 (start inclusive) returns\
  \ 線形代数 0ms\n     ✓ Tuesday 12:10 (end exclusive) returns null 0ms\n     × Tuesday\
  \ 10:35 (break) returns null 4ms\n     ✓ Monday 9:00 returns 英語 0ms\n     ✓ Wednesday\
  \ 10:45 (no slot that day) returns null 0ms\n     ✓ overlapping period: Tuesday\
  \ 10:45 returns first matching period (p2) 0ms\n     ✓ place condition (3)\n   \
  \    ✓ within radius + accuracy returns 線形代数 0ms\n       ✓ outside radius + accuracy\
  \ returns null 0ms\n       ✓ here is null returns 線形代数 (time only) 0ms\n\n Test\
  \ Files  1 failed (1)\n      Tests  1 failed | 12 passed (13)\n   Start at  15:19:45\n\
  \   Duration  1.08s (import 45%, transform 34%, worker 18%, tests 4%)\n\n\n⎯⎯⎯⎯⎯⎯⎯\
  \ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  tests/timetable-now.test.ts > currentClass >\
  \ Tuesday 10:35 (break) returns null\nAssertionError: expected { slot: { day: 2,\
  \ …(3) }, …(1) } to be null\n\n- Expected:\nnull\n\n+ Received:\n{\n  \"period\"\
  : {\n    \"end\": \"11:00\",\n    \"id\": \"p2\",\n    \"label\": \"2限\",\n    \"\
  start\": \"10:00\",\n  },\n  \"slot\": {\n    \"day\": 2,\n    \"folders\": [],\n\
  \    \"periodId\": \"p2\",\n    \"title\": \"線形代数\",\n  },\n}\n\n ❯ tests/timetable-now.test.ts:61:17\n\
  \     59|     const now = new Date(2026, 0, 6, 10, 35, 0);\n     60|     const res\
  \ = currentClass(tt, now, null);\n     61|     expect(res).toBeNull();\n       |\
  \                 ^\n     62|   });\n     63|\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯\n\
  \n"
---
## Instructions

`work/app/src/core/timetable-now.ts` を新しく作る。`work/app/src/core/timetable.ts` の `parseTime` を使う（`timetable.ts` と `types.ts` は変更しない）。

```ts
import type { CurrentClass, Timetable } from "../api/types";
import { parseTime } from "./timetable";

export type LatLng = { latitude: number; longitude: number };
export function distanceMeters(a: LatLng, b: LatLng): number;
export function currentClass(
  tt: Timetable,
  now: Date,
  here: { latitude: number; longitude: number; accuracy: number } | null,
): CurrentClass;
```

### distanceMeters

- 球面上の2点の距離（ハーバサインの公式）。地球の半径は `6371000` メートル。緯度・経度は度で受け取り、`Math.PI / 180` を掛けてラジアンにする
- 公式：`φ1, φ2` を緯度、`Δφ`・`Δλ` を緯度・経度の差（ラジアン）として、
  `h = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)`、距離 = `2 · 6371000 · asin(√h)`

### currentClass

1. `day = now.getDay()`、`minutes = now.getHours() * 60 + now.getMinutes()`（どちらも `now` の地方時。秒は見ない）
2. `tt.periods` を**配列の順に**見て、`parseTime(start) <= minutes < parseTime(end)` を満たす period ごとに、`tt.slots` の中から
   `slot.day === day && slot.periodId === period.id` のものを探す。最初に見つかった組を候補にする（時刻が合っていても、その曜日のコマが無ければ次の period へ）
3. 候補が無ければ `null`
4. 場所の条件：`tt.place` が `null` でなく、かつ `here` が `null` でないとき、`distanceMeters(here, tt.place) > tt.place.radius + here.accuracy` なら `null`。
   `tt.place` が `null`、または `here` が `null`（位置が取れない）なら、場所は見ない
5. それ以外は `{ slot, period }`（見つけた要素そのもの）

## Acceptance Criteria

- `work/app/tests/timetable-now.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/timetable-now"`（拡張子なし）
- distanceMeters：
  - `({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })` → `0`
  - `({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })` → `toBeCloseTo(111194.93, 1)`
  - `({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })` → `toBeCloseTo(111194.93, 1)`
- currentClass。共通の時間割（テストの中で作る。`Timetable` 型）：
  ```ts
  const tt: Timetable = {
    days: [1, 2, 3, 4, 5],
    periods: [
      { id: "p1", label: "1限", start: "09:00", end: "10:30" },
      { id: "p2", label: "2限", start: "10:40", end: "12:10" },
    ],
    slots: [
      { day: 1, periodId: "p1", title: "英語", folders: [] },
      { day: 2, periodId: "p2", title: "線形代数", folders: [] },
    ],
    place: null,
  };
  ```
  日付は `new Date(2026, 9, 13, 時, 分)`（2026年10月13日は火曜日。月は 0 始まりなので 9 が10月）、`new Date(2026, 9, 12, …)` は月曜日、`new Date(2026, 9, 14, …)` は水曜日
  - 火曜 10:45、`here` が null → 結果の `slot.title` が `"線形代数"`、`period.id` が `"p2"`
  - 火曜 10:40 → `"線形代数"`（始まりの時刻は含む）
  - 火曜 12:10 → `null`（終わりの時刻は含まない）
  - 火曜 10:35 → `null`（休み時間）
  - 月曜 9:00 → `"英語"`
  - 水曜 10:45 → `null`（その曜日のコマが無い）
- 時刻が重なる period：上の `tt` に period `{ id: "p3", label: "特別", start: "09:30", end: "11:00" }` を3番目に足し、slot `{ day: 2, periodId: "p3", title: "特別講義", folders: [] }` を足す。
  火曜 9:45 → `"特別講義"`（p1 は時刻が合うが火曜のコマが無いので、次の p3 になる）
- 場所の条件：上の `tt` の `place` を `{ latitude: 0, longitude: 0, radius: 100 }` にして、火曜 10:45 で
  - `here = { latitude: 0, longitude: 0.0005, accuracy: 10 }`（約 56m）→ `"線形代数"`
  - `here = { latitude: 0, longitude: 0.01, accuracy: 50 }`（約 1112m）→ `null`
  - `here = null` → `"線形代数"`（位置が取れないときは時刻だけで決める）
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
