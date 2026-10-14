import { describe, it, expect } from "vitest";
import type { EntryRef, Timetable } from "../src/api/types";
import {
  emptyRegistry,
  findTimetable,
  putTimetable,
  removeTimetable,
  allCurrent,
} from "../src/core/timetables";

// タスクの受け入れ条件どおりのデータ（A校の1限は 9:00-10:30、B校の1時間目は 9:30-10:20）
const ttA: Timetable = { days: [1, 2, 3, 4, 5], periods: [{ id: "p1", label: "1限", start: "09:00", end: "10:30" }], slots: [{ day: 2, periodId: "p1", title: "A校の授業", folders: [] }], place: null };
const ttB: Timetable = { days: [1, 2, 3, 4, 5], periods: [{ id: "q1", label: "1時間目", start: "09:30", end: "10:20" }], slots: [{ day: 2, periodId: "q1", title: "B校の授業", folders: [] }], place: null };
const a: EntryRef = { id: "1:a", path: "C:\\学業\\A校" };
const b: EntryRef = { id: "1:b", path: "C:\\学業\\B校" };

describe("timetables", () => {
  it("findTimetable on empty registry returns null", () => {
    expect(findTimetable(emptyRegistry(), a)).toBeNull();
  });

  it("putTimetable then findTimetable", () => {
    const reg0 = emptyRegistry();
    const reg1 = putTimetable(reg0, a, ttA);
    expect(findTimetable(reg1, a)).toEqual(ttA);
    expect(findTimetable(reg1, b)).toBeNull();
    // 引数の登録簿が変わっていない
    expect(reg0).toEqual(emptyRegistry());
  });

  it("putTimetable replaces same folder keeping order", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const moved: EntryRef = { id: "1:a", path: "D:\\moved\\A校" };
    const reg2 = putTimetable(reg, moved, ttB);
    expect(reg2.entries.length).toBe(2);
    expect(reg2.entries[0].folder.path).toBe("D:\\moved\\A校");
    expect(reg2.entries[0].timetable).toEqual(ttB);
  });

  it("removeTimetable removes matching folder", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const reg2 = removeTimetable(reg, a);
    expect(reg2.entries.length).toBe(1);
    expect(reg2.entries[0].folder).toEqual(b);
    expect(reg2.entries[0].timetable).toEqual(ttB);
  });

  it("removeTimetable on missing folder keeps length", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const missing: EntryRef = { id: "1:c", path: "D:\\C校" };
    const reg2 = removeTimetable(reg, missing);
    expect(reg2.entries.length).toBe(2);
  });

  it("allCurrent on Tuesday 9:45 with null here returns 2", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const now = new Date(2026, 9, 13, 9, 45); // 2026-10-13 は火曜
    const res = allCurrent(reg, now, null);
    expect(res.length).toBe(2);
    expect(res[0].slot.title).toBe("A校の授業");
    expect(res[0].folder).toEqual(a);
    expect(res[1].slot.title).toBe("B校の授業");
    expect(res[1].folder).toEqual(b);
  });

  it("allCurrent on Tuesday 9:15 returns 1 (A校の授業)", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const now = new Date(2026, 9, 13, 9, 15);
    const res = allCurrent(reg, now, null);
    expect(res.length).toBe(1);
    expect(res[0].slot.title).toBe("A校の授業");
  });

  it("allCurrent on Tuesday 10:25 returns 1 (A校の授業)", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const now = new Date(2026, 9, 13, 10, 25);
    const res = allCurrent(reg, now, null);
    expect(res.length).toBe(1);
    expect(res[0].slot.title).toBe("A校の授業");
  });

  it("allCurrent on Tuesday 10:45 returns empty", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const now = new Date(2026, 9, 13, 10, 45);
    const res = allCurrent(reg, now, null);
    expect(res).toEqual([]);
  });

  it("allCurrent on Wednesday 9:45 returns empty", () => {
    let reg = emptyRegistry();
    reg = putTimetable(reg, a, ttA);
    reg = putTimetable(reg, b, ttB);
    const now = new Date(2026, 9, 14, 9, 45); // 水曜
    const res = allCurrent(reg, now, null);
    expect(res).toEqual([]);
  });
});
