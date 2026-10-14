import { describe, it, expect } from "vitest";
import { distanceMeters, currentClass } from "../src/core/timetable-now";
import type { Timetable } from "../src/api/types";

function makeTimetable(): Timetable {
  return {
    days: [1, 2, 3, 4, 5],
    periods: [
      { id: "p1", label: "1限", start: "09:00", end: "09:50" },
      { id: "p2", label: "2限", start: "10:00", end: "11:00" },
    ],
    slots: [
      { day: 1, periodId: "p1", title: "英語", folders: [] },
      { day: 2, periodId: "p2", title: "線形代数", folders: [] },
    ],
    place: null,
  };
}

describe("distanceMeters", () => {
  it("same point is 0", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
  });

  it("1 degree of longitude at equator", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111194.93, 1);
  });

  it("1 degree of latitude", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111194.93, 1);
  });
});

describe("currentClass", () => {
  const tt = makeTimetable();

  it("Tuesday 10:45 with null here returns 線形代数 / p2", () => {
    const now = new Date(2026, 0, 6, 10, 45, 0); // 2026-01-06 is a Tuesday
    const res = currentClass(tt, now, null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("線形代数");
    expect(res!.period.id).toBe("p2");
  });

  it("Tuesday 10:40 (start inclusive) returns 線形代数", () => {
    const now = new Date(2026, 0, 6, 10, 40, 0);
    const res = currentClass(tt, now, null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("線形代数");
  });

  it("Tuesday 12:10 (end exclusive) returns null", () => {
    const now = new Date(2026, 0, 6, 12, 10, 0);
    const res = currentClass(tt, now, null);
    expect(res).toBeNull();
  });

  it("Tuesday 10:35 (break) returns null", () => {
    const now = new Date(2026, 0, 6, 10, 35, 0);
    const res = currentClass(tt, now, null);
    expect(res).toBeNull();
  });

  it("Monday 9:00 returns 英語", () => {
    const now = new Date(2026, 0, 5, 9, 0, 0); // 2026-01-05 is a Monday
    const res = currentClass(tt, now, null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("英語");
  });

  it("Wednesday 10:45 (no slot that day) returns null", () => {
    const now = new Date(2026, 0, 7, 10, 45, 0); // 2026-01-07 is a Wednesday
    const res = currentClass(tt, now, null);
    expect(res).toBeNull();
  });

  it("overlapping period: Tuesday 10:45 returns first matching period (p2)", () => {
    const tt2: Timetable = {
      ...tt,
      periods: [
        { id: "p1", label: "1限", start: "09:00", end: "09:50" },
        { id: "p2", label: "2限", start: "10:00", end: "11:00" },
        { id: "p3", label: "特別", start: "09:30", end: "11:00" },
      ],
      slots: [
        { day: 1, periodId: "p1", title: "英語", folders: [] },
        { day: 2, periodId: "p2", title: "線形代数", folders: [] },
        { day: 2, periodId: "p3", title: "特別講義", folders: [] },
      ],
    };
    const now = new Date(2026, 0, 6, 10, 45, 0);
    const res = currentClass(tt2, now, null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("線形代数");
    expect(res!.period.id).toBe("p2");
  });

  describe("place condition", () => {
    const ttPlace: Timetable = {
      ...makeTimetable(),
      place: { latitude: 0, longitude: 0, radius: 100 },
    };

    it("within radius + accuracy returns 線形代数", () => {
      const now = new Date(2026, 0, 6, 10, 45, 0);
      const here = { latitude: 0, longitude: 0.0005, accuracy: 10 };
      const res = currentClass(ttPlace, now, here);
      expect(res).not.toBeNull();
      expect(res!.slot.title).toBe("線形代数");
    });

    it("outside radius + accuracy returns null", () => {
      const now = new Date(2026, 0, 6, 10, 45, 0);
      const here = { latitude: 0, longitude: 0.01, accuracy: 50 };
      const res = currentClass(ttPlace, now, here);
      expect(res).toBeNull();
    });

    it("here is null returns 線形代数 (time only)", () => {
      const now = new Date(2026, 0, 6, 10, 45, 0);
      const res = currentClass(ttPlace, now, null);
      expect(res).not.toBeNull();
      expect(res!.slot.title).toBe("線形代数");
    });
  });
});
