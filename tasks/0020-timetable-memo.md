---
id: '0020'
title: 時間割のコマとオンデマンドの授業の memo（短いメモ）を検査する
status: done
depends_on: []
gpu_need: none
tool: code
context_files:
- work/app/src/core/timetable.ts
- work/app/src/api/types.ts
- work/app/tests/timetable-ondemand.test.ts
human_review: false
expected_outputs:
- work/app/tests/timetable-memo.test.ts
test_command: bash -c "cd work/app && npm install --no-audit --no-fund --loglevel=error
  && npx tsc --noEmit && npx vitest run tests/timetable.test.ts tests/timetable-ondemand.test.ts
  tests/timetable-memo.test.ts"
qwen_self_report: success
auto_check: pass
claude_review: pass
retry_count: 0
branch: task/0020-a3
attempt: 3
implementer_report: '失敗の原因は2つ。(1) 実装の誤り: ondemand の memo 判定が `memo !== undefined &&
  memo !== null` になっており、null が誤りにならず新テストが落ちていた。仕様では undefined のときだけ省略可で null は誤りなので、`memo
  !== undefined` のみに修正。(2) テストの期待値の誤り: 既存の tests/timetable-ondemand.test.ts の ''valid
  ondemand entry'' は memo: ''x'' を入力に含み「出力で捨てられる」ことを期待していたが、ADR 0015 判断4で memo は正式なキーになったため出力に残るのが正しい。指示どおり入力の
  memo: "x", の1行のみ削除。slots 側の memo 判定は既に正しかったので変更なし。'
last_changed_files:
- work/app/tests/timetable-memo.test.ts
- work/app/src/core/timetable.ts
- work/app/tests/timetable-ondemand.test.ts
triage_count: 1
triage:
  category: spec
  reason: '失敗は2つの原因で起きていた。(1) 既存の tests/timetable-ondemand.test.ts の ''valid ondemand
    entry'' は、入力に memo: ''x'' を入れて「出力で捨てられる」ことを期待している。ADR 0015 判断4で memo は正式なキーになったので、出力に残るのが正しい動作で、この期待値は古い。指示が『既存のテストは変えない』となっていたため、実装担当は矛盾を実装で解消しようとして迷走した。(2)
    実装担当は ondemand の memo 判定を `memo !== undefined && memo !== null` にしており、memo: null
    が誤りにならず新テストが落ちている。仕様では undefined のときだけ省略可で、null は誤りにする。slots 側は正しい。指示を直し、既存テストの『memo:
    "x",』1行を消すことを明示し、null の判定を undefined のみに戻させる。どちらも既存の仕様判断は変えていない。'
  at: '2026-10-14T20:11:14'
  by: claude_cli:sonnet
review_reason: 受け入れ条件をすべて満たしている。memo の検証ロジックが正しく、null は誤りになり undefined は省略される。新しいテストが8つすべての条件をカバーし、既存テストも1行のみ削除で対応。全40テスト合格、指示の範囲内の変更のみ。
---
## Instructions

`work/app/src/core/timetable.ts` の `validateTimetable` 関数を **edits で** 直す（全文を書き直さない。`types.ts` は変更しない。`TimetableSlot` と `TimetableOndemand` に `memo?: string` は既に足してある）。

**変えてよいファイルは3つだけ：`work/app/src/core/timetable.ts`、新しいテスト `work/app/tests/timetable-memo.test.ts`、既存の `work/app/tests/timetable-ondemand.test.ts`（下の1行を消すだけ）。** `tests/timetable.test.ts` は変えない。

コマとオンデマンドの授業に、短いメモ `memo` が加わった（ADR 0015 判断4）。

- `slots[i].memo`：無い（`undefined`）なら今までどおり（出力に `memo` のキーを作らない）。あれば、文字列で長さ（`.length`）0〜200。守っていなければ `"slots[i].memo: "` で始まる誤り。正しければ、出力のその slot に `memo` を入れる。
- `ondemand[i].memo`：同じ決まりで、誤りの頭は `"ondemand[i].memo: "`。
- **`null` は誤りにする。省略として扱ってよいのは `undefined` だけ。** ondemand 側の判定は `if (memo !== undefined)` にする（`&& memo !== null` を付けない。いま付いているなら外す）。slots 側と同じ書き方にそろえる。
- 既存の `tests/timetable-ondemand.test.ts` の 'valid ondemand entry -> ok, unknown keys dropped' は、入力に `memo: "x",` の行（33行目あたり）がある。memo は今回から正式なキーで出力に残るので、この入力の `memo: "x",` の1行だけを消す。期待値（toEqual の中身）や他の行、他のテストは変えない。

## Acceptance Criteria

- 新しいテストのファイル work/app/tests/timetable-memo.test.ts がある（Vitest、import は from "../src/core/timetable"）。土台は days:[1], periods:[{id:'p1',label:'1限',start:'09:00',end:'10:30'}], slots:[{day:1,periodId:'p1',title:'英語',folders:[]}], place:null, ondemand:[{id:'o1',title:'情報倫理',folders:[]}]
- 土台そのまま → ok:true で、出力の slots[0] と ondemand[0] に memo のキーが無い
- slots[0] に memo:'301教室' → ok:true で、出力の slots[0] が { day:1, periodId:'p1', title:'英語', folders:[], memo:'301教室' }（toEqual）
- ondemand[0] に memo:'毎週金曜まで' → ok:true で、出力の ondemand[0] が { id:'o1', title:'情報倫理', folders:[], memo:'毎週金曜まで' }
- slots[0] に memo:'' → ok:true で slots[0].memo が ''。memo:'x'.repeat(200) → ok:true
- 誤り（ok:false で errors に頭が一致するものがある）：slots[0] に memo:'x'.repeat(201) と memo:3 → 'slots[0].memo: '、ondemand[0] に memo:null → 'ondemand[0].memo: '
- tests/timetable-ondemand.test.ts は、入力の `memo: "x",` の1行を消した以外は変えない。その状態で全テストが合格する（tests/timetable.test.ts は無変更で合格）
- test_command が成功する（tsc --noEmit も通る）
