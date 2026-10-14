import { describe, expect, it } from "vitest";
import { validateTimetable } from "../src/core/timetable";

function base(): Record<string, unknown> {
  return {
    days: [1, 2, 3, 4, 5],
    periods: [],
    slots: [],
    place: null,
  };
}

function hasError(errors: string[], prefix: string): boolean {
  return errors.some((e) => e.startsWith(prefix));
}

describe("validateTimetable ondemand", () => {
  it("base without ondemand -> ok and no ondemand key", () => {
    const r = validateTimetable(base());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.timetable.ondemand).toBeUndefined();
    expect(Object.keys(r.timetable)).not.toContain("ondemand");
  });

  it("valid ondemand entry -> ok, unknown keys dropped", () => {
    const raw = base();
    raw.ondemand = [
      {
        id: "o1",
        title: "情報倫理",
        folders: [{ id: "a:b", path: "C:\\情報倫理", x: 1 }],
        memo: "x",
      },
    ];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.timetable.ondemand).toEqual([
      { id: "o1", title: "情報倫理", folders: [{ id: "a:b", path: "C:\\情報倫理" }] },
    ]);
  });

  it("empty ondemand array -> ok and ondemand is []", () => {
    const raw = base();
    raw.ondemand = [];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.timetable.ondemand).toEqual([]);
  });

  it("ondemand not an array -> ondemand: ", () => {
    const raw = base();
    raw.ondemand = "x";
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand: ")).toBe(true);
  });

  it("ondemand element null -> ondemand[0]: ", () => {
    const raw = base();
    raw.ondemand = [null];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand[0]: ")).toBe(true);
  });

  it("empty id -> ondemand[0].id: ", () => {
    const raw = base();
    raw.ondemand = [{ id: "", title: "a", folders: [] }];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand[0].id: ")).toBe(true);
  });

  it("duplicate id -> ondemand[1].id: ", () => {
    const raw = base();
    raw.ondemand = [
      { id: "o1", title: "a", folders: [] },
      { id: "o1", title: "b", folders: [] },
    ];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand[1].id: ")).toBe(true);
  });

  it("empty title -> ondemand[0].title: ", () => {
    const raw = base();
    raw.ondemand = [{ id: "o1", title: "", folders: [] }];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand[0].title: ")).toBe(true);
  });

  it("title too long -> ondemand[0].title: ", () => {
    const raw = base();
    raw.ondemand = [{ id: "o1", title: "x".repeat(61), folders: [] }];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand[0].title: ")).toBe(true);
  });

  it("folder empty path -> ondemand[0].folders: ", () => {
    const raw = base();
    raw.ondemand = [{ id: "o1", title: "a", folders: [{ id: "a", path: "" }] }];
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand[0].folders: ")).toBe(true);
  });

  it("51 elements -> ondemand: ", () => {
    const raw = base();
    const arr: unknown[] = [];
    for (let i = 0; i < 51; i++) {
      arr.push({ id: `o${i}`, title: "a", folders: [] });
    }
    raw.ondemand = arr;
    const r = validateTimetable(raw);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(hasError(r.errors, "ondemand: ")).toBe(true);
  });
});
