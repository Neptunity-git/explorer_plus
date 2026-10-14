import { describe, it, expect } from "vitest";
import { formatSize } from "../src/core/format";

describe("formatSize", () => {
  it("formats bytes below 1024 as B", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1)).toBe("1 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("formats KB values", () => {
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1075)).toBe("1 KB");
    expect(formatSize(10239)).toBe("10 KB");
    expect(formatSize(10240)).toBe("10 KB");
  });

  it("does not bump unit when rounding reaches 1024", () => {
    expect(formatSize(1048575)).toBe("1024 KB");
  });

  it("formats MB values", () => {
    expect(formatSize(1048576)).toBe("1 MB");
    expect(formatSize(123456789)).toBe("118 MB");
  });

  it("formats GB values", () => {
    expect(formatSize(1073741824)).toBe("1 GB");
    expect(formatSize(5 * 1024 ** 3 + 300 * 1024 ** 2)).toBe("5.3 GB");
  });

  it("formats TB values and caps at TB", () => {
    expect(formatSize(1024 ** 4)).toBe("1 TB");
    expect(formatSize(1024 ** 5)).toBe("1024 TB");
  });

  it("returns empty string for invalid input", () => {
    expect(formatSize(-1)).toBe("");
    expect(formatSize(1.5)).toBe("");
    expect(formatSize(NaN)).toBe("");
    expect(formatSize(Infinity)).toBe("");
  });
});
