import { describe, it, expect } from "vitest";
import { validateFileName, uniqueName } from "../src/core/names";

describe("validateFileName", () => {
  it("returns null for valid names", () => {
    expect(validateFileName("report.docx")).toBeNull();
    expect(validateFileName("新しいフォルダー")).toBeNull();
    expect(validateFileName("a")).toBeNull();
    expect(validateFileName(".gitignore")).toBeNull();
    expect(validateFileName("CONSOLE")).toBeNull();
    expect(validateFileName("con2")).toBeNull();
    expect(validateFileName("COM0")).toBeNull();
    expect(validateFileName("my con.txt")).toBeNull();
    expect(validateFileName("a".repeat(255))).toBeNull();
  });

  it("returns invalid for empty or whitespace-only names", () => {
    expect(validateFileName("")?.code).toBe("invalid");
    expect(validateFileName("   ")?.code).toBe("invalid");
  });

  it("returns invalid for names longer than 255 characters", () => {
    expect(validateFileName("a".repeat(256))?.code).toBe("invalid");
  });

  it("returns invalid for names containing forbidden characters", () => {
    expect(validateFileName("a/b")?.code).toBe("invalid");
    expect(validateFileName("a\\b")?.code).toBe("invalid");
    expect(validateFileName("a:b")?.code).toBe("invalid");
    expect(validateFileName("a*b")?.code).toBe("invalid");
    expect(validateFileName("a?b")?.code).toBe("invalid");
    expect(validateFileName('a"b')?.code).toBe("invalid");
    expect(validateFileName("a<b")?.code).toBe("invalid");
    expect(validateFileName("a>b")?.code).toBe("invalid");
    expect(validateFileName("a|b")?.code).toBe("invalid");
  });
});

describe("uniqueName", () => {
  it("returns base when no conflict", () => {
    expect(uniqueName("新しいフォルダー", [])).toBe("新しいフォルダー");
    expect(uniqueName("新しいフォルダー", ["a.txt", "b"])).toBe("新しいフォルダー");
  });

  it("appends (2) when base conflicts", () => {
    expect(uniqueName("新しいフォルダー", ["新しいフォルダー"])).toBe("新しいフォルダー (2)");
  });

  it("skips already-used numbers", () => {
    expect(
      uniqueName("新しいフォルダー", ["新しいフォルダー", "新しいフォルダー (2)", "新しいフォルダー (4)"]),
    ).toBe("新しいフォルダー (3)");
  });

  it("is case-insensitive", () => {
    expect(uniqueName("Folder", ["folder"])).toBe("Folder (2)");
    expect(uniqueName("Folder", ["FOLDER", "folder (2)"])).toBe("Folder (3)");
  });
});
