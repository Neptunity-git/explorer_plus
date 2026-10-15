// 学校のフォルダの中に置く時間割のファイルの形（ADR 0022）
import { describe, expect, it } from "vitest";
import type { Timetable } from "../src/api/types";
import { fromTimetableFile, relativeTo, toTimetableFile } from "../src/core/timetable-file";

const school = "C:\\Users\\a\\OneDrive\\学業\\A校";

const tt: Timetable = {
  days: [1, 2],
  periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30" }],
  slots: [
    { day: 1, periodId: "p1", title: "数学", folders: [{ id: "abc:123", path: `${school}\\数学` }, { id: "x:1", path: "D:\\資料\\数学" }], memo: "R301" },
    { day: 2, periodId: "p1", title: "全体", folders: [{ id: "y:1", path: school }] },
  ],
  place: null,
  ondemand: [{ id: "o1", title: "英語", folders: [{ id: "z:1", path: `${school}\\英語\\動画` }] }],
};

describe("relativeTo", () => {
  it("中なら相対パス、同じなら空、外なら null。大文字・小文字は区別しない", () => {
    expect(relativeTo("C:\\a\\b\\c", "C:\\A\\b")).toBe("c");
    expect(relativeTo("C:\\a\\b\\", "C:\\a\\b")).toBe("");
    expect(relativeTo("C:\\a\\bc", "C:\\a\\b")).toBeNull();
    expect(relativeTo("D:\\x", "C:\\a")).toBeNull();
  });
});

describe("toTimetableFile", () => {
  it("学校の中は相対パス、外はそのまま、学校そのものは「.」。ファイルID は書かない", () => {
    const f = toTimetableFile(tt, school);
    expect(f.v).toBe(1);
    expect(f.timetable.slots[0].folders).toEqual([{ id: "", path: "数学" }, { id: "", path: "D:\\資料\\数学" }]);
    expect(f.timetable.slots[0].memo).toBe("R301");
    expect(f.timetable.slots[1].folders).toEqual([{ id: "", path: "." }]);
    expect(f.timetable.ondemand?.[0].folders).toEqual([{ id: "", path: "英語\\動画" }]);
  });
});

describe("fromTimetableFile", () => {
  it("別の PC の学校のフォルダから見た絶対パスに戻す", () => {
    const other = "C:\\Users\\b\\OneDrive\\学業\\A校\\";
    const back = fromTimetableFile(toTimetableFile(tt, school), other) as Timetable;
    expect(back.slots[0].folders).toEqual([
      { id: "", path: "C:\\Users\\b\\OneDrive\\学業\\A校\\数学" },
      { id: "", path: "D:\\資料\\数学" },
    ]);
    expect(back.slots[1].folders).toEqual([{ id: "", path: "C:\\Users\\b\\OneDrive\\学業\\A校" }]);
    expect(back.ondemand?.[0].folders).toEqual([{ id: "", path: "C:\\Users\\b\\OneDrive\\学業\\A校\\英語\\動画" }]);
  });

  it("/ 区切りの相対パスも読める。形が違えば null", () => {
    const back = fromTimetableFile({ v: 1, timetable: { ...tt, slots: [{ ...tt.slots[0], folders: [{ id: "", path: "英語/動画" }] }] } }, school) as Timetable;
    expect(back.slots[0].folders[0].path).toBe(`${school}\\英語\\動画`);
    expect(fromTimetableFile(null, school)).toBeNull();
    expect(fromTimetableFile({ v: 1 }, school)).toBeNull();
  });
});
