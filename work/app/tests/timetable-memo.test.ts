import { describe, it, expect } from "vitest";
import { validateTimetable } from "../src/core/timetable";

function base() {
  return {
    days: [1],
    periods: [{ id: "p1", label: "1限", start: "08:00", end: "08:50" }],
    slots: [{ day: 1, periodId: "p1", title: "英語", folders: [] }],
    place: null,
    ondemand: [{ id: "o1", title: "情報倫理", folders: [] }],
  };
}

describe("validateTimetable memo (ADR 0015 判断4)", () => {
  it("土台のままなら ok: true で、slots[0] と ondemand[0] に memo キーが無い", () => {
    const res = validateTimetable(base());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.timetable.slots[0]).not.toHaveProperty("memo");
    expect(res.timetable.ondemand![0]).not.toHaveProperty("memo");
  });

  it("slots[0] に memo: '301教室' → ok: true で、出力の slots[0] が期待通り", () => {
    const raw = base();
    (raw.slots[0] as Record<string, unknown>).memo = "301教室";
    const res = validateTimetable(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.timetable.slots[0]).toEqual({
      day: 1,
      periodId: "p1",
      title: "英語",
      folders: [],
      memo: "301教室",
    });
  });

  it("ondemand[0] に memo: '毎週金曜まで' → ok: true で、出力の ondemand[0] が期待通り", () => {
    const raw = base();
    (raw.ondemand![0] as Record<string, unknown>).memo = "毎週金曜まで";
    const res = validateTimetable(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.timetable.ondemand![0]).toEqual({
      id: "o1",
      title: "情報倫理",
      folders: [],
      memo: "毎週金曜まで",
    });
  });

  it("slots[0] に memo: '' → ok: true で、出力の slots[0].memo が ''", () => {
    const raw = base();
    (raw.slots[0] as Record<string, unknown>).memo = "";
    const res = validateTimetable(raw);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.timetable.slots[0].memo).toBe("");
  });

  it("slots[0] に memo: 'x'.repeat(200) → ok: true", () => {
    const raw = base();
    (raw.slots[0] as Record<string, unknown>).memo = "x".repeat(200);
    const res = validateTimetable(raw);
    expect(res.ok).toBe(true);
  });

  it("slots[0] に memo: 'x'.repeat(201) → ok: false で、'slots[0].memo: ' で始まる誤り", () => {
    const raw = base();
    (raw.slots[0] as Record<string, unknown>).memo = "x".repeat(201);
    const res = validateTimetable(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.startsWith("slots[0].memo: "))).toBe(true);
  });

  it("slots[0] に memo: 3 → ok: false で、'slots[0].memo: ' で始まる誤り", () => {
    const raw = base();
    (raw.slots[0] as Record<string, unknown>).memo = 3;
    const res = validateTimetable(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.startsWith("slots[0].memo: "))).toBe(true);
  });

  it("ondemand[0] に memo: null → ok: false で、'ondemand[0].memo: ' で始まる誤り", () => {
    const raw = base();
    (raw.ondemand![0] as Record<string, unknown>).memo = null;
    const res = validateTimetable(raw);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors.some((e) => e.startsWith("ondemand[0].memo: "))).toBe(true);
  });
});
