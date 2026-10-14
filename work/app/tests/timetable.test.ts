import { describe, it, expect } from "vitest";
import { parseTime, emptyTimetable, validateTimetable } from "../src/core/timetable";

describe("parseTime", () => {
  it("parses valid times", () => {
    expect(parseTime("09:00")).toBe(540);
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("23:59")).toBe(1439);
  });

  it("returns null for invalid times", () => {
    expect(parseTime("9:00")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("12:60")).toBeNull();
    expect(parseTime("12:00 ")).toBeNull();
    expect(parseTime(930)).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe("emptyTimetable", () => {
  it("returns the correct structure", () => {
    expect(emptyTimetable()).toEqual({ days: [1, 2, 3, 4, 5], periods: [], slots: [], place: null });
  });

  it("returns a new object each call", () => {
    const a = emptyTimetable();
    const b = emptyTimetable();
    expect(a).not.toBe(b);
  });
});

describe("validateTimetable", () => {
  const validInput = {
    days: [1, 2, 3, 4, 5],
    periods: [
      { id: "p1", label: "1限", start: "09:00", end: "09:50" },
      { id: "p2", label: "2限", start: "10:00", end: "10:50" },
    ],
    slots: [
      { day: 1, periodId: "p1", title: "数学", folders: [{ id: "a", path: "/math" }] },
      { day: 2, periodId: "p2", title: "国語", folders: [] },
    ],
    place: null,
  };

  it("accepts a valid timetable", () => {
    const result = validateTimetable(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timetable.days).toEqual([1, 2, 3, 4, 5]);
      expect(result.timetable.periods).toHaveLength(2);
      expect(result.timetable.slots).toHaveLength(2);
      expect(result.timetable.place).toBeNull();
    }
  });

  it("accepts a valid place", () => {
    const input = { ...validInput, place: { latitude: 36.4, longitude: 139.1, radius: 300 } };
    const result = validateTimetable(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timetable.place).toEqual({ latitude: 36.4, longitude: 139.1, radius: 300 });
    }
  });

  it("rejects non-object input", () => {
    for (const bad of [null, [], "x"]) {
      const result = validateTimetable(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toEqual(["timetable: must be an object"]);
      }
    }
  });

  it("rejects invalid days", () => {
    const r1 = validateTimetable({ ...validInput, days: [1, 7] });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors.some((e) => e.startsWith("days[1]: "))).toBe(true);

    const r2 = validateTimetable({ ...validInput, days: [1.5] });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.some((e) => e.startsWith("days[0]: "))).toBe(true);

    const r3 = validateTimetable({ periods: validInput.periods, slots: validInput.slots, place: null });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.some((e) => e.startsWith("days: "))).toBe(true);
  });

  it("rejects invalid period start", () => {
    const input = {
      ...validInput,
      periods: [
        { id: "p1", label: "1限", start: "9:00", end: "09:50" },
        { id: "p2", label: "2限", start: "10:00", end: "10:50" },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("periods[0].start: "))).toBe(true);
  });

  it("rejects period where start >= end", () => {
    const input = {
      ...validInput,
      periods: [
        { id: "p1", label: "1限", start: "10:30", end: "09:00" },
        { id: "p2", label: "2限", start: "10:00", end: "10:50" },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("periods[0]: "))).toBe(true);
  });

  it("rejects duplicate period id", () => {
    const input = {
      ...validInput,
      periods: [
        { id: "p1", label: "1限", start: "09:00", end: "09:50" },
        { id: "p1", label: "2限", start: "10:00", end: "10:50" },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("periods[1].id: "))).toBe(true);
  });

  it("rejects empty period label", () => {
    const input = {
      ...validInput,
      periods: [
        { id: "p1", label: "", start: "09:00", end: "09:50" },
        { id: "p2", label: "2限", start: "10:00", end: "10:50" },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("periods[0].label: "))).toBe(true);
  });

  it("rejects more than 20 periods", () => {
    const periods = Array.from({ length: 21 }, (_, i) => ({
      id: `p${i}`,
      label: "x",
      start: "09:00",
      end: "10:00",
    }));
    const result = validateTimetable({ ...validInput, periods });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("periods: "))).toBe(true);
  });

  it("rejects slot with unknown periodId", () => {
    const input = {
      ...validInput,
      slots: [
        { day: 1, periodId: "p9", title: "数学", folders: [] },
        { day: 2, periodId: "p2", title: "国語", folders: [] },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("slots[0].periodId: "))).toBe(true);
  });

  it("rejects slot with invalid day", () => {
    const input = {
      ...validInput,
      slots: [
        { day: 7, periodId: "p1", title: "数学", folders: [] },
        { day: 2, periodId: "p2", title: "国語", folders: [] },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("slots[0].day: "))).toBe(true);
  });

  it("rejects slot with title too long", () => {
    const input = {
      ...validInput,
      slots: [
        { day: 1, periodId: "p1", title: "x".repeat(61), folders: [] },
        { day: 2, periodId: "p2", title: "国語", folders: [] },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("slots[0].title: "))).toBe(true);
  });

  it("rejects slot with invalid folders", () => {
    const input = {
      ...validInput,
      slots: [
        { day: 1, periodId: "p1", title: "数学", folders: [{ id: "a", path: "" }] },
        { day: 2, periodId: "p2", title: "国語", folders: [] },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("slots[0].folders: "))).toBe(true);
  });

  it("rejects duplicate slot day/period", () => {
    const input = {
      ...validInput,
      slots: [
        { day: 2, periodId: "p2", title: "a", folders: [] },
        { day: 2, periodId: "p2", title: "b", folders: [] },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("slots[1]: "))).toBe(true);
  });

  it("rejects invalid place latitude", () => {
    const input = { ...validInput, place: { latitude: 91, longitude: 0, radius: 100 } };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("place: "))).toBe(true);
  });

  it("rejects invalid place radius", () => {
    const input = { ...validInput, place: { latitude: 0, longitude: 0, radius: 0 } };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.startsWith("place: "))).toBe(true);
  });

  it("reports multiple errors at once", () => {
    const input = {
      ...validInput,
      days: [9],
      periods: [
        { id: "p1", label: "1限", start: "09:00", end: "25:00" },
        { id: "p2", label: "2限", start: "10:00", end: "10:50" },
      ],
    };
    const result = validateTimetable(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.startsWith("days[0]: "))).toBe(true);
      expect(result.errors.some((e) => e.startsWith("periods[0].end: "))).toBe(true);
    }
  });
});
