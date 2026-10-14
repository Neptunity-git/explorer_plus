import { describe, it, expect } from "vitest";
import { distanceMeters, currentClass } from "../src/core/timetable-now";
import type { Timetable } from "../src/api/types";

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

describe("distanceMeters", () => {
  it("同じ点は 0", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })).toBe(0);
  });

  it("赤道上で経度 1 度", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111194.93, 1);
  });

  it("緯度 1 度", () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111194.93, 1);
  });
});

describe("currentClass", () => {
  it("火曜 10:45、here が null → 線形代数 / p2", () => {
    const res = currentClass(tt, new Date(2026, 9, 13, 10, 45), null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("線形代数");
    expect(res!.period.id).toBe("p2");
  });

  it("火曜 10:40（始まりは含む）→ 線形代数", () => {
    const res = currentClass(tt, new Date(2026, 9, 13, 10, 40), null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("線形代数");
  });

  it("火曜 12:10（終わりは含まない）→ null", () => {
    expect(currentClass(tt, new Date(2026, 9, 13, 12, 10), null)).toBeNull();
  });

  it("火曜 10:35（休み時間）→ null", () => {
    expect(currentClass(tt, new Date(2026, 9, 13, 10, 35), null)).toBeNull();
  });

  it("月曜 9:00 → 英語", () => {
    const res = currentClass(tt, new Date(2026, 9, 12, 9, 0), null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("英語");
  });

  it("水曜 10:45（その曜日のコマが無い）→ null", () => {
    expect(currentClass(tt, new Date(2026, 9, 14, 10, 45), null)).toBeNull();
  });

  it("時刻が重なる period：火曜 9:45 → 特別講義", () => {
    const tt2: Timetable = {
      ...tt,
      periods: [...tt.periods, { id: "p3", label: "特別", start: "09:30", end: "11:00" }],
      slots: [...tt.slots, { day: 2, periodId: "p3", title: "特別講義", folders: [] }],
    };
    const res = currentClass(tt2, new Date(2026, 9, 13, 9, 45), null);
    expect(res).not.toBeNull();
    expect(res!.slot.title).toBe("特別講義");
    expect(res!.period.id).toBe("p3");
  });

  describe("場所の条件", () => {
    const ttPlace: Timetable = {
      ...tt,
      place: { latitude: 0, longitude: 0, radius: 100 },
    };
    const tue1045 = new Date(2026, 9, 13, 10, 45);

    it("範囲内（約 56m）→ 線形代数", () => {
      const res = currentClass(ttPlace, tue1045, { latitude: 0, longitude: 0.0005, accuracy: 10 });
      expect(res).not.toBeNull();
      expect(res!.slot.title).toBe("線形代数");
    });

    it("範囲外（約 1112m）→ null", () => {
      expect(currentClass(ttPlace, tue1045, { latitude: 0, longitude: 0.01, accuracy: 50 })).toBeNull();
    });

    it("here が null → 時刻だけで決める", () => {
      const res = currentClass(ttPlace, tue1045, null);
      expect(res).not.toBeNull();
      expect(res!.slot.title).toBe("線形代数");
    });
  });
});
