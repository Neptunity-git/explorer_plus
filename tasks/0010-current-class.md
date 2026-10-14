---
id: '0010'
title: 今の授業を決める currentClass と、2点の距離 distanceMeters
status: blocked
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
qwen_self_report: failure
auto_check: fail
claude_review: n/a
retry_count: 2
branch: task/0010-a2
attempt: 2
implementer_report: 'edits の 1 番目（work/app/tests/timetable-now.test.ts）：同じファイルを files
  と edits の両方に入れています。どちらか一方にすること。何も書き込んでいません（書き直させても直りませんでした。1回目の問題: edits の 1 番目（work/app/tests/timetable-now.test.ts）：同じファイルを
  files と edits の両方に入れています。どちらか一方にすること）'
last_changed_files:
- work/app/src/core/timetable-now.ts
- work/app/tests/timetable-now.test.ts
last_failure: '実装担当の失敗: edits の 1 番目（work/app/tests/timetable-now.test.ts）：同じファイルを
  files と edits の両方に入れています。どちらか一方にすること。何も書き込んでいません（書き直させても直りませんでした。1回目の問題: edits の
  1 番目（work/app/tests/timetable-now.test.ts）：同じファイルを files と edits の両方に入れています。どちらか一方にすること）'
blocked_reason: '機械的検証に2回失敗しました。最後の失敗: 実装担当の失敗: edits の 1 番目（work/app/tests/timetable-now.test.ts）：同じファイルを
  files と edits の両方に入れています。どちらか一方にすること。何も書き込んでいません（書き直させても直りませんでした。1回目の問題: edits の
  1 番目（work/app/tests/timetable-now.test.ts）：同じファイルを files と edits の両方に入れています。どちらか一方にすること）'
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
