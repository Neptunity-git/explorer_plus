---
id: 0018
title: フォルダごとの時間割の登録簿（探す・入れる・消す・全部の今の授業）
status: blocked
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/api/types.ts
- work/app/src/core/tags.ts
- work/app/src/core/timetable-now.ts
human_review: false
expected_outputs:
- work/app/src/core/timetables.ts
- work/app/tests/timetables.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/timetables.test.ts"
qwen_self_report: needs_human
auto_check: n/a
claude_review: needs_human
retry_count: 0
branch: task/0018-a1
attempt: 1
implementer_report: work/app/src/core/timetables.ts と work/app/tests/timetables.test.ts
  を新規作成した。allCurrent のテストで使う日付は 2026-10-13（火曜）/2026-10-14（水曜）を使用。ttA・ttB は火曜 1限 09:30-10:20・2限
  10:30-11:20 の時間割で、9:15 は期間外のため 0 件になるが、受け入れ条件の「火曜 9:15 → 1件（A校の授業）」に合わせるため、ttA の
  1限 start を 09:00 にして 9:15 が期間内になるよう調整が必要か確認した。受け入れ条件の 9:15→1件・10:25→1件・10:45→[]
  を満たすには、1限 09:00-10:20、2限 10:30-11:20 とする。ttA・ttB の periods をそれに修正する。
blocked_reason: '実装担当が「設計判断が必要」と報告しました: work/app/src/core/timetables.ts と work/app/tests/timetables.test.ts
  を新規作成した。allCurrent のテストで使う日付は 2026-10-13（火曜）/2026-10-14（水曜）を使用。ttA・ttB は火曜 1限 09:30-10:20・2限
  10:30-11:20 の時間割で、9:15 は期間外のため 0 件になるが、受け入れ条件の「火曜 9:15 → 1件（A校の授業）」に合わせるため、ttA の
  1限 start を 09:00 にして 9:15 が期間内になるよう調整が必要か確認した。受け入れ条件の 9:15→1件・10:25→1件・10:45→[]
  を満たすには、1限 09:00-10:20、2限 10:30-11:20 とする。ttA・ttB の periods をそれに修正する。


  Claude の見直し（数行の修正（朝に Claude が直接直す））: 実装（src/core/timetables.ts）は指示どおりで正しい。問題はテストファイルの冒頭で、受け入れ条件に書かれた
  ttA（1限 09:00-10:30）・ttB（1時間目 09:30-10:20）・a・b を使わず、2コマの別の時間割と別のパス（D:\A校）を自作していたこと。これで
  9:15 が期間外になり、実装担当は受け入れ条件と合わないと思い込んで「設計判断が必要」と報告した。仕様は矛盾しておらず、指定どおりのデータなら 9:15→A
  のみ、10:25→A のみ（B は 10:20 で終了）、10:45→[]、9:45→A・B の2件、水曜→[] となる。ファイル冒頭の定義を差し替えれば直るので、実装担当にやり直させず
  patch で示す。

  修正案: tasks/fixes/0018.md'
triage_count: 1
triage:
  category: direct_fix
  reason: 実装（src/core/timetables.ts）は指示どおりで正しい。問題はテストファイルの冒頭で、受け入れ条件に書かれた ttA（1限 09:00-10:30）・ttB（1時間目
    09:30-10:20）・a・b を使わず、2コマの別の時間割と別のパス（D:\A校）を自作していたこと。これで 9:15 が期間外になり、実装担当は受け入れ条件と合わないと思い込んで「設計判断が必要」と報告した。仕様は矛盾しておらず、指定どおりのデータなら
    9:15→A のみ、10:25→A のみ（B は 10:20 で終了）、10:45→[]、9:45→A・B の2件、水曜→[] となる。ファイル冒頭の定義を差し替えれば直るので、実装担当にやり直させず
    patch で示す。
  at: '2026-10-14T18:48:58'
  by: claude_cli:sonnet
proposed_fix: tasks/fixes/0018.md
---
## Instructions

`work/app/src/core/timetables.ts` を新しく作る。時間割は学校のフォルダごとに持つ（ADR 0012 判断1）。その登録簿を扱う関数を書く。
**どの関数も、引数の登録簿を書き換えず、新しいものを返す。** `sameRef` は `./tags` から、`currentClass` は `./timetable-now` から import する
（`tags.ts`・`timetable-now.ts`・`types.ts` は変更しない）。

```ts
import type { EntryRef, Timetable, TimetablePeriod, TimetableSlot } from "../api/types";
import { sameRef } from "./tags";
import { currentClass } from "./timetable-now";

export type TimetableEntry = { folder: EntryRef; timetable: Timetable };
export type TimetableRegistry = { entries: TimetableEntry[] };
export type NowClass = { folder: EntryRef; slot: TimetableSlot; period: TimetablePeriod };

export function emptyRegistry(): TimetableRegistry;
export function findTimetable(reg: TimetableRegistry, folder: EntryRef): Timetable | null;
export function putTimetable(reg: TimetableRegistry, folder: EntryRef, timetable: Timetable): TimetableRegistry;
export function removeTimetable(reg: TimetableRegistry, folder: EntryRef): TimetableRegistry;
export function allCurrent(
  reg: TimetableRegistry,
  now: Date,
  here: { latitude: number; longitude: number; accuracy: number } | null,
): NowClass[];
```

- **emptyRegistry**：`{ entries: [] }`（呼ぶたびに新しいオブジェクト）
- **findTimetable**：`sameRef(entry.folder, folder)` が真になる最初の entry の `timetable`。無ければ `null`
- **putTimetable**：同じフォルダ（sameRef）の entry があれば、その entry を `{ folder, timetable }`（引数の folder で置き換える。パスを新しくするため）にした
  新しい登録簿。順番は変えない。無ければ最後に足す
- **removeTimetable**：同じフォルダ（sameRef）の entry を除いた新しい登録簿。無ければ同じ中身の新しい登録簿
- **allCurrent**：`entries` の順に、各 `timetable` について `currentClass(timetable, now, here)` を呼び、`null` でないものを `{ folder, slot, period }` にして並べる

## Acceptance Criteria

- `work/app/tests/timetables.test.ts` を新しく作り、Vitest（`import { describe, it, expect } from "vitest"`）で確かめる。import は `from "../src/core/timetables"` と
  `import type { Timetable } from "../src/api/types"`。
- テストで使う時間割（`ttA`・`ttB`）：
  ```ts
  const ttA: Timetable = { days: [1, 2, 3, 4, 5], periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30" }], slots: [{ day: 2, periodId: "p1", title: "A校の授業", folders: [] }], place: null };
  const ttB: Timetable = { days: [1, 2, 3, 4, 5], periods: [{ id: "q1", label: "1時間目", start: "09:30", end: "10:20" }], slots: [{ day: 2, periodId: "q1", title: "B校の授業", folders: [] }], place: null };
  const a = { id: "1:a", path: "C:\\学業\\A校" };
  const b = { id: "1:b", path: "C:\\学業\\B校" };
  ```
  火曜日は `new Date(2026, 9, 13, 時, 分)`（2026年10月13日は火曜日。月は 0 始まり）
- `findTimetable(emptyRegistry(), a)` → `null`
- `putTimetable(emptyRegistry(), a, ttA)` の後、`findTimetable(…, a)` が `ttA`（`toEqual`）、`findTimetable(…, b)` が `null`
- 引数の登録簿が変わっていない（`putTimetable` の前後で、渡した登録簿が `toEqual(emptyRegistry())` のまま）
- a・b の順に入れた後、`putTimetable(…, { id: "1:a", path: "D:\\moved\\A校" }, ttB)` → `entries.length` が 2 のまま、`entries[0].folder.path` が `"D:\\moved\\A校"`、`entries[0].timetable` が ttB
- a・b を入れた後 `removeTimetable(…, a)` → `entries.length` が 1 で、残りが b。存在しないフォルダを `removeTimetable` → `entries.length` は 2 のまま
- allCurrent（a に ttA、b に ttB を入れた登録簿）：
  - 火曜 9:45、`here` が null → 2件。1件目の `slot.title` が `"A校の授業"` で `folder` が a、2件目が `"B校の授業"` で `folder` が b
  - 火曜 9:15 → 1件（`"A校の授業"`）。火曜 10:25 → 1件（`"A校の授業"`）。火曜 10:45 → `[]`。水曜（`new Date(2026, 9, 14, 9, 45)`）→ `[]`
- `test_command` が成功する（型チェック `tsc --noEmit` も通る）
