import { describe, it, expect } from "vitest";
import { isSameOrInside, dropEffect, moveItem } from "../src/core/drop";

const k = { ctrl: false, shift: false };
const ctrl = { ctrl: true, shift: false };
const shift = { ctrl: false, shift: true };

describe("isSameOrInside", () => {
  it("same path", () => {
    expect(isSameOrInside("C:\\a", "C:\\a")).toBe(true);
  });
  it("inside", () => {
    expect(isSameOrInside("C:\\a\\b", "C:\\a")).toBe(true);
  });
  it("case insensitive", () => {
    expect(isSameOrInside("c:\\A\\B", "C:\\a")).toBe(true);
  });
  it("trailing slash", () => {
    expect(isSameOrInside("C:\\a\\", "C:\\a")).toBe(true);
  });
  it("prefix not inside", () => {
    expect(isSameOrInside("C:\\ab", "C:\\a")).toBe(false);
  });
  it("parent not inside child", () => {
    expect(isSameOrInside("C:\\a", "C:\\a\\b")).toBe(false);
  });
  it("different drive", () => {
    expect(isSameOrInside("D:\\a", "C:\\a")).toBe(false);
  });
  it("drive root contains", () => {
    expect(isSameOrInside("C:\\x", "C:\\")).toBe(true);
  });
});

describe("dropEffect", () => {
  it("same drive move", () => {
    expect(dropEffect(["C:\\a\\f.txt"], "C:\\b", k)).toBe("move");
  });
  it("different drive copy", () => {
    expect(dropEffect(["C:\\a\\f.txt"], "D:\\b", k)).toBe("copy");
  });
  it("ctrl copy", () => {
    expect(dropEffect(["C:\\a\\f.txt"], "C:\\b", ctrl)).toBe("copy");
  });
  it("shift move", () => {
    expect(dropEffect(["C:\\a\\f.txt"], "D:\\b", shift)).toBe("move");
  });
  it("already there null", () => {
    expect(dropEffect(["C:\\a\\f.txt"], "C:\\a", k)).toBe(null);
  });
  it("already there ctrl copy", () => {
    expect(dropEffect(["C:\\a\\f.txt"], "C:\\a", ctrl)).toBe("copy");
  });
  it("into self null", () => {
    expect(dropEffect(["C:\\a"], "C:\\a\\sub", k)).toBe(null);
  });
  it("onto self null", () => {
    expect(dropEffect(["C:\\a"], "C:\\a", ctrl)).toBe(null);
  });
  it("empty sources null", () => {
    expect(dropEffect([], "C:\\b", k)).toBe(null);
  });
  it("drive root parent null", () => {
    expect(dropEffect(["C:\\x.txt"], "C:\\", k)).toBe(null);
  });
});

describe("moveItem", () => {
  it("move 0 to 2", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });
  it("move 3 to 0", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
  });
  it("same index", () => {
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });
  it("out of range from", () => {
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });
  it("negative to", () => {
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
  it("does not mutate input", () => {
    const input = ["a", "b", "c", "d"];
    const snapshot = input.slice();
    moveItem(input, 0, 2);
    expect(input).toEqual(snapshot);
  });
});
